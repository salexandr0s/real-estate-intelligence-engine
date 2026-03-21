import type { DetailCapture, SourceAvailability } from '@rei/contracts';
import type { OpenImmoDetailDTO, OpenImmoListingData } from './dto.js';

const BASE_URL = 'https://www.openimmo.at';
const LISTING_DATA_RE = /<script[^>]+id="listing-data"[^>]*>([\s\S]*?)<\/script>/;
const LD_JSON_RE = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/;

/**
 * openimmo.at detail pages embed listing data in a
 * `<script type="application/json" id="listing-data">` tag.
 * Fields follow the OpenImmo standard with German names.
 */

export function parseDetailPage(
  html: string,
  url: string,
  sourceCode: string,
  parserVersion: number,
): DetailCapture<OpenImmoDetailDTO> {
  const scriptMatch = html.match(LISTING_DATA_RE) ?? html.match(LD_JSON_RE);

  let listing: OpenImmoListingData | null = null;
  if (scriptMatch?.[1]) {
    try {
      const data = JSON.parse(scriptMatch[1]) as unknown;
      if (isListingData(data)) {
        listing = data;
      }
    } catch {
      // parse failed, fall through
    }
  }

  if (!listing) {
    return buildFailedCapture(url, sourceCode, parserVersion);
  }

  const openimmoId = listing.objektNr || extractIdFromUrl(url) || '';

  // Build address display
  const addressParts: string[] = [];
  if (listing.strasse) addressParts.push(listing.strasse);
  if (listing.plz) addressParts.push(listing.plz);
  if (listing.ort) addressParts.push(listing.ort);
  if (listing.stadtteil) addressParts.push(listing.stadtteil);
  const addressDisplay = addressParts.length > 0 ? addressParts.join(', ') : null;

  // Derive district from postcode for Vienna
  const districtRaw = extractDistrictFromPostcode(listing.plz);

  const payload: OpenImmoDetailDTO = {
    openimmoId,
    titleRaw: listing.titel ?? null,
    descriptionRaw: listing.beschreibung ? stripHtml(listing.beschreibung) : null,
    priceRaw: listing.kaufpreis != null ? String(listing.kaufpreis) : null,
    livingAreaRaw: normalizeDecimal(listing.wohnflaeche != null ? String(listing.wohnflaeche) : null),
    usableAreaRaw: normalizeDecimal(listing.nutzflaeche != null ? String(listing.nutzflaeche) : null),
    roomsRaw: listing.anzahlZimmer != null ? String(listing.anzahlZimmer) : null,
    addressRaw: addressDisplay,
    postalCodeRaw: listing.plz ?? null,
    districtRaw,
    cityRaw: listing.ort ?? null,
    federalStateRaw: null,
    streetRaw: listing.strasse ?? null,
    floorRaw: listing.etage != null ? String(listing.etage) : null,
    yearBuiltRaw: listing.baujahr != null ? String(listing.baujahr) : null,
    propertyTypeRaw: listing.objektart ?? null,
    operationTypeRaw: mapOperationType(listing.vermarktungsart),
    statusRaw: listing.status ?? 'unknown',
    heatingTypeRaw: listing.heizungsart ?? null,
    conditionRaw: listing.zustand ?? null,
    energyCertificateRaw: listing.energieausweis ?? null,
    balconyAreaRaw: normalizeDecimal(listing.balkonFlaeche != null ? String(listing.balkonFlaeche) : null),
    terraceAreaRaw: null,
    gardenAreaRaw: null,
    commissionRaw: null,
    operatingCostRaw: listing.betriebskosten != null ? String(listing.betriebskosten) : null,
    reserveFundRaw: null,
    latRaw: listing.breitengrad != null ? String(listing.breitengrad) : null,
    lonRaw: listing.laengengrad != null ? String(listing.laengengrad) : null,
    attributesRaw: buildAttributesMap(listing),
    mediaRaw: [],
    images: listing.bilder ?? [],
    contactName: listing.kontaktName ?? null,
  };

  return {
    sourceCode,
    sourceListingKeyCandidate: openimmoId,
    externalId: openimmoId,
    canonicalUrl: `${BASE_URL}/immobilie/${openimmoId}`,
    detailUrl: url,
    extractedAt: new Date().toISOString(),
    payload,
    parserVersion,
    extractionStatus: payload.titleRaw ? 'captured' : 'parse_failed',
  };
}

