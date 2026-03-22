import type { AlertCreate, AlertType } from '@rei/contracts';
import { buildAlertDedupeKey } from '@rei/contracts';

interface MatchInput {
  listingId: number;
  listingVersionId: number | null;
  title: string;
  listPriceEurCents: number | null;
  livingAreaSqm: number | null;
  city: string;
  canonicalUrl: string;
}

/**
 * Generates AlertCreate records for each matching filter.
 */
export function matchListingToFilters(
  listing: MatchInput,
  matchingFilters: Array<{ filterId: number; userId: number }>,
  alertType: AlertType,
  scoreVersion: number,
): AlertCreate[] {
  return matchingFilters.map((match) => {
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

    const titlePrefix: Record<string, string> = {
      new_match: 'Neues Inserat',
      price_drop: 'Preissenkung',
      price_change: 'Preisänderung',
      score_upgrade: 'Score-Upgrade',
      status_change: 'Statusänderung',
      digest: 'Zusammenfassung',
    };

    return {
      userId: match.userId,
      userFilterId: match.filterId,
      listingId: listing.listingId,
      listingVersionId: listing.listingVersionId,
      alertType,
      channel: 'in_app' as const,
      dedupeKey,
      title: `${titlePrefix[alertType] ?? 'Alert'}: ${listing.title}`,
      body: `${price}${area ? ` · ${area}` : ''} · ${listing.city}`,
      payload: { canonicalUrl: listing.canonicalUrl },
    };
  });
}
