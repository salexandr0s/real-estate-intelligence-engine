/** Pages that load but carry nothing to parse. The discovery and detail workers both throw these. */

/** The site answered with a challenge page instead of the listing or the search results. */
export class BlockedPageError extends Error {
  constructor() {
    // The classifier reads "challenge" as soft_anti_bot.
    super('Blocked by a challenge page');
    this.name = 'BlockedPageError';
  }
}

/** The page loaded with nothing in it, so it says nothing about the listing. */
export class EmptyPageError extends Error {
  constructor() {
    // The classifier reads "network error" as transient_network: the job retries, and the failure
    // never counts toward switching the source off.
    super('Empty document, retried as a network error');
    this.name = 'EmptyPageError';
  }
}
