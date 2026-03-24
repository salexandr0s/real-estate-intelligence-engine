import type { DetailCapture, SourceAvailability } from '@immoradar/contracts';
import type { WillhabenDetailDTO, WillhabenAdvertDetails } from './dto.js';
import { getAttr, getAllAttrValues } from './dto.js';

/**
 * Willhaben detail pages serve data via __NEXT_DATA__ JSON.
 * Structure: props.pageProps.advertDetails with attributes.attribute[] (name/values pairs).
 */

export function parseDetailPage(
  html: string,
  url: string,
  sourceCode: string,
  parserVersion: number,
): DetailCapture<WillhabenDetailDTO> {
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);

  let adDetails: WillhabenAdvertDetails | null = null;
  if (nextDataMatch?.[1]) {
    try {
      const data = JSON.parse(nextDataMatch[1]) as {
        props?: { pageProps?: { advertDetails?: WillhabenAdvertDetails } };
      };
      adDetails = data.props?.pageProps?.advertDetails ?? null;
    } catch {
      // parse failed, fall through
    }
  }

  if (!adDetails) {
    return buildFailedCapture(url, sourceCode, parserVersion);
  }

  const attrs = adDetails.attributes?.attribute ?? [];
  const willhabenId = adDetails.id ?? extractIdFromUrl(url) ?? '';
  const availability = detectDetailAvailabilityFromData(adDetails);
  const coords = getAttr(attrs, 'COORDINATES');
  const [lat, lon] = coords?.split(',').map((s) => s.trim()) ?? [];

  const streetRaw = getAttr(attrs, 'LOCATION/ADDRESS_1');
  const addressDisplay = getAttr(attrs, 'LOCATION/ADDRESS_2');
  const city = getAttr(attrs, 'LOCATION/ADDRESS_3') ?? getAttr(attrs, 'LOCATION/ADDRESS_4');
  const district = extractDistrictFromAddress(addressDisplay);

  // Derive postal code from district number (CONTACT/ADDRESS_POSTCODE is the agent's, not the property's)
  const districtNo = district ? parseInt(district, 10) : null;
  const postalCode =
    districtNo != null && districtNo >= 1 && districtNo <= 23
      ? `1${String(districtNo).padStart(2, '0')}0`
      : getAttr(attrs, 'CONTACT/ADDRESS_POSTCODE');

  // Extract images from advertImageList
  const images: string[] = [];
  if (adDetails.advertImageList?.advertImage) {
    for (const img of adDetails.advertImageList.advertImage) {
      const imgUrl = img.referenceImageUrl ?? img.mainImageUrl;
      if (imgUrl) images.push(imgUrl);
    }
  }
  // Fallback: ALL_IMAGE_URLS attribute
  if (images.length === 0) {
    const allImgs = getAttr(attrs, 'ALL_IMAGE_URLS');
    if (allImgs) {
      for (const seg of allImgs.split(';')) {
        if (seg.trim()) images.push(`https://cache.willhaben.at/mmo/${seg.trim()}`);
      }
    }
  }

  const description = getAttr(attrs, 'DESCRIPTION') ?? getAttr(attrs, 'BODY_DYN');

  // Handle multiple FREE_AREA entries
  const freeAreaTypes = getAllAttrValues(attrs, 'FREE_AREA/FREE_AREA_TYPE');
  const freeAreaAreas = getAllAttrValues(attrs, 'FREE_AREA/FREE_AREA_AREA');
  const freeAreas = parseFreeAreas(freeAreaTypes, freeAreaAreas);

  const payload: WillhabenDetailDTO = {
    willhabenId,
    titleRaw: getAttr(attrs, 'HEADING') ?? adDetails.description ?? null,
    descriptionRaw: description ? stripHtml(description) : null,
    priceRaw: getAttr(attrs, 'ESTATE_PRICE/PRICE_SUGGESTION') ?? getAttr(attrs, 'PRICE'),
    livingAreaRaw: normalizeDecimal(getAttr(attrs, 'ESTATE_SIZE/LIVING_AREA')),
    usableAreaRaw: normalizeDecimal(
      getAttr(attrs, 'ESTATE_SIZE/USEABLE_AREA') ?? getAttr(attrs, 'ESTATE_SIZE'),
    ),
    roomsRaw: getAttr(attrs, 'NO_OF_ROOMS') ?? getAttr(attrs, 'NUMBER_OF_ROOMS'),
    streetRaw: streetRaw,
    addressRaw: addressDisplay,
    postalCodeRaw: postalCode,
    districtRaw: district,
    cityRaw: city,
    federalStateRaw: getAttr(attrs, 'STATE'),
    floorRaw: getAttr(attrs, 'FLOOR'),
    yearBuiltRaw: getAttr(attrs, 'CONSTRUCTION_YEAR'),
    propertyTypeRaw: getAttr(attrs, 'PROPERTY_TYPE'),
    operationTypeRaw: mapOperationType(getAttr(attrs, 'OWNAGETYPE')),
    statusRaw: availability.status === 'available' ? 'active' : availability.status,
    heatingTypeRaw: getAttr(attrs, 'HEATING'),
    conditionRaw: getAttr(attrs, 'BUILDING_CONDITION'),
    energyCertificateRaw: getAttr(attrs, 'ENERGY_HWB_CLASS'),
    balconyAreaRaw: freeAreas.balcony,
    terraceAreaRaw: freeAreas.terrace,
    gardenAreaRaw: freeAreas.garden,
    commissionRaw: getAttr(attrs, 'COMMISSION'),
    operatingCostRaw: getAttr(attrs, 'OPERATING_COST'),
    reserveFundRaw: null,
    latRaw: lat ?? null,
    lonRaw: lon ?? null,
    attributesRaw: Object.fromEntries(attrs.map((a) => [a.name, a.values[0] ?? null])),
    mediaRaw: [],
    images,
    contactName: getAttr(attrs, 'CONTACT/NAME') ?? getAttr(attrs, 'CONTACT/COMPANYNAME') ?? null,
    contactPhone: getAttr(attrs, 'CONTACT/PHONE') ?? null,
  };

  // Extract document/attachment URLs (best-effort, never fails the capture)
  const attachmentUrls = extractAttachmentUrls(html);

  return {
    sourceCode,
    sourceListingKeyCandidate: willhabenId,
    externalId: willhabenId,
    canonicalUrl: url.split('?')[0] ?? url,
    detailUrl: url,
    extractedAt: new Date().toISOString(),
    payload,
    parserVersion,
    extractionStatus: payload.titleRaw ? 'captured' : 'parse_failed',
    ...(attachmentUrls.length > 0 ? { attachmentUrls } : {}),
  };
}

