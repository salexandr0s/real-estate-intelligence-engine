import { createHash } from 'node:crypto';

/**
 * Compute a SHA-256 hash of a payload using deterministic JSON serialization.
 *
 * Keys are sorted recursively so that logically identical payloads always
 * produce the same hash, regardless of insertion order.
 */
export function computeContentHash(payload: Record<string, unknown>): string {
  const deterministic = deterministicStringify(payload);
  return createHash('sha256').update(deterministic, 'utf-8').digest('hex');
}

/**
 * JSON.stringify with sorted keys at every nesting level.
 * Produces a stable, deterministic string for any JSON-serializable value.
 */
function deterministicStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      const keys = Object.keys(val as Record<string, unknown>).sort();
      for (const k of keys) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}
