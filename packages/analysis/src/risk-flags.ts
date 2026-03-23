/**
 * Generate risk and upside flags for a listing analysis.
 * These are human-readable strings surfaced in the analysis UI.
 */

export interface RiskFlagInput {
  operationType: string;
  propertyType: string;
  listPriceEurCents: number | null;
  pricePerSqmEur: number | null;
  livingAreaSqm: number | null;
  rooms: number | null;
  yearBuilt: number | null;
  conditionCategory: string | null;
  districtNo: number | null;
  geocodePrecision: string | null;
  currentScore: number | null;
  completenessScore: number;
  firstSeenAt: Date;
  lastPriceChangeAt: Date | null;
  districtMedianPpsqm: number | null;
  /** Legal-rent assessment status, if available */
  legalRentStatus?: string | null;
  /** Sale comparable sample size */
  saleCompSampleSize?: number;
  /** Whether listing has balcony/terrace/garden */
  hasBalcony?: boolean | null;
  hasTerrace?: boolean | null;
  hasGarden?: boolean | null;
  /** Nearest transit distance in meters */
  nearestTransitDistanceM?: number | null;
}

export function computeRiskFlags(input: RiskFlagInput): string[] {
  const flags: string[] = [];

  // Data quality risks
  if (input.geocodePrecision === 'district' || input.geocodePrecision === 'city') {
    flags.push('Location only approximate (district/city level)');
  }
  if (input.completenessScore < 50) {
    flags.push('Low data completeness — key fields may be missing');
  }

  // Price risks
  if (input.pricePerSqmEur != null && input.districtMedianPpsqm != null) {
    const premium =
      ((input.pricePerSqmEur - input.districtMedianPpsqm) / input.districtMedianPpsqm) * 100;
    if (premium > 30) {
      flags.push(`Price/sqm ${Math.round(premium)}% above district median`);
    }
  }

  // Age risks
  if (input.yearBuilt != null && input.yearBuilt < 1960) {
    flags.push('Pre-1960 building — may have renovation needs');
  }

  // Time on market
  const daysOnMarket = Math.floor(
    (Date.now() - input.firstSeenAt.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (daysOnMarket > 90) {
    flags.push(`Listed for ${daysOnMarket} days — extended time on market`);
  }

  // Missing critical data
  if (input.livingAreaSqm == null) {
    flags.push('Living area not specified');
  }
  if (input.rooms == null) {
    flags.push('Room count not specified');
  }

  // Legal-rent / regulation risk
  if (input.legalRentStatus === 'likely_capped') {
    flags.push('Likely subject to rent regulation (MRG)');
  } else if (input.legalRentStatus === 'likely_capped_missing_critical_proof') {
    flags.push('May be rent-regulated — critical facts unverified');
  }

  // Thin comparable set
  if (
    input.saleCompSampleSize != null &&
    input.saleCompSampleSize < 3 &&
    input.saleCompSampleSize > 0
  ) {
    flags.push('Thin comparable set — market context uncertain');
  }

  // No geocode
  if (input.geocodePrecision === 'none' || input.geocodePrecision == null) {
    flags.push('No geocoded location — spatial analysis unavailable');
  }

  return flags;
}

export function computeUpsideFlags(input: RiskFlagInput): string[] {
  const flags: string[] = [];

  // Below-market pricing
  if (input.pricePerSqmEur != null && input.districtMedianPpsqm != null) {
    const discount =
      ((input.districtMedianPpsqm - input.pricePerSqmEur) / input.districtMedianPpsqm) * 100;
    if (discount > 15) {
      flags.push(`Price/sqm ${Math.round(discount)}% below district median`);
    }
  }

  // Score-based
  if (input.currentScore != null && input.currentScore >= 80) {
    flags.push('High intelligence score (80+)');
  }

  // Recent price drop
  if (input.lastPriceChangeAt != null) {
    const daysSincePriceChange = Math.floor(
      (Date.now() - input.lastPriceChangeAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysSincePriceChange <= 14) {
      flags.push('Recent price change (last 14 days)');
    }
  }

  // Good data quality
  if (input.completenessScore >= 90) {
    flags.push('High data completeness (90%+)');
  }

  // Outdoor space
  if (input.hasBalcony || input.hasTerrace || input.hasGarden) {
    const spaces: string[] = [];
    if (input.hasBalcony) spaces.push('balcony');
    if (input.hasTerrace) spaces.push('terrace');
    if (input.hasGarden) spaces.push('garden');
    flags.push(`Has outdoor space (${spaces.join(', ')})`);
  }

  // Transit access
  if (input.nearestTransitDistanceM != null && input.nearestTransitDistanceM < 300) {
    flags.push('Excellent transit access (< 300m)');
  }

  // Good condition
  if (input.conditionCategory != null) {
    const lower = input.conditionCategory.toLowerCase();
    if (
      lower.includes('gut') ||
      lower.includes('good') ||
      lower.includes('excellent') ||
      lower.includes('renoviert') ||
      lower.includes('renovated') ||
      lower.includes('saniert')
    ) {
      flags.push('Good reported condition');
    }
  }

  return flags;
}
