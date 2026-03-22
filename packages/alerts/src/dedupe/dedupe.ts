import type { AlertType } from '@rei/contracts';

/**
 * Determines whether a new alert should be created for this event.
 * Returns false if the change is not meaningful enough.
 */
export function shouldCreateAlert(params: {
  alertType: AlertType;
  previousScore: number | null;
  newScore: number | null;
  previousPriceCents: number | null;
  newPriceCents: number | null;
  onlyLastSeenChanged: boolean;
}): boolean {
  // Never alert on mere re-observation
  if (params.onlyLastSeenChanged) return false;

  switch (params.alertType) {
    case 'new_match':
      return true;

    case 'price_drop': {
      if (params.previousPriceCents == null || params.newPriceCents == null) return false;
      // Only alert if price actually decreased
      return params.newPriceCents < params.previousPriceCents;
    }

    case 'price_change': {
      // Price increased — still notify, but only if both prices are known
      if (params.previousPriceCents == null || params.newPriceCents == null) return false;
      return params.newPriceCents !== params.previousPriceCents;
    }

    case 'score_upgrade': {
      if (params.previousScore == null || params.newScore == null) return false;
      // Only alert if score improved by at least 5 points
      return params.newScore >= params.previousScore + 5;
    }

    case 'status_change':
      return true;

    case 'digest':
      return true;

    default:
      return false;
  }
}
