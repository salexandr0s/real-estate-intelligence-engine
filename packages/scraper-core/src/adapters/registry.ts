/**
 * Shared source adapter registry.
 *
 * Provides a singleton Map of source code → SourceAdapter.
 * Apps must call registerAdapter() or registerAdapters() at startup
 * to populate the registry before workers begin processing.
 *
 * Source-package imports live in the app layer (not here) to avoid
 * circular dependencies between scraper-core and source packages.
 */

import type { SourceAdapter } from '@immoradar/contracts';

const registry = new Map<string, SourceAdapter<unknown, unknown>>();

/**
 * Gets a registered source adapter by source code.
 * Throws if the source code is not registered.
 */
export function getAdapter(sourceCode: string): SourceAdapter<unknown, unknown> {
  const adapter = registry.get(sourceCode);
  if (!adapter) {
    throw new Error(`No adapter registered for source: ${sourceCode}`);
  }
  return adapter;
}

/** Register a single source adapter. */
export function registerAdapter(adapter: SourceAdapter<unknown, unknown>): void {
  registry.set(adapter.sourceCode, adapter);
}

/** Register multiple source adapters at once. */
export function registerAdapters(adapters: SourceAdapter<unknown, unknown>[]): void {
  for (const adapter of adapters) {
    registry.set(adapter.sourceCode, adapter);
  }
}

/** Returns all registered source codes. */
export function getRegisteredSourceCodes(): string[] {
  return Array.from(registry.keys());
}
