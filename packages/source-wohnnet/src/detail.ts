import type { DetailCapture, SourceAvailability } from '@rei/contracts';
import type { WohnnetDetailDTO, JsonLdProduct, WohnnetDataLayer } from './dto.js';
import { extractIdFromUrl } from './discovery.js';

/**
 * Wohnnet detail pages embed multiple data sources:
 *
 * 1. JSON-LD `Product` schema — name, price, description, seller (Organization)
 * 2. `dataLayer` JS variable — dL-preis, dL-flaeche, dL-zimmer, dL-angebot,
 *    dL-objektart, Region4.Name
 * 3. `var realtyId = NNN` — listing ID
 * 4. HTML sections — energy certificate, floor, year built, contact, features
 *
 * The parser merges all sources, preferring structured data over HTML scraping.
 */

export function parseDetailPage(
  html: string,
  url: string,
  sourceCode: string,
  parserVersion: number,
): DetailCapture<WohnnetDetailDTO> {
  const jsonLd = extractProductJsonLd(html);
  const dataLayer = extractDataLayer(html);

  // If neither JSON-LD nor dataLayer present, this is a failed parse
  if (!jsonLd && !dataLayer) {
    return buildFailedCapture(url, sourceCode, parserVersion);
  }

  // -- ID resolution: var realtyId > data-id attr > URL extraction
  const wohnnetId =
    extractRealtyIdVar(html)
    ?? extractDataIdAttr(html)
    ?? extractIdFromUrl(url)
    ?? '';

  // -- Title: JSON-LD > HTML h1
  const titleRaw =
    jsonLd?.name
    ?? extractHtmlTitle(html)
    ?? null;

  // -- Description: JSON-LD > HTML paragraph
  const descriptionRaw =
    (jsonLd?.description ? stripHtml(jsonLd.description) : null)
    ?? extractHtmlDescription(html);

  // -- Price: JSON-LD offers > dataLayer dL-preis
  const priceRaw =
    jsonLd?.offers?.price
    ?? dataLayer?.['dL-preis']
    ?? null;

  // -- Area: dataLayer dL-flaeche (Austrian decimal)
  const livingAreaRaw = normalizeDecimal(dataLayer?.['dL-flaeche'] ?? null)
    ?? extractEckdatenValue(html, 'Wohnfl');

  // -- Rooms: dataLayer dL-zimmer
  const roomsRaw =
    dataLayer?.['dL-zimmer']
    ?? extractEckdatenValue(html, 'Zimmer')
    ?? null;

  // -- Property type: dataLayer dL-objektart
  const propertyTypeRaw =
    dataLayer?.['dL-objektart']
    ?? extractEckdatenValue(html, 'Objekttyp')
    ?? null;

  // -- Operation type: dataLayer dL-angebot > URL heuristic
  const angebot = dataLayer?.['dL-angebot'];
  const operationTypeRaw = mapOperationType(angebot ?? null, url);

  // -- Location: dataLayer Region4.Name ("1050 Wien, Margareten")
  const regionName = dataLayer?.['Region4.Name'] ?? null;
  const { postalCodeRaw, cityRaw, districtRaw } = parseRegionName(regionName);

  // -- Address from HTML
  const addressRaw = extractHtmlAddress(html);
  const streetRaw = extractStreetFromAddress(addressRaw);

  // -- Floor, year built, condition, heating from Eckdaten table
  const floorRaw = extractEckdatenValue(html, 'Stockwerk') ?? extractEckdatenValue(html, 'Stock');
  const yearBuiltRaw = extractEckdatenValue(html, 'Baujahr');
  const conditionRaw = extractEckdatenValue(html, 'Zustand');
  const heatingTypeRaw = extractEckdatenValue(html, 'Heizung');
  const operatingCostRaw = extractEckdatenValue(html, 'Betriebskosten');
  const commissionRaw = extractEckdatenValue(html, 'Provision');

  // -- Energy certificate from dedicated section
  const energyCertificateRaw = extractEnergyClass(html);

  // -- Features from <li> items (Balkon, Terrasse, etc.)
  const balconyAreaRaw = extractFeatureArea(html, 'Balkon');
  const terraceAreaRaw = extractFeatureArea(html, 'Terrasse');
  const gardenAreaRaw = extractFeatureArea(html, 'Garten');

  // -- Images from gallery
  const images = extractImages(html);

  // -- Broker from JSON-LD brand or HTML contact section
  const brokerCompany =
    jsonLd?.brand?.name
    ?? extractBrokerName(html)
    ?? null;

  // -- Coordinates from map element
  const { lat, lon } = extractCoordinates(html);

  // -- Contact info from HTML
  const contactPhone = extractContactField(html, 'phone');
  const contactEmail = extractContactField(html, 'envelope');

  // -- Build attributes map from all sources
  const attributesRaw: Record<string, unknown> = {};
  if (roomsRaw) attributesRaw['numberOfRooms'] = roomsRaw;
  if (yearBuiltRaw) attributesRaw['yearBuilt'] = yearBuiltRaw;
  if (priceRaw) attributesRaw['price'] = priceRaw;
  if (propertyTypeRaw) attributesRaw['propertyType'] = propertyTypeRaw;
  if (angebot) attributesRaw['angebot'] = angebot;
  if (contactPhone) attributesRaw['contactPhone'] = contactPhone;
  if (contactEmail) attributesRaw['contactEmail'] = contactEmail;
  if (energyCertificateRaw) attributesRaw['energyClass'] = energyCertificateRaw;

  const payload: WohnnetDetailDTO = {
    wohnnetId,
    titleRaw,
    descriptionRaw,
    priceRaw,
    livingAreaRaw,
    usableAreaRaw: null,
    roomsRaw,
    addressRaw,
    postalCodeRaw,
    districtRaw,
    cityRaw,
    federalStateRaw: null,
    streetRaw,
    floorRaw,
    yearBuiltRaw,
    propertyTypeRaw,
    operationTypeRaw,
    statusRaw: 'active',
    heatingTypeRaw,
    conditionRaw,
    energyCertificateRaw,
    balconyAreaRaw,
    terraceAreaRaw: terraceAreaRaw ?? null,
    gardenAreaRaw: gardenAreaRaw ?? null,
    commissionRaw,
    operatingCostRaw,
    reserveFundRaw: null,
    latRaw: lat,
    lonRaw: lon,
    attributesRaw,
    mediaRaw: [],
    images,
    brokerCompany,
  };

  return {
    sourceCode,
    sourceListingKeyCandidate: wohnnetId,
    externalId: wohnnetId,
    canonicalUrl: (url.split('?')[0]) ?? url,
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
): DetailCapture<WohnnetDetailDTO> {
  return {
    sourceCode,
    sourceListingKeyCandidate: extractIdFromUrl(url) ?? '',
    externalId: extractIdFromUrl(url),
    canonicalUrl: (url.split('?')[0]) ?? url,
    detailUrl: url,
    extractedAt: new Date().toISOString(),
    payload: {
      wohnnetId: extractIdFromUrl(url) ?? '',
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
      brokerCompany: null,
    },
    parserVersion,
    extractionStatus: 'parse_failed',
  };
}

export function detectDetailAvailability(html: string): SourceAvailability {
  // Check for explicit unavailability markers
  if (/nicht\s+mehr\s+verf[uü]gbar/i.test(html)) return { status: 'removed' };
  if (/Objekt\s+nicht\s+gefunden/i.test(html)) return { status: 'not_found' };
  if (/bereits\s+verkauft/i.test(html)) return { status: 'sold' };
  if (/bereits\s+vermietet/i.test(html)) return { status: 'rented' };
  if (/reserviert/i.test(html)) return { status: 'reserved' };
  if (/Inserat\s+wurde\s+deaktiviert/i.test(html)) return { status: 'removed' };

  // Check for anti-bot indicators
  if (/captcha|blocked|challenge/i.test(html)) return { status: 'blocked' };

  // If JSON-LD Product present with name, it is available
  const jsonLd = extractProductJsonLd(html);
  if (jsonLd?.name) return { status: 'available' };

  // If dataLayer present with price, it is available
  const dataLayer = extractDataLayer(html);
  if (dataLayer?.['dL-preis']) return { status: 'available' };

  // No clear signal
  return { status: 'unknown' };
}

// -- Primary: JSON-LD Product -------------------------------------------------

function extractProductJsonLd(html: string): JsonLdProduct | null {
  const pattern = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        if (obj['@type'] === 'Product') {
          return obj as unknown as JsonLdProduct;
        }
      }
    } catch {
      // skip malformed blocks
    }
  }
  return null;
}

