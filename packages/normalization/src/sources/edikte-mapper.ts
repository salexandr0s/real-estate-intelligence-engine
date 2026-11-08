import type {
  NormalizationContext,
  NormalizationResult,
  SourceRawListingBase,
} from '@immoradar/contracts';
import { BaseSourceMapper } from './base-mapper.js';
import { parseEurPrice } from '../canonical/coerce.js';

/**
 * Ediktsdatei (Zwangsversteigerung) raw listing fields.
 * Government auction listings from edikte.justiz.gv.at.
 */
export interface EdikteRawListing extends SourceRawListingBase {
  /** Edikt document ID */
  ediktId?: string | null;
  /** Court handling the auction */
  courtName?: string | null;
  /** Case number (Aktenzeichen) */
  caseNumber?: string | null;
  /** Auction date as the edict prints it (e.g., "15.4.2026 um 09:30 Uhr") */
  auctionDateRaw?: string | null;
  /** Appraised value as raw string (e.g., "EUR 250.000,00") */
  appraisedValueRaw?: string | null;
  /** Minimum bid as raw string */
  minimumBidRaw?: string | null;
  /** Viewing appointments as the edict prints them (e.g., "14.4.2026, 15:30 Uhr") */
  viewingDatesRaw?: string[] | null;
  /** Source-reported property category (e.g., "Eigentumswohnung") */
  sourcePropertyCategory?: string | null;
}

/** The first date in "15.4.2026 um 09:30 Uhr" or "05.05.2026, 15.30 bis 16:30 Uhr", with its time. */
const PRINTED_DATE =
  /(\d{1,2})\.(\d{1,2})\.(\d{4})(?:,?\s*(?:(?:um|von|ab)\s+)?(\d{1,2})[:.](\d{2})(?![.\d]))?/;

const viennaOffset = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Vienna',
  timeZoneName: 'longOffset',
});

/**
 * Ediktsdatei (Austrian court auction) normalizer.
 * Enriches base normalization with auction-specific metadata.
 */
export class EdikteMapper extends BaseSourceMapper {
  override readonly normalizationVersion = 2;

  constructor() {
    super('edikte');
  }

  override normalize(
    rawPayload: EdikteRawListing,
    context: NormalizationContext,
  ): NormalizationResult {
    const result = super.normalize(rawPayload, context);

    if (!result.success || result.listing == null) {
      return result;
    }

    // Parse auction-specific price fields
    const appraisedResult = parseEurPrice(rawPayload.appraisedValueRaw);
    const minimumBidResult = parseEurPrice(rawPayload.minimumBidRaw);

    // Enrich normalizedPayload with auction metadata
    result.listing.normalizedPayload = {
      ...result.listing.normalizedPayload,
      isAuction: true,
      ediktId: rawPayload.ediktId ?? null,
      courtName: rawPayload.courtName ?? null,
      caseNumber: rawPayload.caseNumber ?? null,
      auctionDate: toViennaIso(rawPayload.auctionDateRaw),
      appraisedValueEurCents: appraisedResult.value,
      minimumBidEurCents: minimumBidResult.value,
      viewingDates: (rawPayload.viewingDatesRaw ?? []).flatMap((raw) => toViennaIso(raw) ?? []),
      sourcePropertyCategory: rawPayload.sourcePropertyCategory ?? null,
    };

    // Auctions are always sales
    result.listing.operationType = 'sale';

    // Mark as forced auction subtype
    result.listing.propertySubtype = 'zwangsversteigerung';

    // Fall back to appraised value if no list price was parsed
    if (result.listing.listPriceEurCents == null && appraisedResult.value != null) {
      result.listing.listPriceEurCents = appraisedResult.value;
    }

    return result;
  }
}

/**
 * A date printed in Vienna, as ISO 8601: "15.4.2026 um 09:30 Uhr" -> "2026-04-15T09:30:00+02:00".
 * A date printed without a time stays a calendar date, "2026-04-15".
 */
function toViennaIso(raw: string | null | undefined): string | null {
  const m = raw?.match(PRINTED_DATE);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const calendarDay = new Date(Date.UTC(Number(m[3]), month - 1, day));
  if (calendarDay.getUTCMonth() !== month - 1 || calendarDay.getUTCDate() !== day) return null;

  const date = `${m[3]}-${pad(month)}-${pad(day)}`;
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (!m[4] || !m[5] || hour > 23 || minute > 59) return date;

  const wallClock = `${date}T${pad(hour)}:${pad(minute)}:00`;
  // Read as UTC, the wall-clock time is at most two hours off the real instant, and
  // Vienna changes its offset only at night, so both instants share one offset.
  const zone =
    viennaOffset
      .formatToParts(Date.parse(`${wallClock}Z`))
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  // "GMT+02:00" -> "+02:00"; a bare "GMT" is UTC.
  return `${wallClock}${zone === 'GMT' ? 'Z' : zone.slice(3)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
