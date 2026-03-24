/**
 * AI-based PDF extraction fallback for scanned or complex documents.
 *
 * Uses Claude API to extract structured real estate facts from PDFs
 * when text-layer extraction yields insufficient content.
 */

import type { FactExtraction } from './fact-parser.js';

/** Anthropic client interface — accepts any object with messages.create */
interface AnthropicClient {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      messages: Array<{
        role: string;
        content: Array<{
          type: string;
          source?: { type: string; media_type: string; data: string };
          text?: string;
        }>;
      }>;
    }): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

interface AiExtractionOptions {
  /** Anthropic client instance */
  client: AnthropicClient;
  /** Model to use (default: claude-sonnet-4-6) */
  model?: string;
  /** Max tokens for response (default: 2048) */
  maxTokens?: number;
}

const EXTRACTION_PROMPT = `You are extracting structured real estate data from an Austrian court valuation document (Schätzgutachten / Zwangsversteigerung).

Extract these facts if present. Return ONLY a JSON array of objects with these fields:
- factType: one of "appraised_value", "minimum_bid", "living_area", "usable_area", "plot_area", "rooms", "floor", "building_year", "condition", "heating", "energy_hwb", "energy_class", "land_register", "cadastral_number", "auction_date", "purchase_price", "balcony", "loggia", "operating_costs"
- factValue: the extracted value as a string (numbers without currency symbols, areas without m²)
- confidence: "high" or "medium"
- sourceSnippet: the relevant text snippet (max 80 chars)

Return [] if no facts can be extracted. Return ONLY the JSON array, no other text.`;

/**
 * Extract real estate facts from a PDF buffer using Claude's vision capabilities.
 *
 * Converts the PDF to a base64-encoded document and sends it to Claude
 * for structured extraction. Should only be called when text extraction
 * returns insufficient content (scanned/image-only documents).
 */
export async function extractFactsWithAi(
  pdfBuffer: Buffer,
  options: AiExtractionOptions,
): Promise<FactExtraction[]> {
  const { client, model = 'claude-sonnet-4-6', maxTokens = 2048 } = options;

  const base64Pdf = pdfBuffer.toString('base64');

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64Pdf,
              },
            },
            {
              type: 'text',
              text: EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock?.text) return [];

    // Extract JSON array from response (handle markdown code blocks)
    const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return [];

    // Validate and cast each fact
    return parsed
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as Record<string, unknown>).factType === 'string' &&
          typeof (item as Record<string, unknown>).factValue === 'string',
      )
      .map((item) => ({
        factType: item.factType as string,
        factValue: item.factValue as string,
        confidence: (item.confidence as 'high' | 'medium' | 'low') ?? 'medium',
        sourceSnippet: (item.sourceSnippet as string) ?? '',
      }));
  } catch {
    // API errors, JSON parse errors, etc. — return empty gracefully
    return [];
  }
}
