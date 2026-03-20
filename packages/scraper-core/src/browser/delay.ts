/**
 * Generate a random integer between min (inclusive) and max (inclusive).
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Sleep for a jittered duration between minMs and maxMs.
 * Used to add human-like randomness to request timing.
 */
export async function jitteredDelay(minMs: number, maxMs: number): Promise<void> {
  const delayMs = randomInt(minMs, maxMs);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Delay between navigating to result/listing pages.
 * Range: 2000-7000ms (per scraper spec section 5.1).
 */
export function pageNavigationDelay(): Promise<void> {
  return jitteredDelay(2000, 7000);
}

/**
 * Delay between clicks and interactions within a page.
 * Range: 500-1500ms (per scraper spec section 5.1).
 */
export function interactionDelay(): Promise<void> {
  return jitteredDelay(500, 1500);
}

/**
 * Cooldown delay after a soft failure or suspicious response.
 * Range: 10000-60000ms (per scraper spec section 5.1).
 */
export function cooldownDelay(): Promise<void> {
  return jitteredDelay(10_000, 60_000);
}
