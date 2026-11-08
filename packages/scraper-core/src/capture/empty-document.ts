/**
 * Recognises a page that delivered no content. Chromium serialises one, such as an empty 2xx
 * response, as `<html><head></head><body></body></html>`. A blank page says nothing about the
 * listing, so it must not count as a fetch that found no listing.
 */

const BODY = /<body\b[^>]*>([\s\S]*?)<\/body>/i;
const COMMENTS = /<!--[\s\S]*?-->/g;
const DOCUMENT_TAGS = /<\/?(html|head|body)\b[^>]*>/gi;

export function isEmptyDocument(html: string): boolean {
  const body = BODY.exec(html);
  const content = body ? (body[1] ?? '') : html.replace(DOCUMENT_TAGS, '');
  return content.replace(COMMENTS, '').trim() === '';
}
