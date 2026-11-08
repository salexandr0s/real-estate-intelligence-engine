/**
 * IS24 pages embed their app state as a script assignment: `window.__INITIAL_STATE__={...}` on
 * search pages and `window.__APOLLO_STATE__={...}` on detail pages, with or without spaces around
 * the `=`. The value is a JavaScript object literal that is JSON apart from bare `undefined`
 * values, which this reader turns into null. Returns null when the assignment is missing or does
 * not parse.
 */
export function readEmbeddedState(html: string, name: string): unknown {
  // `(?!=)` skips comparisons such as `window.__APOLLO_STATE__ === undefined`.
  const assignment = new RegExp(`window\\.${escapeRegExp(name)}\\s*=(?!=)\\s*`, 'g');
  let match: RegExpExecArray | null;
  while ((match = assignment.exec(html)) !== null) {
    const start = match.index + match[0].length;
    if (html.charAt(start) === '{') return parseObjectLiteral(html, start);
  }
  return null;
}

/** Parses the object literal that opens at `start`, or returns null. */
function parseObjectLiteral(html: string, start: number): unknown {
  const parts: string[] = [];
  let segmentStart = start;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i++) {
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

/**
 * A JSON number as a raw string: whole numbers as they are, others with two decimals. The
 * normalizer reads three digits after a dot as a thousands group, so 72.125 must not become
 * "72.125".
 */
export function numberText(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** A positive finite number as a raw string, or null. IS24 sends 0 for "price on request". */
export function positiveNumberText(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? numberText(value)
    : null;
}