function buildFailedCapture(
  url: string,
  sourceCode: string,
  parserVersion: number,
): DetailCapture<OpenImmoDetailDTO> {
  return {
    sourceCode,
    sourceListingKeyCandidate: extractIdFromUrl(url) ?? '',
    externalId: extractIdFromUrl(url),
    canonicalUrl: url.split('?')[0] ?? url,
    detailUrl: url,
    extractedAt: new Date().toISOString(),
    payload: {
      openimmoId: extractIdFromUrl(url) ?? '',
      titleRaw: null,
      descriptionRaw: null,
      priceRaw: null,
      livingAreaRaw: null,
      usableAreaRaw: null,
      roomsRaw: null,
      addressRaw: null,
      postalCodeRaw: null,
      districtRaw: null,
      cityRaw: null,
      propertyTypeRaw: null,
      operationTypeRaw: null,
      statusRaw: 'unknown',
      attributesRaw: {},
      mediaRaw: [],
      images: [],
      contactName: null,
    },
    parserVersion,
    extractionStatus: 'parse_failed',
  };
}

export function detectDetailAvailability(html: string): SourceAvailability {
  // Try embedded JSON first
  const scriptMatch = html.match(LISTING_DATA_RE) ?? html.match(LD_JSON_RE);
  if (scriptMatch?.[1]) {
    try {
      const data = JSON.parse(scriptMatch[1]) as unknown;
      if (isListingData(data)) {
        const status = data.status?.toLowerCase();
        if (status === 'aktiv' || status === 'active') return { status: 'available' };
        if (status === 'verkauft' || status === 'sold') return { status: 'sold' };
        if (status === 'reserviert' || status === 'reserved') return { status: 'reserved' };
        if (status === 'vermietet' || status === 'rented') return { status: 'rented' };
        if (status === 'inaktiv' || status === 'inactive') return { status: 'removed' };
        // Listing data present with unknown status — assume available
        return { status: 'available' };
      }
    } catch {
      // fall through
    }
  }

  // Check for sold/removed text markers in body
  if (/verkauft|sold/i.test(html)) return { status: 'sold' };
  if (/objekt\s+nicht\s+gefunden|nicht\s+mehr\s+verf[uü]gbar|not\s+found/i.test(html)) {
    return { status: 'not_found' };
  }
  if (/captcha|blocked|challenge/i.test(html)) return { status: 'blocked' };

  return { status: 'unknown' };
}

/**
 * Normalize Austrian/German decimal format to standard format.
 * Handles: "71,3" -> "71.3", "1.250,50" -> "1250.50", "86" -> "86"
 */
export function normalizeDecimal(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.includes(',')) {
    // Austrian/German format: dots are thousands separators, comma is decimal
    return trimmed.replace(/\./g, '').replace(',', '.');
  }
  return trimmed;
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function extractIdFromUrl(url: string): string | null {
  // Match /immobilie/OI-2026-001 or /immobilie/12345
  const m = url.match(/\/immobilie\/([A-Za-z0-9-]+)/);
  if (m?.[1]) return m[1];
  // Fallback: trailing alphanumeric segment
  return url.match(/\/([A-Za-z0-9-]+)\/?$/)?.[1] ?? null;
}

function extractDistrictFromPostcode(postcode: string | null): string | null {
  if (!postcode) return null;
  // Vienna postcodes: 10XX -> XX. Bezirk
  const m = postcode.match(/^1(\d{2})0$/);
  if (m?.[1]) {
    const districtNo = parseInt(m[1], 10);
    if (districtNo >= 1 && districtNo <= 23) {
      return `${districtNo}. Bezirk`;
    }
  }
  return null;
}

function mapOperationType(vermarktungsart: string | null): string {
  if (!vermarktungsart) return 'sale';
  const lower = vermarktungsart.toLowerCase();
  if (lower.includes('kauf') || lower === 'kauf') return 'sale';
  if (lower.includes('miet') || lower === 'miete') return 'rent';
  return 'sale';
}

function buildAttributesMap(listing: OpenImmoListingData): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  if (listing.heizungsart) map['heizungsart'] = listing.heizungsart;
  if (listing.zustand) map['zustand'] = listing.zustand;
  if (listing.energieausweis) map['energieausweis'] = listing.energieausweis;
  if (listing.vermarktungsart) map['vermarktungsart'] = listing.vermarktungsart;
  if (listing.objektart) map['objektart'] = listing.objektart;
  if (listing.kontaktTelefon) map['kontaktTelefon'] = listing.kontaktTelefon;
  if (listing.status) map['status'] = listing.status;
  return map;
}

function isListingData(data: unknown): data is OpenImmoListingData {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return typeof obj['objektNr'] === 'string' && typeof obj['titel'] === 'string';
}
