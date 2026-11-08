/**
 * Decode common HTML entities that appear in derstandard pages.
 * Handles numeric (&#NNN; / &#xHH;) and named entities used in German text.
 */
export function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&euro;': '€',
    '&auml;': 'ä',
    '&ouml;': 'ö',
    '&uuml;': 'ü',
    '&Auml;': 'Ä',
    '&Ouml;': 'Ö',
    '&Uuml;': 'Ü',
    '&szlig;': 'ß',
    '&sup2;': '²',
    '&nbsp;': ' ',
  };

  let result = text;
  for (const [entity, char] of Object.entries(named)) {
    result = result.split(entity).join(char);
  }

  // Numeric entities: &#123; or &#x1F;
  result = result.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );

  return result;
}

/**
 * Strip HTML tags, decode entities, and collapse whitespace.
 */
export function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A number as a raw string: whole numbers as they are, others rounded to two decimals.
 * Normalization reads three digits after a dot as a thousands group, so "72.125" would be 72125.
 */
export function numberText(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
