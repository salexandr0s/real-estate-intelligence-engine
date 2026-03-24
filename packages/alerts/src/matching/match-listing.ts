import type { AlertChannel, AlertCreate, AlertType } from '@immoradar/contracts';
import { buildAlertDedupeKey } from '@immoradar/contracts';

interface MatchInput {
  listingId: number;
  listingVersionId: number | null;
  title: string;
  listPriceEurCents: number | null;
  livingAreaSqm: number | null;
  city: string;
  canonicalUrl: string;
}

const TITLE_PREFIX: Record<string, string> = {
  new_match: 'Neues Inserat',
  price_drop: 'Preissenkung',
  price_change: 'Preisänderung',
  score_upgrade: 'Score-Upgrade',
  status_change: 'Statusänderung',
  digest: 'Zusammenfassung',
};

/**
 * Generates AlertCreate records for each matching filter.
 * Creates one record per channel the filter is subscribed to.
 */
export function matchListingToFilters(
  listing: MatchInput,
  matchingFilters: Array<{ filterId: number; userId: number; alertChannels?: string[] }>,
  alertType: AlertType,
  scoreVersion: number,
): AlertCreate[] {
  const results: AlertCreate[] = [];

  for (const match of matchingFilters) {
    const channels: string[] =
      match.alertChannels && match.alertChannels.length > 0 ? match.alertChannels : ['in_app'];
    const dedupeKey = buildAlertDedupeKey({
      filterId: match.filterId,
      listingId: listing.listingId,
      alertType,
      scoreVersion,
    });

    const price = listing.listPriceEurCents
      ? `€${Math.round(listing.listPriceEurCents / 100).toLocaleString('de-AT')}`
      : 'Preis auf Anfrage';
    const area = listing.livingAreaSqm ? `${listing.livingAreaSqm} m²` : '';

    for (const channel of channels) {
      results.push({
        userId: match.userId,
        userFilterId: match.filterId,
        listingId: listing.listingId,
        listingVersionId: listing.listingVersionId,
        alertType,
        channel: channel as AlertChannel,
        dedupeKey,
        title: `${TITLE_PREFIX[alertType] ?? 'Alert'}: ${listing.title}`,
        body: `${price}${area ? ` · ${area}` : ''} · ${listing.city}`,
        payload: { canonicalUrl: listing.canonicalUrl },
      });
    }
  }

  return results;
}
