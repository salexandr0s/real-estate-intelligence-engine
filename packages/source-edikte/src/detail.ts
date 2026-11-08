import type { DetailCapture, SourceAvailability } from '@immoradar/contracts';
import { headlineText } from '@immoradar/scraper-core';
import type { EdikteDetailDTO } from './dto.js';
import { BASE_URL } from './constants.js';

/**
 * Parses an edict detail page from its HTML alone. Attached PDFs are only listed,
 * in attachmentUrls, for the documents pipeline to fetch and read.
 */
export function parseDetailPage(
  html: string,
  canonicalUrl: string,
): Omit<
  DetailCapture<EdikteDetailDTO>,
  'sourceCode' | 'extractedAt' | 'parserVersion' | 'extractionStatus'
> {
  const fields = readFields(html);
  const caseNumber = extractCaseNumber(fields, html);
  const locationInfo = extractLocation(fields);
  const propertyCategory = extractPropertyCategory(fields);
  const appraisedValueRaw = leadingNumber(fields.get('Schätzwert'));
  const attachmentPdfUrls = extractPdfAttachmentUrls(html);
  const ediktId = extractEdiktId(canonicalUrl, html);

  return {
    canonicalUrl,
    detailUrl: canonicalUrl,
    externalId: ediktId,
    payload: {
      ediktId,
      courtName: extractCourtName(fields, html),
      caseNumber,
      auctionDateRaw: extractAuctionDate(fields),
      appraisedValueRaw,
      minimumBidRaw: leadingNumber(fields.get('Geringstes Gebot')),
      viewingDatesRaw: extractViewingDates(fields),
      legalNoticesRaw: extractLegalNotices(fields),
      attachmentPdfUrls,
      publicationDate: extractPublicationDate(fields),
      sourcePropertyCategory: propertyCategory,
      // SourceRawListingBase fields
      titleRaw: buildTitle(propertyCategory, locationInfo.addressRaw, caseNumber),
      priceRaw: appraisedValueRaw,
      livingAreaRaw: leadingNumber(fields.get('Objektgröße')),
      // Rooms and year built appear only in the attached appraisal.
      roomsRaw: null,
      yearBuiltRaw: null,
      addressRaw: locationInfo.addressRaw,
      postalCodeRaw: locationInfo.postalCodeRaw,
      cityRaw: locationInfo.cityRaw ?? 'Wien',
      federalStateRaw: 'Wien',
      propertyTypeRaw: propertyCategory,
      operationTypeRaw: 'sale',
    },
    attachmentUrls: attachmentPdfUrls.map((a) => ({
      url: a.url,
      label: a.label,
      type: 'application/pdf',
    })),
  };
}

function buildTitle(
  category: string | null,
  address: string | null,
  caseNumber: string | null,
): string | null {
  const parts = [category, address].filter(Boolean);
  if (parts.length > 0) return parts.join(' – ');
  return caseNumber ? `Zwangsversteigerung ${caseNumber}` : null;
}

// ── HTML extraction helpers ────────────────────────────────────────────

/**
 * Domino renders each field as a label span followed by a value paragraph:
 * <span class="col-sm-3 text-right">Schätzwert:</span><p class="col-sm-9">382.000,00&nbsp;EUR</p>
 * Labels are keyed without their colon, values kept as plain text.
 */
function readFields(html: string): Map<string, string> {
  const fields = new Map<string, string>();
  const row =
    /<span class="col-sm-3[^"]*">([\s\S]*?)<\/span>\s*<p class="col-sm-9[^"]*">([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = row.exec(html)) !== null) {
    const label = toText(m[1] ?? '').replace(/:$/, '');
    const value = toText(m[2] ?? '');
    if (label && value && !fields.has(label)) fields.set(label, value);
  }
  return fields;
}

