import type { DetailCapture, SourceAvailability } from '@rei/contracts';
import type { WillhabenDetailDTO } from './dto.js';

/**
 * Willhaben detail pages serve data via __NEXT_DATA__ JSON.
 * Structure: props.pageProps.advertDetails with attributes.attribute[] (name/values pairs).
 */

interface WillhabenAttribute {
  name: string;
  values: string[];
}

interface WillhabenAdvertDetails {
  id: string;
  description: string;
  publishedDate?: string;
  firstPublishedDate?: string;
  advertStatus?: { id: string; statusId: number };
  attributes: { attribute: WillhabenAttribute[] };
  advertImageList?: { advertImage: Array<{ mainImageUrl?: string; referenceImageUrl?: string }> };
  advertContactDetails?: { contactName?: string; contactPhone?: string };
  advertAddressDetails?: { address?: string; postcode?: string; city?: string };
}

function getAttr(attrs: WillhabenAttribute[], name: string): string | null {
  return attrs.find((a) => a.name === name)?.values?.[0] ?? null;
}

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

  const addressDisplay = getAttr(attrs, 'LOCATION/ADDRESS_2');
  const city = getAttr(attrs, 'LOCATION/ADDRESS_3') ?? getAttr(attrs, 'LOCATION/ADDRESS_4');
  const postalCode = getAttr(attrs, 'CONTACT/ADDRESS_POSTCODE');
  const district = extractDistrictFromAddress(addressDisplay);

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
  const freeAreaType = getAttr(attrs, 'FREE_AREA/FREE_AREA_TYPE');
  const freeAreaArea = getAttr(attrs, 'FREE_AREA/FREE_AREA_AREA');

  const payload: WillhabenDetailDTO = {
    willhabenId,
    titleRaw: getAttr(attrs, 'HEADING') ?? adDetails.description ?? null,
    descriptionRaw: description ? stripHtml(description) : null,
    priceRaw: getAttr(attrs, 'ESTATE_PRICE/PRICE_SUGGESTION') ?? getAttr(attrs, 'PRICE'),
    livingAreaRaw: normalizeDecimal(getAttr(attrs, 'ESTATE_SIZE/LIVING_AREA')),
    usableAreaRaw: normalizeDecimal(getAttr(attrs, 'ESTATE_SIZE/USEABLE_AREA') ?? getAttr(attrs, 'ESTATE_SIZE')),
    roomsRaw: getAttr(attrs, 'NO_OF_ROOMS') ?? getAttr(attrs, 'NUMBER_OF_ROOMS'),
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
    balconyAreaRaw: freeAreaType?.includes('Balkon') ? freeAreaArea : null,
    terraceAreaRaw: freeAreaType?.includes('Terrasse') ? freeAreaArea : null,
    gardenAreaRaw: freeAreaType?.includes('Garten') ? freeAreaArea : null,
    commissionRaw: getAttr(attrs, 'COMMISSION'),
    operatingCostRaw: getAttr(attrs, 'OPERATING_COST'),
    reserveFundRaw: null,
    latRaw: lat ?? null,
    lonRaw: lon ?? null,
    attributesRaw: Object.fromEntries(attrs.map((a) => [a.name, a.values[0] ?? null])),
    mediaRaw: [],
    images,
    contactName:
      getAttr(attrs, 'CONTACT/NAME') ?? getAttr(attrs, 'CONTACT/COMPANYNAME') ?? null,
    contactPhone: getAttr(attrs, 'CONTACT/PHONE') ?? null,
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
    extractionStatus: payload.titleRaw ? 'captured' : 'parse_failed',
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
    canonicalUrl: url.split('?')[0]!,
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
      operationTypeRaw: 'sale',
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
  // Check __NEXT_DATA__ first
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
      // fall through to HTML-based detection
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
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeDecimal(value: string | null): string | null {
  if (!value) return null;
  // Austrian format uses comma as decimal separator
  return value.replace(',', '.');
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
  // Pattern: "Wien, 19. Bezirk, Döbling"
  const m = address.match(/(\d{1,2})\.\s*Bezirk/i);
  return m?.[1] ? `${m[1]}. Bezirk` : null;
}