// -- Secondary: dataLayer JS variable -----------------------------------------

function extractDataLayer(html: string): WohnnetDataLayer | null {
  // Match: dataLayer = [{ ... }]; (possibly multiline)
  const match = html.match(/dataLayer\s*=\s*\[\s*(\{[\s\S]*?\})\s*\]/);
  if (!match?.[1]) return null;
  try {
    // The dataLayer object uses double-quoted keys and values (valid JSON)
    const parsed: unknown = JSON.parse(match[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as WohnnetDataLayer;
    }
  } catch {
    // skip malformed dataLayer
  }
  return null;
}

// -- Tertiary: var realtyId ---------------------------------------------------

function extractRealtyIdVar(html: string): string | null {
  const match = html.match(/var\s+realtyId\s*=\s*(\d+)/);
  return match?.[1] ?? null;
}

// -- HTML data-id attribute ---------------------------------------------------

function extractDataIdAttr(html: string): string | null {
  const match = html.match(/<main[^>]*data-id="(\d+)"/i);
  return match?.[1] ?? null;
}

// -- HTML field extractors ----------------------------------------------------

function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return match?.[1] ? stripHtml(match[1]).trim() : null;
}

function extractHtmlDescription(html: string): string | null {
  const match = html.match(/realty-description[\s\S]*?<p>([\s\S]*?)<\/p>/i);
  return match?.[1] ? stripHtml(match[1]).trim() : null;
}

