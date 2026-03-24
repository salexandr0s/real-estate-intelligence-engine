import type { DetailCapture, SourceAvailability } from '@immoradar/contracts';
import { extractPdfText, isTextExtractionUseful, parseRealEstateFacts } from '@immoradar/documents';
import type { FactExtraction } from '@immoradar/documents';
import type { EdikteDetailDTO } from './dto.js';
import { BASE_URL } from './constants.js';

/**
 * Minimal Playwright Page interface for detail extraction.
 */
interface PlaywrightPage {
  url(): string;
  content(): Promise<string>;
  context(): {
    request: {
      get(url: string): Promise<{ body(): Promise<Buffer>; status(): number }>;
    };
  };
}

/**
 * Parses an edict detail page and extracts structured data.
 * Also downloads and processes PDF attachments for fact extraction.
 */
export async function parseDetailPage(
  page: PlaywrightPage,
  canonicalUrl: string,
  _sourceCode: string,
): Promise<
  Omit<
    DetailCapture<EdikteDetailDTO>,
    'sourceCode' | 'extractedAt' | 'parserVersion' | 'extractionStatus'
  >
> {
  const html = await page.content();

  // Extract metadata from HTML
  const courtName = extractCourtName(html);
  const caseNumber = extractCaseNumber(html);
  const auctionDateRaw = extractAuctionDate(html);
  const locationInfo = extractLocation(html);
  const appraisedValueRaw = extractAppraisedValue(html);
  const minimumBidRaw = extractMinimumBid(html);
  const viewingDatesRaw = extractViewingDates(html);
  const legalNoticesRaw = extractLegalNotices(html);
  const propertyCategory = extractPropertyCategory(html);
  const publicationDate = extractPublicationDate(html);
  const ediktId = extractEdiktId(canonicalUrl, html);

  // Collect PDF attachment URLs
  const attachmentPdfUrls = extractPdfAttachmentUrls(html);

  // Download and extract facts from PDFs
  const { facts, method } = await extractFromPdfs(page, attachmentPdfUrls);

  // Extract object size from HTML
  const objectSize = extractObjectSize(html);

  // Merge PDF facts with HTML-extracted data
  const mergedData = mergePdfFacts(facts, {
    appraisedValueRaw,
    minimumBidRaw,
    livingAreaRaw: objectSize,
    roomsRaw: null,
    yearBuiltRaw: null,
  });

  // Build the title from available data
  const titleParts = [propertyCategory, locationInfo.addressRaw].filter(Boolean);
  const titleRaw = titleParts.length > 0 ? titleParts.join(' – ') : null;

  return {
    canonicalUrl,
    detailUrl: canonicalUrl,
    externalId: ediktId,
    payload: {
      ediktId,
      courtName,
      caseNumber,
      auctionDateRaw,
      appraisedValueRaw: mergedData.appraisedValueRaw,
      minimumBidRaw: mergedData.minimumBidRaw,
      viewingDatesRaw,
      legalNoticesRaw,
      attachmentPdfUrls,
      publicationDate,
      sourcePropertyCategory: propertyCategory,
      pdfExtractedFacts: facts,
      pdfExtractionMethod: method,
      // SourceRawListingBase fields
      titleRaw,
      priceRaw: mergedData.appraisedValueRaw,
      livingAreaRaw: mergedData.livingAreaRaw,
      roomsRaw: mergedData.roomsRaw,
      yearBuiltRaw: mergedData.yearBuiltRaw,
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

// ── HTML extraction helpers ────────────────────────────────────────────

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

function extractCourtName(html: string): string | null {
  // Pattern from real page: "Dienststelle: BG Donaustadt (027)"
  const dienstMatch = html.match(/Dienststelle:\s*([^<\n]+)/i);
  if (dienstMatch?.[1]) return dienstMatch[1].trim();

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

function extractCaseNumber(html: string): string | null {
  // Pattern from real page: "Aktenzeichen: 68 E 33/25a"
  const aktenMatch = html.match(/Aktenzeichen:\s*(\d{1,3}\s+E\s+\d+\/\d{2}[a-z]?)/i);
  if (aktenMatch?.[1]) return aktenMatch[1].trim();

  // Fallback: general case number pattern
  const m = html.match(/\d{1,3}\s+E\s+\d+\/\d{2}[a-z]?(?:-\d+)?/i);
  return m ? m[0].trim() : null;
}

function extractAuctionDate(html: string): string | null {
  // "Versteigerungstermin: 15.04.2026 um 10:00 Uhr"
  const patterns = [
    /Versteigerungstermin[:\s]*(\d{2}\.\d{2}\.\d{4}(?:\s+um\s+\d{2}:\d{2}(?:\s*Uhr)?)?)/i,
    /Termin[:\s]*(\d{2}\.\d{2}\.\d{4}(?:\s+um\s+\d{2}:\d{2})?)/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function extractLocation(html: string): {
  addressRaw: string | null;
  postalCodeRaw: string | null;
  cityRaw: string | null;
} {
  // Pattern from real page: "PLZ/Ort:1220 Wien"
  const plzOrtMatch = html.match(/PLZ\/Ort:\s*(\d{4})\s+([^<\n]+)/i);
  if (plzOrtMatch) {
    return {
      addressRaw: `${plzOrtMatch[1]} ${plzOrtMatch[2]?.trim()}`,
      postalCodeRaw: plzOrtMatch[1] ?? null,
      cityRaw: plzOrtMatch[2]?.trim() ?? 'Wien',
    };
  }

  // Fallback: try to find address with Vienna postal code
  const addrMatch = html.match(/(\d{4})\s+(Wien[^<,;]{0,50})/i);
  if (addrMatch) {
    return {
      addressRaw: addrMatch[0].trim(),
      postalCodeRaw: addrMatch[1] ?? null,
      cityRaw: 'Wien',
    };
  }

  return {
    addressRaw: null,
    postalCodeRaw: null,
    cityRaw: 'Wien',
  };
}

function extractAppraisedValue(html: string): string | null {
  // Pattern from real page: "Schätzwert:382.000,00 EUR"
  const patterns = [
    /Schätzwert:\s*([\d.,]+)\s*EUR/i,
    /Schätzwert[:\s]*€?\s*([\d.,]+)/i,
    /Verkehrswert[:\s]*€?\s*([\d.,]+)/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function extractMinimumBid(html: string): string | null {
  // Pattern from real page: "Geringstes Gebot:191.000,00 EUR"
  const patterns = [
    /Geringstes?\s*Gebot:\s*([\d.,]+)\s*EUR/i,
    /Mindestgebot[:\s]*€?\s*([\d.,]+)/i,
    /geringstes?\s*Gebot[:\s]*€?\s*([\d.,]+)/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function extractObjectSize(html: string): string | null {
  // Pattern from real page: "Objektgröße:85,22 m²"
  const m = html.match(/Objektgröße:\s*([\d.,]+)\s*m²/i);
  return m?.[1]?.trim() ?? null;
}

function extractViewingDates(html: string): string[] {
  const dates: string[] = [];
  const pattern = /Besichtigungstermin[e]?[:\s]*([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) !== null) {
    if (m[1]) {
      // Split on common separators
      const parts = m[1]
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      dates.push(...parts);
    }
  }
  return dates;
}

function extractLegalNotices(html: string): string | null {
  // Try to find the main edict text block
  // Domino often wraps content in specific divs or table cells
  const patterns = [
    /class="[^"]*edikt[^"]*"[^>]*>([\s\S]{50,5000}?)<\//i,
    /class="[^"]*content[^"]*"[^>]*>([\s\S]{50,5000}?)<\//i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) {
      const text = m[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > 50) return text;
    }
  }
  return null;
}

function extractPropertyCategory(html: string): string | null {
  // Pattern from real page: "Kategorie(n):Reihenhaus"
  const katMatch = html.match(/Kategorie\(n\):\s*([^<\n]+)/i);
  if (katMatch?.[1]) return katMatch[1].trim();

  // Also check "wegen:" field: "wegen:Zwangsversteigerung von Wohnungseigentum"
  const wegenMatch = html.match(/wegen:\s*Zwangsversteigerung\s+von\s+([^<\n]+)/i);
  if (wegenMatch?.[1]) return wegenMatch[1].trim();

  return null;
}

function extractPublicationDate(html: string): string | null {
  // Look for publication/Veröffentlichung dates
  const m = html.match(/(?:Veröffentlich|Eingestellt|Datum)[^:]*:\s*(\d{2}\.\d{2}\.\d{4})/i);
  return m?.[1] ?? null;
}

// ── PDF extraction ─────────────────────────────────────────────────────

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

/**
 * Downloads PDFs and extracts structured facts from their text content.
 */
async function extractFromPdfs(
  page: PlaywrightPage,
  attachments: Array<{ url: string; label: string }>,
): Promise<{ facts: FactExtraction[]; method: 'text' | 'ai' | 'none' }> {
  if (attachments.length === 0) {
    return { facts: [], method: 'none' };
  }

  const allFacts: FactExtraction[] = [];
  let method: 'text' | 'ai' | 'none' = 'none';

  for (const attachment of attachments) {
    try {
      const response = await page.context().request.get(attachment.url);
      if (response.status() !== 200) continue;

      const buffer = await response.body();
      const extraction = await extractPdfText(buffer);

      if (isTextExtractionUseful(extraction)) {
        const facts = parseRealEstateFacts(extraction.text);
        allFacts.push(...facts);
        method = 'text';
      }
      // AI fallback is available but not wired inline —
      // callers can use extractFactsWithAi from @immoradar/documents
      // for PDFs that fail text extraction. This keeps the detail
      // parser fast and avoids API costs for every listing.
    } catch {
      // Failed to download or parse PDF — skip gracefully
    }
  }

  return { facts: allFacts, method };
}

// ── Fact merging ───────────────────────────────────────────────────────

interface MergeableFields {
  appraisedValueRaw: string | null;
  minimumBidRaw: string | null;
  livingAreaRaw: string | number | null;
  roomsRaw: string | number | null;
  yearBuiltRaw: string | number | null;
}

/**
 * Merge PDF-extracted facts into the DTO fields.
 * HTML-extracted values take precedence over PDF-extracted values.
 */
function mergePdfFacts(facts: FactExtraction[], existing: MergeableFields): MergeableFields {
  const result = { ...existing };

  for (const fact of facts) {
    switch (fact.factType) {
      case 'appraised_value':
        if (result.appraisedValueRaw == null) result.appraisedValueRaw = fact.factValue;
        break;
      case 'minimum_bid':
        if (result.minimumBidRaw == null) result.minimumBidRaw = fact.factValue;
        break;
      case 'living_area':
        if (result.livingAreaRaw == null) result.livingAreaRaw = fact.factValue;
        break;
      case 'rooms':
        if (result.roomsRaw == null) result.roomsRaw = fact.factValue;
        break;
      case 'building_year':
        if (result.yearBuiltRaw == null) result.yearBuiltRaw = fact.factValue;
        break;
    }
  }

  return result;
}

// ── Availability detection ─────────────────────────────────────────────

/**
 * Detects whether a forced auction listing is still active.
 */
export function detectDetailAvailability(
  html: string,
  auctionDateRaw: string | null,
): SourceAvailability {
  if (!html) return { status: 'not_found' };

  // Check for removed/expired indicators
  const removedPatterns = [/nicht mehr verfügbar/i, /gelöscht/i, /archiviert/i, /aufgehoben/i];
  for (const p of removedPatterns) {
    if (p.test(html)) return { status: 'removed' };
  }

  // If auction date is in the past, mark as sold
  if (auctionDateRaw) {
    const dateMatch = auctionDateRaw.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (dateMatch) {
      const [, day, month, year] = dateMatch;
      const auctionDate = new Date(`${year}-${month}-${day}`);
      if (auctionDate < new Date()) {
        return { status: 'sold' };
      }
    }
  }

  return { status: 'available' };
}
