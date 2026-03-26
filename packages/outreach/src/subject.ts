const RE_PREFIX = /^(\s*(re|aw|wg):\s*)+/i;

export function normalizeThreadSubject(subject: string | null | undefined): string {
  return (subject ?? '').replace(RE_PREFIX, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function stripQuotedReplyText(text: string | null | undefined): string | null {
  if (!text) return null;
  const markers = [/^On .+wrote:$/im, /^Am .+schrieb .+:$/im, /^>+/m, /^From:\s/im];
  let end = text.length;
  for (const marker of markers) {
    const match = marker.exec(text);
    if (match?.index != null) {
      end = Math.min(end, match.index);
    }
  }
  const cleaned = text.slice(0, end).trim();
  return cleaned || text.trim() || null;
}
