import type { SourceAdapter } from '@rei/contracts';
import { WillhabenAdapter } from '@rei/source-willhaben';
import { Immoscout24Adapter } from '@rei/source-immoscout24';
import { WohnnetAdapter } from '@rei/source-wohnnet';
import { DerStandardAdapter } from '@rei/source-derstandard';
import { FindMyHomeAdapter } from '@rei/source-findmyhome';
import { OpenImmoAdapter } from '@rei/source-openimmo';
import { RemaxAdapter } from '@rei/source-remax';

const registry = new Map<string, SourceAdapter<unknown, unknown>>();

// Register all source adapters
registry.set('willhaben', new WillhabenAdapter());
registry.set('immoscout24', new Immoscout24Adapter());
registry.set('wohnnet', new WohnnetAdapter());
registry.set('derstandard', new DerStandardAdapter());
registry.set('findmyhome', new FindMyHomeAdapter());
registry.set('openimmo', new OpenImmoAdapter());
registry.set('remax', new RemaxAdapter());

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

/**
 * Registers a new source adapter.
 * Use this to add adapters at startup before workers begin processing.
 */
export function registerAdapter(adapter: SourceAdapter<unknown, unknown>): void {
  registry.set(adapter.sourceCode, adapter);
}