function toText(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "382.000,00 EUR" -> "382.000,00" and "85,22 m²" -> "85,22", in the page's number format. */
function leadingNumber(value: string | undefined): string | null {
  return value?.match(/\d[\d.,]*/)?.[0].replace(/[.,]$/, '') ?? null;
}

function extractEdiktId(url: string, html: string): string {
  // Try UNID from URL
  const unidMatch = url.match(/\/([0-9A-Fa-f]{32})/);
  if (unidMatch?.[1]) return unidMatch[1];

  // Try document ID from HTML meta or hidden fields
  const docIdMatch = html.match(/name="documentId"\s+value="([^"]+)"/i);
  if (docIdMatch?.[1]) return docIdMatch[1];

  // Fallback: hash the URL path
  const path = new URL(url).pathname;
  return path.replace(/\//g, '_').replace(/^_/, '');
}

function extractCourtName(fields: Map<string, string>, html: string): string | null {
  // "Dienststelle: BG Donaustadt (027)"
  const office = fields.get('Dienststelle');
  if (office) return office;

  // Fallback: look for court names in title or text
  const patterns = [
    /(?:Bezirksgericht|BG)\s+([^<,;\n]{3,50})/i,
    /(?:Landesgericht|LG)\s+(?:für\s+)?([^<,;\n]{3,50})/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[0].trim();
  }
  return null;
}

const CASE_NUMBER = /\d{1,3}\s+E\s+\d+\/\d{2}[a-z]?(?:-\d+)?/i;

function extractCaseNumber(fields: Map<string, string>, html: string): string | null {
  // "Aktenzeichen: 68 E 33/25a". The page title carries it too.
  const m = fields.get('Aktenzeichen')?.match(CASE_NUMBER) ?? html.match(CASE_NUMBER);
  return m ? m[0].trim() : null;
}

/**
 * "am 15.4.2026 um 09:30 Uhr" -> "15.4.2026 um 09:30 Uhr". Only the labelled rows
 * count, because the free text also names viewing dates and cancelled sittings.
 * A notice that a sitting is cancelled lists its date under "Termin".
 */
function extractAuctionDate(fields: Map<string, string>): string | null {
  const value = fields.get('Versteigerungstermin') ?? fields.get('Termin');
  return (
    value?.match(/\d{1,2}\.\d{1,2}\.\d{4}(?:\s+um\s+\d{1,2}[:.]\d{2}(?:\s*Uhr)?)?/)?.[0] ?? null
  );
}

function extractLocation(fields: Map<string, string>): {
  addressRaw: string | null;
  postalCodeRaw: string | null;
  cityRaw: string | null;
} {
  // "PLZ/Ort: 1220 Wien". The free text quotes other offices' addresses, so it is not searched.
  const m = fields.get('PLZ/Ort')?.match(/^(\d{4})\s+(.+)$/);
  const postalCode = m?.[1];
  const city = m?.[2];
  if (!postalCode || !city) return { addressRaw: null, postalCodeRaw: null, cityRaw: null };
  return { addressRaw: `${postalCode} ${city}`, postalCodeRaw: postalCode, cityRaw: city };
}

/**
 * "14.4.2026, 15:30 Uhr", "20.04.2026 um 11:00 Uhr" or "05.05.2026, 15.30 bis 16:30 Uhr".
 * A time may not run on into a date, so "14.4.2026, 15.04.2026" gives two dates.
 */
const VIEWING_DATE =
  /\d{1,2}\.\d{1,2}\.\d{4}(?:,?\s*(?:(?:um|von|ab)\s+)?\d{1,2}[:.]\d{2}(?![.\d])(?:\s*(?:-|–|bis)\s*\d{1,2}[:.]\d{2}(?![.\d]))?(?:\s*Uhr)?)?/g;

/** The appointments in "Besichtigungszeit". The rest of that row names meeting points and contacts. */
function extractViewingDates(fields: Map<string, string>): string[] {
  return fields.get('Besichtigungszeit')?.match(VIEWING_DATE) ?? [];
}

/** The "Sonstiges" and "Sonstige Hinweise" rows, one per line. */
function extractLegalNotices(fields: Map<string, string>): string | null {
  const notices = ['Sonstiges', 'Sonstige Hinweise'].flatMap((label) => fields.get(label) ?? []);
  return notices.length > 0 ? notices.join('\n') : null;
}

function extractPropertyCategory(fields: Map<string, string>): string | null {
  // "Kategorie(n): Reihenhaus", else "wegen: Zwangsversteigerung von Wohnungseigentum"
  return (
    fields.get('Kategorie(n)') ??
    fields.get('wegen')?.match(/^Zwangsversteigerung\s+von\s+(.+)$/i)?.[1] ??
    null
  );
}

/**
 * "Bekannt gemacht am: 02.03.2026". An edict changed since shows "Letzte Änderung am"
 * instead, which dates the change, so that row is not read as the publication date.
 */
function extractPublicationDate(fields: Map<string, string>): string | null {
  return fields.get('Bekannt gemacht am')?.match(/\d{1,2}\.\d{1,2}\.\d{4}/)?.[0] ?? null;
}

// ── Attachments ────────────────────────────────────────────────────────

function extractPdfAttachmentUrls(html: string): Array<{ url: string; label: string }> {
  const pdfs: Array<{ url: string; label: string }> = [];
  const seen = new Set<string>();

  // Domino attachment pattern: /0/<UNID>/$file/<filename>
  // Match both .pdf and .jpg (photos/floorplans)
  const filePattern = /href="([^"]*\/\$file\/[^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = filePattern.exec(html)) !== null) {
    const href = m[1] ?? '';
    const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
    if (seen.has(url)) continue;
    seen.add(url);

    // Extract filename as label
    const filenameMatch = href.match(/\/([^/]+\.pdf)$/i);
    const label = filenameMatch?.[1] ?? 'Dokument.pdf';
    pdfs.push({ url, label });
  }

  // Only include PDF files in the attachment list (not images)
  return pdfs.filter((p) => p.url.toLowerCase().endsWith('.pdf'));
}

