/**
 * Registers all source adapters into the shared registry at startup.
 * Used by the canary worker which needs adapter access.
 */

import { registerAdapters } from '@rei/scraper-core';
import { WillhabenAdapter } from '@rei/source-willhaben';
import { Immoscout24Adapter } from '@rei/source-immoscout24';
import { WohnnetAdapter } from '@rei/source-wohnnet';
import { DerStandardAdapter } from '@rei/source-derstandard';
import { FindMyHomeAdapter } from '@rei/source-findmyhome';
import { OpenImmoAdapter } from '@rei/source-openimmo';
import { RemaxAdapter } from '@rei/source-remax';

registerAdapters([
  new WillhabenAdapter(),
  new Immoscout24Adapter(),
  new WohnnetAdapter(),
  new DerStandardAdapter(),
  new FindMyHomeAdapter(),
  new OpenImmoAdapter(),
  new RemaxAdapter(),
]);
