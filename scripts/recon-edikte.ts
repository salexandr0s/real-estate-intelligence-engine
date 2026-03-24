#!/usr/bin/env npx tsx
/**
 * Reconnaissance script for edikte.justiz.gv.at (Zwangsversteigerungen).
 *
 * Captures HTML fixtures from the Lotus Notes/Domino site:
 * 1. Search form structure (field names, categories, selectors)
 * 2. Search results page (table structure, detail links, pagination)
 * 3. Edict detail page (metadata fields, PDF attachment links)
 * 4. Sample PDF document
 *
 * Output: packages/source-edikte/fixtures/
 *
 * Usage:
 *   npx tsx scripts/recon-edikte.ts
 *   npx tsx scripts/recon-edikte.ts --headed   # visible browser for debugging
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = 'https://edikte.justiz.gv.at';
const SEARCH_FORM_URL = `${BASE_URL}/edikte/ex/exedi3.nsf/suche?OpenForm`;

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'packages', 'source-edikte', 'fixtures');

function save(filename: string, content: string | Buffer): void {
  const path = join(FIXTURES_DIR, filename);
  writeFileSync(path, content);
  const size = typeof content === 'string' ? content.length : content.length;
  console.log(`  Saved: ${filename} (${(size / 1024).toFixed(1)} KB)`);
}

async function main(): Promise<void> {
  const headed = process.argv.includes('--headed');
  mkdirSync(FIXTURES_DIR, { recursive: true });

  console.log('=== Edikte.justiz.gv.at Reconnaissance ===\n');
  console.log(`Output: ${FIXTURES_DIR}`);
  console.log(`Mode: ${headed ? 'headed (visible browser)' : 'headless'}\n`);

  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: 'de-AT',
    timezoneId: 'Europe/Vienna',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    // ── Step 1: Capture search form ──────────────────────────────────────
    console.log('Step 1: Capturing search form...');
    await page.goto(SEARCH_FORM_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3000); // Let Dojo framework initialize

    const formHtml = await page.content();
    save('search-form.html', formHtml);
    await page.screenshot({ path: join(FIXTURES_DIR, 'search-form.png'), fullPage: true });
    console.log('  Saved: search-form.png');

    // Analyze form structure
    const formAnalysis = await page.evaluate(() => {
      const forms = document.querySelectorAll('form');
      const formData: Array<{
        action: string;
        method: string;
        fields: Array<{ tag: string; name: string; type: string; id: string; options?: string[] }>;
      }> = [];

      forms.forEach((form) => {
        const fields: Array<{
          tag: string;
          name: string;
          type: string;
          id: string;
          options?: string[];
        }> = [];

        // Inputs
        form.querySelectorAll('input, select, textarea').forEach((el) => {
          const field: { tag: string; name: string; type: string; id: string; options?: string[] } =
            {
              tag: el.tagName.toLowerCase(),
              name: el.getAttribute('name') ?? '',
              type: el.getAttribute('type') ?? el.tagName.toLowerCase(),
              id: el.id,
            };

          if (el.tagName === 'SELECT') {
            field.options = Array.from(el.querySelectorAll('option')).map(
              (opt) => `${opt.getAttribute('value') ?? ''}: ${opt.textContent?.trim() ?? ''}`,
            );
          }

          fields.push(field);
        });

        formData.push({
          action: form.action,
          method: form.method,
          fields,
        });
      });

      return formData;
    });

    save('form-analysis.json', JSON.stringify(formAnalysis, null, 2));
    console.log(
      `  Found ${formAnalysis.length} form(s) with ${formAnalysis.reduce((s, f) => s + f.fields.length, 0)} fields total`,
    );

    // ── Step 2: Submit search ────────────────────────────────────────────
    console.log('\nStep 2: Submitting search for Wien...');

    // Use the real field names from form-analysis.json:
    // Form action: /submitSuche, fields: BL (select), VKat (select), VOrt (input), VPLZ (input), sebut (submit)

    // Select Bundesland = Wien (code "0")
    try {
      const blSelect = page.locator('select#BL').first();
      if (await blSelect.isVisible({ timeout: 2000 })) {
        await blSelect.selectOption('0'); // Wien = "0"
        console.log('  Selected Bundesland: Wien (code 0)');
        await page.waitForTimeout(500);
      } else {
        console.log('  WARNING: BL select not visible');
      }
    } catch (err) {
      console.log(
        `  WARNING: Could not set Bundesland: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Wait a moment then submit via the sebut button
    await page.waitForTimeout(1000);

    // Click the search button (name="sebut")
    let submitted = false;
    try {
      const submitBtn = page.locator('input[name="sebut"]').first();
      if (await submitBtn.isVisible({ timeout: 2000 })) {
        console.log('  Clicking submit button (sebut)...');
        await submitBtn.click();
        submitted = true;
      }
    } catch {
      // Try next approach
    }

    if (!submitted) {
      console.log('  Trying form.submit() on submitSuche form...');
      await page.evaluate(() => {
        const form = document.querySelector(
          'form[action*="submitSuche"]',
        ) as HTMLFormElement | null;
        if (form) form.submit();
      });
    }

    // Wait for navigation/results
    await page.waitForTimeout(5000);

    // ── Step 3: Capture results page ─────────────────────────────────────
    console.log('\nStep 3: Capturing results page...');
    const resultsHtml = await page.content();
    save('results-page.html', resultsHtml);
    await page.screenshot({ path: join(FIXTURES_DIR, 'results-page.png'), fullPage: true });
    console.log('  Saved: results-page.png');

    // Analyze results structure
    const resultsAnalysis = await page.evaluate(() => {
      // Look for common result patterns
      const tables = document.querySelectorAll('table');
      const links = document.querySelectorAll('a[href]');
      const resultLinks: Array<{ href: string; text: string }> = [];

      links.forEach((a) => {
        const href = a.getAttribute('href') ?? '';
        const text = a.textContent?.trim() ?? '';
        // Domino document links often contain UNIDs or OpenDocument
        if (
          href.includes('exedi3.nsf') ||
          href.includes('OpenDocument') ||
          /\/[0-9A-Fa-f]{32}/.test(href)
        ) {
          resultLinks.push({ href, text: text.slice(0, 200) });
        }
      });

      return {
        tableCount: tables.length,
        linkCount: links.length,
        dominoLinks: resultLinks.slice(0, 30), // First 30 results
        bodyTextPreview: document.body?.textContent?.slice(0, 2000)?.replace(/\s+/g, ' '),
      };
    });

    save('results-analysis.json', JSON.stringify(resultsAnalysis, null, 2));
    console.log(
      `  Found ${resultsAnalysis.tableCount} tables, ${resultsAnalysis.dominoLinks.length} Domino document links`,
    );

    // ── Step 4: Capture detail page ──────────────────────────────────────
    // Find a "Versteigerung" link (actual auction) — skip navigation links and other types
    const auctionLink = resultsAnalysis.dominoLinks.find(
      (l) => l.href.includes('alldoc/') && l.text.includes('Versteigerung'),
    );
    const linkToFollow =
      auctionLink ?? resultsAnalysis.dominoLinks.find((l) => l.href.includes('alldoc/'));
    if (linkToFollow) {
      const detailUrl = linkToFollow.href.startsWith('http')
        ? linkToFollow.href
        : `${BASE_URL}/edikte/ex/exedi3.nsf/${linkToFollow.href}`;

      console.log(`\nStep 4: Capturing detail page: ${detailUrl}`);
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(3000);

      const detailHtml = await page.content();
      save('detail-page.html', detailHtml);
      await page.screenshot({ path: join(FIXTURES_DIR, 'detail-page.png'), fullPage: true });
      console.log('  Saved: detail-page.png');

      // Analyze detail structure
      const detailAnalysis = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href]');
        const pdfLinks: Array<{ href: string; text: string }> = [];

        links.forEach((a) => {
          const href = a.getAttribute('href') ?? '';
          if (href.includes('.pdf') || href.includes('$file')) {
            pdfLinks.push({
              href,
              text: a.textContent?.trim() ?? '',
            });
          }
        });

        return {
          title: document.title,
          pdfLinks,
          bodyTextPreview: document.body?.textContent?.slice(0, 5000)?.replace(/\s+/g, ' '),
          metaTags: Array.from(document.querySelectorAll('meta')).map((m) => ({
            name: m.getAttribute('name'),
            content: m.getAttribute('content'),
          })),
        };
      });

      save('detail-analysis.json', JSON.stringify(detailAnalysis, null, 2));
      console.log(`  Title: ${detailAnalysis.title}`);
      console.log(`  PDF links found: ${detailAnalysis.pdfLinks.length}`);

      // ── Step 5: Download sample PDF ──────────────────────────────────
      if (detailAnalysis.pdfLinks.length > 0) {
        const pdfLink = detailAnalysis.pdfLinks[0]!;
        const pdfUrl = pdfLink.href.startsWith('http')
          ? pdfLink.href
          : `${BASE_URL}${pdfLink.href}`;

        console.log(`\nStep 5: Downloading sample PDF: ${pdfUrl}`);
        try {
          const response = await page.context().request.get(pdfUrl);
          if (response.status() === 200) {
            const body = await response.body();
            save('sample-document.pdf', body);
            console.log(`  PDF size: ${(body.length / 1024).toFixed(1)} KB`);

            // Quick text extraction test
            const textContent = body.toString('latin1');
            const hasTextLayer =
              textContent.includes('/Type /Font') || textContent.match(/\([\w\s]{10,}\)\s*Tj/);
            console.log(
              `  Has text layer: ${hasTextLayer ? 'YES (good for pdf-parse)' : 'LIKELY NO (may need AI extraction)'}`,
            );
          } else {
            console.log(`  PDF download failed: HTTP ${response.status()}`);
          }
        } catch (err) {
          console.log(`  PDF download error: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        console.log('\nStep 5: No PDF links found on detail page');
      }
    } else {
      console.log('\nStep 4: No detail links found in results — check results-page.html manually');
    }

    // ── Summary ──────────────────────────────────────────────────────────
    console.log('\n=== Reconnaissance Complete ===');
    console.log(`Output directory: ${FIXTURES_DIR}`);
    console.log('\nFiles generated:');
    console.log('  search-form.html     — Raw search form page');
    console.log('  form-analysis.json   — Parsed form fields and options');
    console.log('  results-page.html    — Search results page');
    console.log('  results-analysis.json — Parsed result links and structure');
    console.log('  detail-page.html     — Individual edict page');
    console.log('  detail-analysis.json — Parsed detail fields and PDF links');
    console.log('  sample-document.pdf  — Sample PDF attachment');
    console.log('\nNext steps:');
    console.log('  1. Review the HTML fixtures to identify exact selectors');
    console.log('  2. Update packages/source-edikte/src/constants.ts with real selectors');
    console.log('  3. Refine discovery.ts and detail.ts parsers to match actual HTML');
  } catch (err) {
    console.error('\nFATAL:', err instanceof Error ? err.message : String(err));
    // Save whatever we have
    try {
      const html = await page.content();
      save('error-page.html', html);
      await page.screenshot({ path: join(FIXTURES_DIR, 'error-screenshot.png') });
    } catch {
      // Nothing to save
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
