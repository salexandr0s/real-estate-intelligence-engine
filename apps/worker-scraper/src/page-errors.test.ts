import { describe, expect, it } from 'vitest';
import { BlockedPageError, throwIfBlockedSearchPage } from './page-errors.js';

const CHALLENGE_PAGE =
  '<html><head><title>Just a moment...</title></head>' +
  '<body><script>window._cf_chl_opt = {};</script></body></html>';

// Sites that run a bot check before showing a listing can load the same script on their results.
const RESULTS_WITH_BOT_CHECK =
  '<html><head><title>Wohnungen kaufen</title>' +
  '<script src="https://cdn.example.test/fingerprint-botd.min.js"></script></head>' +
  '<body><h1>Wohnungen kaufen in Wien</h1></body></html>';

describe('throwIfBlockedSearchPage', () => {
  it('fails an empty search page that is a challenge page', () => {
    expect(() => throwIfBlockedSearchPage(0, CHALLENGE_PAGE)).toThrow(BlockedPageError);
  });

  it('keeps a search page that lists listings, whatever bot-check script it loads', () => {
    expect(() => throwIfBlockedSearchPage(25, RESULTS_WITH_BOT_CHECK)).not.toThrow();
  });

  it('leaves an empty search page alone when it is no challenge', () => {
    const noResults = '<html><head><title>Keine Treffer</title></head><body></body></html>';
    expect(() => throwIfBlockedSearchPage(0, noResults)).not.toThrow();
  });
});
