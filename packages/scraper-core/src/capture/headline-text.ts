/**
 * Headline text of an HTML page: the `<title>` and every `<h1>`.
 *
 * Parsers look for "verkauft" or "vermietet" here instead of in the whole page, where those words
 * also appear in similar-listing teasers, scripts and footers.
 */

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
};

const COMMENT_RE = /<!--[\s\S]*?-->/g;
const NON_TEXT_BLOCK_RE = /<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const TITLE_RE = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i;
const H1_RE = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi;
const ENTITY_RE = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;

function decodeEntities(text: string): string {
  return text.replace(ENTITY_RE, (match, ref: string) => {
    if (ref.startsWith('#')) {
      const hex = ref[1] === 'x' || ref[1] === 'X';
      const codePoint = parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_ENTITIES[ref] ?? match;
  });
}

function textOf(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns the page title and the text of each `<h1>`, one per line, with inner tags removed,
 * entities decoded and whitespace collapsed. Comments, scripts, styles and templates are ignored.
 * Returns an empty string when the page has neither.
 */
export function headlineText(html: string): string {
  const markup = html.replace(COMMENT_RE, '').replace(NON_TEXT_BLOCK_RE, '');
  const parts: string[] = [];

  const title = TITLE_RE.exec(markup)?.[1];
  if (title !== undefined) parts.push(textOf(title));
  for (const match of markup.matchAll(H1_RE)) {
    if (match[1] !== undefined) parts.push(textOf(match[1]));
  }

  return parts.filter((part) => part.length > 0).join('\n');
}