function buildFailedCapture(
  url: string,
  sourceCode: string,
  parserVersion: number,
): DetailCapture<WillhabenDetailDTO> {
  return {
    sourceCode,
    sourceListingKeyCandidate: extractIdFromUrl(url) ?? '',
    externalId: extractIdFromUrl(url),
    canonicalUrl: url.split('?')[0] ?? url,
    detailUrl: url,
    extractedAt: new Date().toISOString(),
    payload: {
      willhabenId: extractIdFromUrl(url) ?? '',
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
      contactPhone: null,
    },
    parserVersion,
    extractionStatus: 'parse_failed',
  };
}

export function detectDetailAvailability(html: string): SourceAvailability {
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch?.[1]) {
    try {
      const data = JSON.parse(nextDataMatch[1]) as {
        props?: { pageProps?: { advertDetails?: WillhabenAdvertDetails; is404?: boolean } };
      };
      if (data.props?.pageProps?.is404) return { status: 'not_found' };
      const ad = data.props?.pageProps?.advertDetails;
      if (ad) return detectDetailAvailabilityFromData(ad);
    } catch {
      // fall through
    }
  }

  if (/captcha|blocked|challenge/i.test(html)) return { status: 'blocked' };
  return { status: 'unknown' };
}

function detectDetailAvailabilityFromData(ad: WillhabenAdvertDetails): SourceAvailability {
  const statusId = ad.advertStatus?.statusId;
  const statusCode = ad.advertStatus?.id?.toLowerCase();

  if (statusCode === 'active' || statusId === 50) return { status: 'available' };
  if (statusCode === 'sold' || statusCode === 'verkauft') return { status: 'sold' };
  if (statusCode === 'reserved' || statusCode === 'reserviert') return { status: 'reserved' };
  if (statusCode === 'inactive' || statusCode === 'removed' || statusCode === 'deleted') {
    return { status: 'removed' };
  }

  return { status: 'available' };
}