function extractHtmlAddress(html: string): string | null {
  const match = html.match(/realty-address[\s\S]*?<span>([\s\S]*?)<\/span>/i);
  return match?.[1]?.trim() ?? null;
}

function extractStreetFromAddress(address: string | null): string | null {
  if (!address) return null;
  // Address format: "Siebenbrunnengasse 44, 1050 Wien, Margareten"
  // Street is the first comma-separated part
  const parts = address.split(',');
  return parts[0]?.trim() ?? null;
}

/**
 * Extract a value from an Eckdaten (key facts) table row.
 * Format: <tr><th>Label</th><td>Value</td></tr>
 */
function extractEckdatenValue(html: string, label: string): string | null {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<th>[^<]*${escapedLabel}[^<]*<\\/th>\\s*<td>([^<]+)<\\/td>`,
    'i',
  );
  const match = html.match(pattern);
  return match?.[1]?.trim() ?? null;
}

/**
 * Extract energy class from the energy certificate section.
 * Looks for "Klasse" row value like "B" or "A+".
 */
function extractEnergyClass(html: string): string | null {
  return extractEckdatenValue(html, 'Klasse');
}

/**
 * Extract area for a feature from <li> list items.
 * Format: "Balkon (5,8 m2)" -> "5.8"
 */
function extractFeatureArea(html: string, featureName: string): string | null {
  const escapedName = featureName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<li>[^<]*${escapedName}\\s*\\(\\s*(\\d+[,.]?\\d*)\\s*m`,
    'i',
  );
  const match = html.match(pattern);
  if (!match?.[1]) return null;
  return normalizeDecimal(match[1]);
}

/**
 * Extract image URLs from gallery img tags.
 */
function extractImages(html: string): string[] {
  const images: string[] = [];
  // Look for images within gallery section
  const galleryMatch = html.match(/realty-gallery[\s\S]*?<\/div>/i);
  if (galleryMatch) {
    const imgPattern = /src="(https:\/\/api\.wohnnet\.at\/v1\/images[^"]*)"/gi;
    let imgMatch: RegExpExecArray | null;
    while ((imgMatch = imgPattern.exec(galleryMatch[0])) !== null) {
      if (imgMatch[1]) images.push(imgMatch[1]);
    }
  }
  // Fallback: JSON-LD image
  if (images.length === 0) {
    const jsonLd = extractProductJsonLd(html);
    if (jsonLd?.image) {
      if (typeof jsonLd.image === 'string') {
        images.push(jsonLd.image);
      } else if (Array.isArray(jsonLd.image)) {
        for (const u of jsonLd.image) {
          if (typeof u === 'string') images.push(u);
        }
      }
    }
  }
  return images;
}

/**
 * Extract broker/company name from contact section.
 */
function extractBrokerName(html: string): string | null {
  const match = html.match(/broker-name[\s\S]*?<strong>([\s\S]*?)<\/strong>/i);
  return match?.[1]?.trim() ?? null;
}

/**
 * Extract coordinates from map element data attributes.
 */
function extractCoordinates(html: string): { lat: string | null; lon: string | null } {
  const latMatch = html.match(/data-lat="([^"]*)"/i);
  const lonMatch = html.match(/data-lon="([^"]*)"/i);
  return {
    lat: latMatch?.[1] ?? null,
    lon: lonMatch?.[1] ?? null,
  };
}

/**
 * Extract phone or email from contact section.
 */
function extractContactField(html: string, iconClass: string): string | null {
  const escapedIcon = iconClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `fa-${escapedIcon}[^<]*<\\/i>\\s*<a[^>]*>([^<]+)<\\/a>`,
    'i',
  );
  const match = html.match(pattern);
  return match?.[1]?.trim() ?? null;
}

/**
 * Parse "Region4.Name" value like "1050 Wien, Margareten".
 */
function parseRegionName(
  regionName: string | null,
): { postalCodeRaw: string | null; cityRaw: string | null; districtRaw: string | null } {
  if (!regionName) return { postalCodeRaw: null, cityRaw: null, districtRaw: null };

  const match = regionName.match(/^(\d{4})\s+(Wien)(?:\s*,\s*(.+))?$/i);
  if (!match) return { postalCodeRaw: null, cityRaw: null, districtRaw: null };

  return {
    postalCodeRaw: match[1] ?? null,
    cityRaw: match[2] ?? null,
    districtRaw: match[3]?.trim() ?? null,
  };
}

// -- Helpers ------------------------------------------------------------------

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Normalize Austrian decimal format: "65,12" -> "65.12", "1.250,50" -> "1250.50"
 */
function normalizeDecimal(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.includes(',')) {
    return trimmed.replace(/\./g, '').replace(',', '.');
  }
  return trimmed;
}

function mapOperationType(angebot: string | null, url: string): string {
  if (angebot) {
    const lower = angebot.toLowerCase();
    if (lower === 'kauf' || lower === 'eigentum') return 'sale';
    if (lower === 'miete' || lower === 'miet') return 'rent';
  }
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('kauf') || lowerUrl.includes('eigentum')) return 'sale';
  if (lowerUrl.includes('miet') || lowerUrl.includes('miete')) return 'rent';
  return 'sale';
}
