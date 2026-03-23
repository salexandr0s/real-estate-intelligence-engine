import type { InvestorMetrics, MarketRentEstimate } from '@rei/contracts';

/**
 * Compute investor metrics from listing price and market rent estimate.
 *
 * Gross yield = (annual rent / purchase price) * 100
 * Price-to-rent = purchase price / annual rent
 *
 * Sensitivity bands show yield at low/mid/high rent estimates.
 *
 * We do NOT compute net yield because that requires:
 * - operating costs (often missing or partial)
 * - vacancy rate (unknown)
 * - maintenance reserves (unknown)
 * - tax situation (varies by investor)
 */
export function computeInvestorMetrics(
  listPriceEurCents: number | null,
  marketRent: MarketRentEstimate | null,
): InvestorMetrics | null {
  if (
    listPriceEurCents == null ||
    listPriceEurCents <= 0 ||
    marketRent == null ||
    marketRent.estimateMid == null ||
    marketRent.estimateMid <= 0
  ) {
    return null;
  }

  const purchasePriceEur = listPriceEurCents / 100;
  const annualRentMid = marketRent.estimateMid * 12;

  const grossYield = (annualRentMid / purchasePriceEur) * 100;
  const priceToRent = purchasePriceEur / annualRentMid;

  const assumptions: string[] = [
    'Gross yield assumes 12 months full occupancy',
    'No transaction costs, taxes, or operating expenses deducted',
    `Market rent estimate confidence: ${marketRent.confidence}`,
  ];

  if (marketRent.fallbackLevel !== 'nearby') {
    assumptions.push(
      `Rent estimate uses ${marketRent.fallbackLevel}-level comparables (less precise)`,
    );
  }

  if (marketRent.sampleSize < 5) {
    assumptions.push(
      `Based on ${marketRent.sampleSize} comparable${marketRent.sampleSize === 1 ? '' : 's'} (thin sample)`,
    );
  }

  // Sensitivity bands using low/mid/high rent estimates
  const sensitivityLow =
    marketRent.estimateLow != null && marketRent.estimateLow > 0
      ? ((marketRent.estimateLow * 12) / purchasePriceEur) * 100
      : null;
  const sensitivityHigh =
    marketRent.estimateHigh != null && marketRent.estimateHigh > 0
      ? ((marketRent.estimateHigh * 12) / purchasePriceEur) * 100
      : null;

  return {
    grossYield: {
      value: Math.round(grossYield * 100) / 100,
      assumptions,
    },
    priceToRent: Math.round(priceToRent * 10) / 10,
    sensitivityBands: {
      low: sensitivityLow != null ? Math.round(sensitivityLow * 100) / 100 : null,
      base: Math.round(grossYield * 100) / 100,
      high: sensitivityHigh != null ? Math.round(sensitivityHigh * 100) / 100 : null,
    },
  };
}
