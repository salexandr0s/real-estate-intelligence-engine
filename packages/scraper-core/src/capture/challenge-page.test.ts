import { describe, expect, it } from 'vitest';
import { isChallengePage } from './challenge-page.js';

describe('isChallengePage', () => {
  // A live page reading as blocked fails the detail job and counts toward the source's breaker.
  it('ignores the reCAPTCHA, consent and Cloudflare scripts that normal pages load', () => {
    const html = `<!doctype html><html><head>
      <title>2-Zimmer-Wohnung mit Balkon | wohnnet</title>
      <script src="https://www.google.com/recaptcha/api.js?render=explicit"></script>
      <script type="text/x-blocked-script" data-consent="marketing">trackChallenge()</script>
      <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
      </head><body><h1>Diese Seite gibt es nicht mehr</h1></body></html>`;

    expect(isChallengePage(html)).toBe(false);
  });

  it('recognises an interstitial by its title', () => {
    expect(isChallengePage('<title>Just a moment...</title><body></body>')).toBe(true);
    expect(isChallengePage('<title>Attention Required! | Cloudflare</title>')).toBe(true);
    expect(isChallengePage('<h1>Zugriff verweigert</h1>')).toBe(true);
  });

  it('recognises an interstitial by markup only challenge pages carry', () => {
    const html = `<html><head><title></title></head><body>
      <script>window._cf_chl_opt = { cType: 'managed' };</script></body></html>`;
    // remax's bot check has no title, heading or listing data.
    const botCheck = `<html><head><script>
      const botdPromise = import('/templates/basic/js/fingerprint-botd-v200.js');
      </script></head><body><div class="loader"></div></body></html>`;

    expect(isChallengePage(html)).toBe(true);
    expect(isChallengePage(botCheck)).toBe(true);
  });
});
