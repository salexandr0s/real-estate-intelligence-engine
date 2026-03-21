/**
 * Cookie consent dismissal for Austrian real estate sites.
 *
 * Tries source-specific selectors first, then falls back to generic
 * German-language consent button patterns. Non-fatal — failures are logged
 * and silently ignored so scraping continues even if consent can't be dismissed.
 */

import { createLogger } from '@rei/observability';
import { interactionDelay } from './delay.js';

const log = createLogger('cookie-consent');

export interface CookieConsentConfig {
  /** CSS selectors for accept buttons, tried in order */
  acceptSelectors: string[];
  /** Timeout for finding each selector (ms) */
  timeoutMs?: number;
}

/** Per-source cookie consent button selectors (most specific first). */
const SOURCE_CONSENT_CONFIG: Record<string, CookieConsentConfig> = {
  willhaben: {
    acceptSelectors: [
      'button[data-testid="uc-accept-all-button"]',
      '#didomi-notice-agree-button',
      'button[id*="accept"]',
    ],
  },
  immoscout24: {
    acceptSelectors: [
      '#uc-btn-accept-banner',
      'button.consent-accept',
      'button[data-testid="uc-accept-all-button"]',
    ],
  },
  wohnnet: {
    acceptSelectors: [
      '.cookie-consent-accept',
      'button[data-cookie-accept]',
      '#onetrust-accept-btn-handler',
    ],
  },
  derstandard: {
    acceptSelectors: [
      '#didomi-notice-agree-button',
      '.privacy-consent-accept',
      'button[data-testid="privacy-accept"]',
    ],
  },
  findmyhome: {
    acceptSelectors: [
      '.cookie-accept',
      'button.consent-accept-all',
      '#cookie-accept-btn',
    ],
  },
  openimmo: {
    acceptSelectors: [
      '.cookie-accept-all',
      'button.consent-accept',
    ],
  },
  remax: {
    acceptSelectors: [
      '#CookieBoxSaveButton',
      '.cookie-consent-accept',
      'button[data-cookie-accept-all]',
    ],
  },
};

/** Generic German/English consent selectors used as fallback. */
const GENERIC_SELECTORS = [
  'button:has-text("Alle akzeptieren")',
  'button:has-text("Akzeptieren")',
  'button:has-text("Zustimmen")',
  'button:has-text("Alle Cookies akzeptieren")',
  'button:has-text("Accept all")',
  'button:has-text("Accept")',
  '[id*="accept"][id*="cookie" i]',
  '[class*="accept"][class*="cookie" i]',
];

/**
 * Attempts to dismiss a cookie consent banner on the current page.
 *
 * Tries source-specific selectors first, then generic patterns.
 * Returns true if a button was found and clicked.
 *
 * @param page - Playwright Page object (typed as unknown to avoid Playwright dep in contracts)
 * @param sourceCode - Source identifier for source-specific selector lookup
 */
export async function dismissCookieConsent(
  page: unknown,
  sourceCode: string,
): Promise<boolean> {
  const p = page as {
    locator(selector: string): { first(): { isVisible(): Promise<boolean>; click(): Promise<void> } };
    waitForTimeout(ms: number): Promise<void>;
  };

  const sourceConfig = SOURCE_CONSENT_CONFIG[sourceCode];
  const selectors = [
    ...(sourceConfig?.acceptSelectors ?? []),
    ...GENERIC_SELECTORS,
  ];

  const timeoutMs = sourceConfig?.timeoutMs ?? 3000;

  try {
    // Brief wait for consent banner to appear
    await p.waitForTimeout(timeoutMs);

    for (const selector of selectors) {
      try {
        const locator = p.locator(selector).first();
        const visible = await locator.isVisible();
        if (visible) {
          await locator.click();
          await interactionDelay();
          log.debug('Cookie consent dismissed', { sourceCode, selector });
          return true;
        }
      } catch {
        // Selector not found or click failed — try next
      }
    }

    log.debug('No cookie consent banner found', { sourceCode });
    return false;
  } catch (err) {
    log.debug('Cookie consent dismissal failed (non-fatal)', {
      sourceCode,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
