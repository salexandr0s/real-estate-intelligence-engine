/**
 * Sanitize a string for safe CSV inclusion:
 * - Escape double quotes
 * - Strip newlines (would break row structure)
 * - Prefix formula-trigger characters to prevent CSV injection in spreadsheets
 */
export function csvSafe(value: string): string {
  let sanitized = value.replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
  if (/^[=+\-@\t\r]/.test(sanitized)) {
    sanitized = `'${sanitized}`;
  }
  return sanitized;
}
