/**
 * Registers all source adapters into the shared registry at startup.
 * Re-exports getAdapter for convenience.
 */

import { registerAdapters, getAdapter } from '@immoradar/scraper-core';
import { WillhabenAdapter } from '@immoradar/source-willhaben';
import { Immoscout24Adapter } from '@immoradar/source-immoscout24';
import { WohnnetAdapter } from '@immoradar/source-wohnnet';
import { DerStandardAdapter } from '@immoradar/source-derstandard';
import { FindMyHomeAdapter } from '@immoradar/source-findmyhome';
import { OpenImmoAdapter } from '@immoradar/source-openimmo';
import { RemaxAdapter } from '@immoradar/source-remax';
import { EdikteAdapter } from '@immoradar/source-edikte';

registerAdapters([
  new WillhabenAdapter(),
  new Immoscout24Adapter(),
  new WohnnetAdapter(),
  new DerStandardAdapter(),
  new FindMyHomeAdapter(),
  new OpenImmoAdapter(),
  new RemaxAdapter(),
  new EdikteAdapter(),
]);

export { getAdapter };
