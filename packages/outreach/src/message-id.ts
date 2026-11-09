/** Message-IDs are stored and compared without angle brackets: `abc@example.com`. */
export function normalizeMessageId(value: string): string {
  return value.trim().replace(/^<+/, '').replace(/>+$/, '').trim();
}

/**
 * Reads the Message-IDs in an In-Reply-To or References value, in order and without
 * duplicates. Bracketed IDs can sit back to back (`<a@x><b@y>`) or carry comments, so they
 * are read by their brackets; a value without brackets is split on whitespace.
 */
export function extractMessageIds(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  const ids: string[] = [];
  for (const entry of Array.isArray(value) ? value : [value]) {
    const tokens = entry.match(/<[^<>]+>/g) ?? entry.split(/\s+/);
    for (const token of tokens) {
      const id = normalizeMessageId(token);
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}