// ── Availability detection ─────────────────────────────────────────────

const REMOVED_PATTERNS = [/nicht mehr verfügbar/i, /gelöscht/i, /archiviert/i, /aufgehoben/i];

// The award without a higher bid and the distribution of the proceeds both follow a sale.
const SOLD_EDICT = /^(?:Zuschlag ohne Überbot|Meistbotsverteilung)\b/m;
const CANCELLED_EDICT = /^Entfall des Termins\b/m;

const viennaDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Vienna',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Detects whether a forced auction listing is still active. An edict that follows the
 * sale counts as sold and one that cancels the sitting as removed. An auction counts as
 * sold once its day has passed in Vienna.
 */
export function detectDetailAvailability(html: string): SourceAvailability {
  if (!html) return { status: 'not_found' };

  const fields = readFields(html);
  // Live edicts mention deleted pledges and cancelled earlier sittings, so the
  // removal wording only counts on a page that shows no case number.
  if (extractCaseNumber(fields, html) === null && REMOVED_PATTERNS.some((p) => p.test(html))) {
    return { status: 'removed' };
  }

  // The edict type opens a heading of its own, as in "Zuschlag ohne Überbot - Wohnung Top 1",
  // under the site heading "Gerichtliche Versteigerungen". No label/value row carries it.
  const headline = headlineText(html);
  // A cancelled sitting is gone whether its date has passed or not.
  if (CANCELLED_EDICT.test(headline)) return { status: 'removed' };
  if (SOLD_EDICT.test(headline)) return { status: 'sold' };

  const auctionDay = isoDay(extractAuctionDate(fields));
  if (auctionDay !== null && auctionDay < todayInVienna()) {
    return { status: 'sold' };
  }

  return { status: 'available' };
}

/** "15.4.2026 um 09:30 Uhr" -> "2026-04-15", which sorts like the date it names. */
function isoDay(raw: string | null): string | null {
  const m = raw?.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function todayInVienna(): string {
  const parts = viennaDate.formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
