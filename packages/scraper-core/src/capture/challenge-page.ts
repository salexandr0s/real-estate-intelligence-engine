/**
 * Recognises anti-bot interstitials served with a 2xx status. 403 and 429 responses are handled by
 * navigateForCapture before any parser sees the page.
 *
 * Normal listing pages load reCAPTCHA, consent managers that mark scripts as
 * `text/x-blocked-script`, and Cloudflare's challenge-platform script, so the words "captcha",
 * "blocked" or "challenge" anywhere in the HTML prove nothing. A page counts as a challenge only
 * when its title or main heading says so, or when it carries markup that only interstitials have.
 */

import { headlineText } from './headline-text.js';

const CHALLENGE_HEADLINE = new RegExp(
  [
    'captcha',
    'just a moment',
    'attention required',
    'checking your browser',
    'verify(ing)? you are (a )?human',
    'are you a (robot|human)',
    'access denied',
    'has been denied',
    'you have been blocked',
    'request (was )?blocked',
    'unusual traffic',
    'pardon our interruption',
    'security check',
    'security verification',
    'zugriff verweigert',
    'sicherheits(über)?prüfung',
    '(bist du|sind sie) ein mensch',
    'kein roboter',
  ].join('|'),
  'i',
);

// Cloudflare's challenge options and form, the PerimeterX block widget, the DataDome block frame,
// and the FingerprintJS BotD check that remax runs before it shows a listing.
const CHALLENGE_MARKUP =
  /window\._cf_chl_opt|id=["']challenge-form["']|id=["']px-captcha["']|geo\.captcha-delivery\.com\/captcha|fingerprint-botd/i;

export function isChallengePage(html: string): boolean {
  return CHALLENGE_HEADLINE.test(headlineText(html)) || CHALLENGE_MARKUP.test(html);
}