function extractIdFromUrl(url: string): string | null {
  const m = url.match(/-(\d+)\/?$/);
  return m?.[1] ?? url.match(/\/(\d+)\/?$/)?.[1] ?? null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize Austrian decimal format to standard format.
 * Handles: "58,4" → "58.4", "1.250,50" → "1250.50", "86" → "86"
 */
function normalizeDecimal(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.includes(',')) {
    // Austrian/German format: dots are thousands separators, comma is decimal
    // Remove dots (thousands), replace comma with dot (decimal)
    return trimmed.replace(/\./g, '').replace(',', '.');
  }
  return trimmed;
}

function mapOperationType(ownageType: string | null): string {
  if (!ownageType) return 'sale';
  const lower = ownageType.toLowerCase();
  if (lower.includes('kauf') || lower.includes('eigentum')) return 'sale';
  if (lower.includes('miet')) return 'rent';
  return 'sale';
}

function extractDistrictFromAddress(address: string | null): string | null {
  if (!address) return null;
  const m = address.match(/(\d{1,2})\.\s*Bezirk/i);
  return m?.[1] ? `${m[1]}. Bezirk` : null;
}

/**
 * Parse multiple FREE_AREA entries into typed free area values.
 * Willhaben can have multiple FREE_AREA/FREE_AREA_TYPE attributes
 * (e.g., "Balkon", "Terrasse", "Garten") each with a corresponding area.
 */
function parseFreeAreas(
  types: string[],
  areas: string[],
): { balcony: string | null; terrace: string | null; garden: string | null } {
  const result: { balcony: string | null; terrace: string | null; garden: string | null } = {
    balcony: null,
    terrace: null,
    garden: null,
  };

  for (let i = 0; i < types.length; i++) {
    const type = types[i]?.toLowerCase() ?? '';
    const area = areas[i] ?? null;
    if (type.includes('balkon') || type.includes('loggia')) {
      result.balcony = result.balcony ?? area;
    } else if (type.includes('terrasse') || type.includes('dachterrasse')) {
      result.terrace = result.terrace ?? area;
    } else if (type.includes('garten')) {
      result.garden = result.garden ?? area;
    }
  }

  // Also check combined FREE_AREA/FREE_AREA_TYPE_AND_AREA format
  return result;
}

/**
 * Extract document/PDF attachment URLs from the HTML.
 * Looks for anchor tags linking to PDFs, downloads, or document endpoints.
 * Best-effort: returns empty array on any error.
 */
function extractAttachmentUrls(
  html: string,
): Array<{ url: string; label?: string; type?: string }> {
  try {
    const results: Array<{ url: string; label?: string; type?: string }> = [];
    const seen = new Set<string>();

    // Match <a> tags whose href points to PDF/document resources
    const anchorRe = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = anchorRe.exec(html)) !== null) {
      const href = match[1];
      const innerHtml = match[2];
      if (!href) continue;

      const hrefLower = href.toLowerCase();
      const isPdf =
        hrefLower.endsWith('.pdf') ||
        hrefLower.includes('/download/') ||
        hrefLower.includes('/document/') ||
        hrefLower.includes('/dokument/') ||
        hrefLower.includes('/expose/') ||
        hrefLower.includes('filetype=pdf');

      if (!isPdf) continue;

      // Resolve relative URLs
      const resolvedUrl = href.startsWith('http')
        ? href
        : `https://www.willhaben.at${href.startsWith('/') ? '' : '/'}${href}`;

      if (seen.has(resolvedUrl)) continue;
      seen.add(resolvedUrl);

      const label = innerHtml ? stripHtml(innerHtml).substring(0, 200) || undefined : undefined;

      const type = hrefLower.endsWith('.pdf') ? 'pdf' : 'document';

      results.push({ url: resolvedUrl, ...(label ? { label } : {}), type });
    }

    return results;
  } catch {
    return [];
  }
}
