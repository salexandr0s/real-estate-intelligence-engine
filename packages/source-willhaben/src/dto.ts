import type { SourceRawListingBase } from '@rei/contracts';

// ── Shared willhaben __NEXT_DATA__ types ─────────────────────────────────────

export interface WillhabenAttribute {
  name: string;
  values: string[];
}

export interface WillhabenAdSummary {
  id: string;
  description: string;
  attributes: { attribute: WillhabenAttribute[] };
  contextLinkList?: { contextLink: Array<{ id: string; uri: string; relativePath: string }> };
}

export interface WillhabenSearchResult {
  rowsFound: number;
  rowsReturned: number;
  pageRequested: number;
  advertSummaryList: { advertSummary: WillhabenAdSummary[] };
}

export interface WillhabenAdvertDetails {
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

/** Extract the first value of a named attribute from the attribute array. */
export function getAttr(attrs: WillhabenAttribute[], name: string): string | null {
  return attrs.find((a) => a.name === name)?.values?.[0] ?? null;
}

/** Extract ALL values across all attributes matching the given name. */
export function getAllAttrValues(attrs: WillhabenAttribute[], name: string): string[] {
  return attrs.filter((a) => a.name === name).flatMap((a) => a.values);
}

// ── Discovery / Detail DTOs ──────────────────────────────────────────────────

export interface WillhabenDiscoveryItem {
  listingId: string;
  detailUrl: string;
  titleRaw: string | null;
  priceRaw: string | null;
  locationRaw: string | null;
  roomsRaw: string | null;
  areaRaw: string | null;
}

export interface WillhabenDetailDTO extends SourceRawListingBase {
  willhabenId: string;
  images: string[];
  contactName: string | null;
  contactPhone: string | null;
}
