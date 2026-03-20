/**
 * CSS selectors for willhaben.at listing pages.
 * These are realistic selectors based on typical Austrian real estate listing site patterns.
 * Selectors are versioned and centralized for easy maintenance.
 */
export const WILLHABEN_SELECTORS = {
  // Discovery page
  discovery: {
    listingCard: '[data-testid="search-result-entry"], .search-result-entry, article.result-item',
    listingId: '[data-testid="ad-id"], [data-ad-id]',
    listingLink: 'a[data-testid="search-result-entry-header-link"], a.result-title',
    listingTitle: '[data-testid="search-result-entry-header-link"], .result-title',
    listingPrice: '[data-testid="search-result-entry-price"], .result-price',
    listingLocation: '[data-testid="search-result-entry-location"], .result-location',
    listingRooms: '[data-testid="search-result-entry-rooms"]',
    listingArea: '[data-testid="search-result-entry-area"]',
    pagination: {
      nextButton: '[data-testid="pagination-next"], a.pagination-next',
      currentPage: '[data-testid="pagination-current"]',
      totalPages: '[data-testid="pagination-total"]',
    },
  },

  // Detail page
  detail: {
    title: 'h1[data-testid="ad-detail-header"], h1.ad-title',
    price: '[data-testid="price-value"], .price-value',
    description: '[data-testid="ad-description"], .ad-description',
    address: '[data-testid="ad-address"], .address-text',
    postalCode: '[data-testid="postal-code"]',
    attributes: {
      container: '[data-testid="attribute-group"], .attribute-group',
      row: '[data-testid="attribute-item"], .attribute-item',
      label: '.attribute-label, dt',
      value: '.attribute-value, dd',
    },
    livingArea: '[data-testid="attribute-living-area"]',
    usableArea: '[data-testid="attribute-usable-area"]',
    rooms: '[data-testid="attribute-rooms"]',
    floor: '[data-testid="attribute-floor"]',
    yearBuilt: '[data-testid="attribute-year-built"]',
    propertyType: '[data-testid="attribute-property-type"]',
    condition: '[data-testid="attribute-condition"]',
    heating: '[data-testid="attribute-heating"]',
    energy: '[data-testid="attribute-energy-certificate"]',
    commission: '[data-testid="commission-info"]',
    operatingCost: '[data-testid="operating-cost"]',
    unavailable: '[data-testid="ad-not-available"], .ad-removed, .ad-expired',
    sold: '[data-testid="ad-sold"], .ad-sold-marker',
    jsonLd: 'script[type="application/ld+json"]',
  },
} as const;
