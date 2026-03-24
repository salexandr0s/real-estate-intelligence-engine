#!/usr/bin/env npx tsx
/**
 * Captures real HTML from Austrian real estate sites for fixture generation.
 *
 * Usage:
 *   npx tsx scripts/capture-site-html.ts [--source <code>] [--all]
 *
 * Saves to: /tmp/immoradar-captures/<sourceCode>/
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SITES: Record<string, { discoveryUrl: string; name: string }> = {
  immoscout24: {
    discoveryUrl: 'https://www.immobilienscout24.at/suche/wohnung-kaufen/wien',
    name: 'ImmobilienScout24.at',
  },
  wohnnet: {
    discoveryUrl: 'https://www.wohnnet.at/immobilien/eigentumswohnungen/wien',
    name: 'wohnnet.at',
  },
  derstandard: {
    discoveryUrl: 'https://immobilien.derstandard.at/immobiliensuche/i/kaufen/wohnung/wien',
    name: 'derstandard.at Immobilien',
  },
  findmyhome: {
    discoveryUrl: 'https://www.findmyhome.at/immobiliensuche',
    name: 'findmyhome.at',
  },
  openimmo: {
    discoveryUrl: 'https://www.openimmo.at',
    name: 'openimmo.at',
  },
  remax: {
    discoveryUrl: 'https://www.remax.at/de/immobilien/immobilien-suchen',
    name: 'RE/MAX Austria',
  },
};

const COOKIE_SELECTORS = [
  'button:has-text("Alle akzeptieren")',
  'button:has-text("Akzeptieren")',
  'button:has-text("Zustimmen")',
  'button:has-text("Alle Cookies akzeptieren")',
  '#didomi-notice-agree-button',
  'button[data-testid="uc-accept-all-button"]',
  '#uc-btn-accept-banner',
  '#CookieBoxSaveButton',
  '#onetrust-accept-btn-handler',
];

async function dismissCookies(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newPage']>>,
): Promise<void> {
  await page.waitForTimeout(2000);
  for (const sel of COOKIE_SELECTORS) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 500 })) {
        await loc.click();
        await page.waitForTimeout(1000);
        console.log(`  Cookie consent dismissed via: ${sel}`);
        return;
      }
    } catch {
      /* next */
    }
  }
  console.log('  No cookie consent banner found');
}

function saveHtml(outDir: string, filename: string, html: string): void {
  writeFileSync(join(outDir, filename), html, 'utf-8');
  console.log(`  Saved: ${filename} (${(html.length / 1024).toFixed(1)} KB)`);
}

async function captureSource(sourceCode: string): Promise<void> {
  const site = SITES[sourceCode];
  if (!site) {
    console.error(`Unknown source: ${sourceCode}`);
    return;
  }

  const outDir = `/tmp/immoradar-captures/${sourceCode}`;
  mkdirSync(outDir, { recursive: true });

  console.log(`\n=== Capturing: ${site.name} (${sourceCode}) ===`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: 'de-AT',
    timezoneId: 'Europe/Vienna',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  });

  try {
    const page = await context.newPage();

    // 1. Discovery page
    console.log(`  Navigating to: ${site.discoveryUrl}`);
    try {
      await page.goto(site.discoveryUrl, { waitUntil: 'networkidle', timeout: 30_000 });
      await dismissCookies(page);
      await page.waitForTimeout(2000); // Let dynamic content settle

      const discoveryHtml = await page.content();
      saveHtml(outDir, 'discovery-page.html', discoveryHtml);

      // Take screenshot for visual reference
      await page.screenshot({ path: join(outDir, 'discovery-screenshot.png'), fullPage: false });
      console.log('  Saved: discovery-screenshot.png');

      // 2. Find and click a detail link
      const detailLink = await findDetailLink(page, sourceCode);
      if (detailLink) {
        console.log(`  Navigating to detail: ${detailLink}`);
        await page.goto(detailLink, { waitUntil: 'networkidle', timeout: 30_000 });
        await page.waitForTimeout(2000);

        const detailHtml = await page.content();
        saveHtml(outDir, 'detail-page.html', detailHtml);
        await page.screenshot({ path: join(outDir, 'detail-screenshot.png'), fullPage: false });
        console.log('  Saved: detail-screenshot.png');
      } else {
        console.log('  WARNING: No detail link found');
      }

      // 3. Extract JSON-LD and embedded data
      const jsonLd = await page.evaluate(() => {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        return Array.from(scripts).map((s) => s.textContent);
      });
      if (jsonLd.length > 0) {
        writeFileSync(join(outDir, 'json-ld.json'), JSON.stringify(jsonLd, null, 2), 'utf-8');
        console.log(`  Saved: json-ld.json (${jsonLd.length} blocks)`);
      }
    } catch (err) {
      console.error(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
      saveHtml(outDir, 'error.txt', String(err));
    }
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(`  Output: ${outDir}`);
}

async function findDetailLink(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newPage']>>,
  sourceCode: string,
): Promise<string | null> {
  const strategies: Record<string, () => Promise<string | null>> = {
    wohnnet: async () => {
      const link = page.locator('a[href*="/immobilien/eigentumswohnung-"]').first();
      const href = await link.getAttribute('href');
      return href ? `https://www.wohnnet.at${href}` : null;
    },
    derstandard: async () => {
      const link = page.locator('a[href*="/detail/"]').first();
      const href = await link.getAttribute('href');
      return href ? `https://immobilien.derstandard.at${href.split('?')[0]}` : null;
    },
    remax: async () => {
      const link = page.locator('a[href*="page=objekt"]').first();
      return await link.getAttribute('href');
    },
    immoscout24: async () => {
      const link = page.locator('a[href*="/expose/"]').first();
      const href = await link.getAttribute('href');
      return href?.startsWith('http') ? href : `https://www.immobilienscout24.at${href}`;
    },
    findmyhome: async () => {
      // findmyhome loads results via AJAX, try to find any property link
      await page.waitForTimeout(5000); // Wait for AJAX
      const link = page.locator('a[href*="module=og"]').first();
      return await link.getAttribute('href');
    },
    openimmo: async () => null,
  };

  try {
    const strategy = strategies[sourceCode];
    if (!strategy) return null;
    return await strategy();
  } catch {
    return null;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let sourceCodes: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      sourceCodes.push(args[i + 1]!);
      i++;
    }
    if (args[i] === '--all') {
      sourceCodes = Object.keys(SITES);
    }
  }

  if (sourceCodes.length === 0) {
    console.log(
      'Usage: npx tsx scripts/capture-site-html.ts --source <code> [--source <code2>] | --all',
    );
    console.log('Available sources:', Object.keys(SITES).join(', '));
    process.exit(1);
  }

  for (const code of sourceCodes) {
    await captureSource(code);
  }

  console.log('\nDone. Check /tmp/immoradar-captures/ for output.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
