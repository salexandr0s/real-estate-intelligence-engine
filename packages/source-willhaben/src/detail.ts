import type { DetailCapture, SourceAvailability } from '@rei/contracts';
import type { WillhabenDetailDTO } from './dto.js';

/**
 * Parses a detail page HTML to extract listing data.
 * Extraction priority: JSON-LD > structured attributes > DOM text.
 */
export function parseDetailPage(
  html: string,
  url: string,
  sourceCode: string,
  parserVersion: number,
): DetailCapture<WillhabenDetailDTO> {
  // 1. Try JSON-LD first
  const jsonLd = extractJsonLd(html);

  // 2. Extract from structured attributes
  const attrs = extractAttributes(html);

  // 3. Extract text fields
  const title = extractField(html, /data-testid="ad-detail-header"[^>]*>(.*?)<\/h1>/s)
    ?? extractField(html, /<h1[^>]*class="ad-title"[^>]*>(.*?)<\/h1>/s);

  const description = extractField(html, /data-testid="ad-description"[^>]*>([\s\S]*?)<\/div>/);
  const price = extractField(html, /data-testid="price-value"[^>]*>(.*?)<\//) ?? jsonLd?.price;
  const address = extractField(html, /data-testid="ad-address"[^>]*>(.*?)<\//);

  // Extract ad ID from URL or page
  const idMatch = url.match(/\/(\d+)\/?$/);
  const willhabenId = idMatch?.[1] ?? extractField(html, /data-ad-id="(\d+)"/) ?? '';

  const availability = detectDetailAvailability(html);

  const payload: WillhabenDetailDTO = {
    willhabenId,
    titleRaw: title,
    descriptionRaw: description,
    priceRaw: price ?? attrs.get('Kaufpreis') ?? attrs.get('Preis'),
    livingAreaRaw: attrs.get('Wohnfläche') ?? attrs.get('Living area'),
    usableAreaRaw: attrs.get('Nutzfläche') ?? attrs.get('Usable area'),
    roomsRaw: attrs.get('Zimmer') ?? attrs.get('Rooms'),
    addressRaw: address,
    postalCodeRaw: extractPostalCode(address),
    districtRaw: extractDistrict(address),
    cityRaw: extractCity(address),
    floorRaw: attrs.get('Stockwerk') ?? attrs.get('Floor'),
    yearBuiltRaw: attrs.get('Baujahr') ?? attrs.get('Year built'),
    propertyTypeRaw: attrs.get('Objekttyp') ?? attrs.get('Type') ?? jsonLd?.propertyType,
    operationTypeRaw: 'sale',
    statusRaw: availability.status === 'available' ? 'active' : availability.status,
    heatingTypeRaw: attrs.get('Heizung') ?? attrs.get('Heating'),
    conditionRaw: attrs.get('Zustand') ?? attrs.get('Condition'),
    energyCertificateRaw: attrs.get('Energieausweis') ?? attrs.get('Energy certificate'),
    balconyAreaRaw: attrs.get('Balkonfläche'),
    terraceAreaRaw: attrs.get('Terrassenfläche'),
    gardenAreaRaw: attrs.get('Gartenfläche'),
    commissionRaw: attrs.get('Provision'),
    operatingCostRaw: attrs.get('Betriebskosten') ?? attrs.get('Operating costs'),
    reserveFundRaw: attrs.get('Rücklage'),
    attributesRaw: Object.fromEntries(attrs),
    mediaRaw: [],
    images: extractImages(html),
    contactName: extractField(html, /data-testid="contact-name"[^>]*>(.*?)<\//),
    contactPhone: null,
  };

  return {
    sourceCode,
    sourceListingKeyCandidate: willhabenId,
    externalId: willhabenId,
    canonicalUrl: url.split('?')[0]!,
    detailUrl: url,
    extractedAt: new Date().toISOString(),
    payload,
    parserVersion,
    extractionStatus: title ? 'captured' : 'parse_failed',
  };
}

export function detectDetailAvailability(html: string): SourceAvailability {
  if (/data-testid="ad-not-available"|class="ad-removed"|class="ad-expired"/.test(html)) {
    return { status: 'removed' };
  }
  if (/data-testid="ad-sold"|class="ad-sold-marker"|verkauft|sold/i.test(html)) {
    return { status: 'sold' };
  }
  if (/reserviert|reserved/i.test(html)) {
    return { status: 'reserved' };
  }
  if (/captcha|blocked|challenge/i.test(html)) {
    return { status: 'blocked' };
  }
  return { status: 'available' };
}

function extractField(html: string, pattern: RegExp): string | null {
  const m = html.match(pattern);
  return m?.[1]?.replace(/<[^>]+>/g, '').trim() ?? null;
}

function extractAttributes(html: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const attrPattern = /class="attribute-label[^"]*"[^>]*>(.*?)<\/[^>]+>\s*<[^>]*class="attribute-value[^"]*"[^>]*>(.*?)<\//gs;
  let match;
  while ((match = attrPattern.exec(html)) !== null) {
    const label = match[1]!.replace(/<[^>]+>/g, '').trim();
    const value = match[2]!.replace(/<[^>]+>/g, '').trim();
    if (label && value) attrs.set(label, value);
  }
  return attrs;
}

function extractJsonLd(html: string): { price?: string; propertyType?: string } | null {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!match?.[1]) return null;
  try {
    const data = JSON.parse(match[1]) as Record<string, unknown>;
    return {
      price: (data['price'] ?? (data['offers'] as Record<string, unknown>)?.['price']) as string | undefined,
      propertyType: data['@type'] as string | undefined,
    };
  } catch {
    return null;
  }
}

function extractPostalCode(address: string | null): string | null {
  if (!address) return null;
  const m = address.match(/\b(\d{4})\b/);
  return m?.[1] ?? null;
}

function extractDistrict(address: string | null): string | null {
  if (!address) return null;
  const m = address.match(/(\d{1,2})\.\s*Bezirk/i);
  return m?.[1] ? `${m[1]}. Bezirk` : null;
}

function extractCity(address: string | null): string | null {
  if (!address) return null;
  if (/wien|vienna/i.test(address)) return 'Wien';
  return null;
}

function extractImages(html: string): string[] {
  const images: string[] = [];
  const imgPattern = /data-testid="image-gallery"[\s\S]*?src="([^"]+)"/g;
  let match;
  while ((match = imgPattern.exec(html)) !== null) {
    if (match[1]) images.push(match[1]);
  }
  return images;
}
