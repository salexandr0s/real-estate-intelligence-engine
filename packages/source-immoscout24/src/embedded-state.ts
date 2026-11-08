/**
 * IS24 pages embed their app state as a script assignment: `window.__INITIAL_STATE__={...}` on
 * search pages and `window.__APOLLO_STATE__={...}` on detail pages. The value is a JavaScript
 * object literal that is JSON apart from bare `undefined` values, which this reader turns into
 * null. Returns null when the assignment is missing or does not parse.
 */
export function readEmbeddedState(html: string, name: string): unknown {
  const marker = `window.${name}=`;
  const start = html.indexOf(marker);
  if (start < 0) return null;

  let i = start + marker.length;
  while (i < html.length && /\s/.test(html.charAt(i))) i++;
  if (html.charAt(i) !== '{') return null;

  const parts: string[] = [];
  let segmentStart = i;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (; i < html.length; i++) {
    const ch = html.charAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        parts.push(html.slice(segmentStart, i + 1));
        try {
          return JSON.parse(parts.join('')) as unknown;
        } catch {
          return null;
        }
      }
    } else if (ch === 'u' && html.startsWith('undefined', i)) {
      parts.push(html.slice(segmentStart, i), 'null');
      i += 'undefined'.length - 1;
      segmentStart = i + 1;
    }
  }
  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value at a key path, or undefined where the path leaves the object tree. */
export function field(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** A non-empty trimmed string, or null. */
export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** A positive finite number as a string, or null. IS24 sends 0 for "price on request". */
export function positiveNumberText(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? String(value) : null;
}
