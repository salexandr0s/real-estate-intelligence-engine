#!/usr/bin/env npx tsx
/**
 * Generate a manual score-review packet from the latest scored listings.
 *
 * The output is a markdown packet that an investor can review manually and fill
 * in with verdict / disagreement notes.
 *
 * Usage:
 *   npx tsx scripts/score-review-packet.ts [--limit 12] [--output score-review-packet.md]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadConfig } from '@immoradar/config';
import { closePool, query } from '@immoradar/db';

const DEFAULT_LIMIT = 12;

interface ReviewCandidateRow {
  listing_id: string;
  source_code: string;
  title: string;
  district_no: number | null;
  district_name: string | null;
  list_price_eur_cents: string | null;
  current_score: string;
  score_version: number;
  district_price_score: string;
  undervaluation_score: string;
  keyword_signal_score: string;
  time_on_market_score: string;
  confidence_score: string;
  location_score: string | null;
  matched_positive_keywords: string[];
  matched_negative_keywords: string[];
  baseline_fallback_level: string | null;
  version_reason: string | null;
}

interface SelectedCandidate {
  id: number;
  sourceCode: string;
  title: string;
  districtNo: number | null;
  districtName: string | null;
  listPriceEurCents: number | null;
  currentScore: number;
  scoreVersion: number;
  districtPriceScore: number;
  undervaluationScore: number;
  keywordSignalScore: number;
  timeOnMarketScore: number;
  confidenceScore: number;
  locationScore: number | null;
  matchedPositiveKeywords: string[];
  matchedNegativeKeywords: string[];
  baselineFallbackLevel: string | null;
  versionReason: string | null;
}

function parseArgs(): { limit: number; outputPath: string | null } {
  const args = process.argv.slice(2);
  let limit = DEFAULT_LIMIT;
  let outputPath: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = Number.parseInt(args[i + 1]!, 10);
      i++;
      continue;
    }

    if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[i + 1]!;
      i++;
    }
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('--limit must be a positive integer');
  }

  return { limit, outputPath };
}

function toCandidate(row: ReviewCandidateRow): SelectedCandidate {
  return {
    id: Number(row.listing_id),
    sourceCode: row.source_code,
    title: row.title,
    districtNo: row.district_no,
    districtName: row.district_name,
    listPriceEurCents: row.list_price_eur_cents != null ? Number(row.list_price_eur_cents) : null,
    currentScore: Number(row.current_score),
    scoreVersion: row.score_version,
    districtPriceScore: Number(row.district_price_score),
    undervaluationScore: Number(row.undervaluation_score),
    keywordSignalScore: Number(row.keyword_signal_score),
    timeOnMarketScore: Number(row.time_on_market_score),
    confidenceScore: Number(row.confidence_score),
    locationScore: row.location_score != null ? Number(row.location_score) : null,
    matchedPositiveKeywords: row.matched_positive_keywords,
    matchedNegativeKeywords: row.matched_negative_keywords,
    baselineFallbackLevel: row.baseline_fallback_level,
    versionReason: row.version_reason,
  };
}

function scoreBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

function edgeCaseTags(candidate: SelectedCandidate): string[] {
  const tags: string[] = [];
  if (candidate.versionReason === 'relist_detected') tags.push('relist_detected');
  if (candidate.matchedNegativeKeywords.length > 0) tags.push('negative_keyword_penalty');
  if (candidate.locationScore != null && candidate.locationScore < 50)
    tags.push('weak_location_score');
  if (candidate.baselineFallbackLevel && candidate.baselineFallbackLevel !== 'district_bucket') {
    tags.push(`baseline_fallback:${candidate.baselineFallbackLevel}`);
  }
  return tags;
}

function formatEur(value: number | null): string {
  if (value == null) return 'n/a';
  return `EUR ${(value / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function summarize(candidate: SelectedCandidate): string {
  const notes = [
    `district ${candidate.districtPriceScore.toFixed(1)}`,
    `undervaluation ${candidate.undervaluationScore.toFixed(1)}`,
    `keywords ${candidate.keywordSignalScore.toFixed(1)}`,
    `time ${candidate.timeOnMarketScore.toFixed(1)}`,
    `confidence ${candidate.confidenceScore.toFixed(1)}`,
    `location ${candidate.locationScore?.toFixed(1) ?? 'n/a'}`,
  ];
  if (candidate.matchedPositiveKeywords.length > 0) {
    notes.push(`positive keywords: ${candidate.matchedPositiveKeywords.join(', ')}`);
  }
  if (candidate.matchedNegativeKeywords.length > 0) {
    notes.push(`negative keywords: ${candidate.matchedNegativeKeywords.join(', ')}`);
  }
  if (candidate.versionReason) {
    notes.push(`latest version: ${candidate.versionReason}`);
  }
  if (candidate.baselineFallbackLevel) {
    notes.push(`baseline fallback: ${candidate.baselineFallbackLevel}`);
  }
  return notes.join(' · ');
}

function pickBand(
  candidates: SelectedCandidate[],
  band: 'high' | 'medium' | 'low',
  targetCount: number,
  usedIds: Set<number>,
): SelectedCandidate[] {
  const inBand = candidates.filter(
    (candidate) => scoreBand(candidate.currentScore) === band && !usedIds.has(candidate.id),
  );

  const picked: SelectedCandidate[] = [];
  const usedDistricts = new Set<number>();

  for (const candidate of inBand) {
    if (picked.length >= targetCount) break;
    if (candidate.districtNo != null && usedDistricts.has(candidate.districtNo)) continue;
    picked.push(candidate);
    usedIds.add(candidate.id);
    if (candidate.districtNo != null) usedDistricts.add(candidate.districtNo);
  }

  for (const candidate of inBand) {
    if (picked.length >= targetCount) break;
    if (usedIds.has(candidate.id)) continue;
    picked.push(candidate);
    usedIds.add(candidate.id);
  }

  return picked;
}

function ensureEdgeCase(
  selected: SelectedCandidate[],
  allCandidates: SelectedCandidate[],
): SelectedCandidate[] {
  if (selected.some((candidate) => edgeCaseTags(candidate).length > 0)) {
    return selected;
  }

  const replacement = allCandidates.find(
    (candidate) =>
      !selected.some((entry) => entry.id === candidate.id) && edgeCaseTags(candidate).length > 0,
  );

  if (!replacement || selected.length === 0) {
    return selected;
  }

  const updated = [...selected];
  updated[updated.length - 1] = replacement;
  return updated;
}

async function main(): Promise<void> {
  const { limit, outputPath } = parseArgs();
  loadConfig();

  const rows = await query<ReviewCandidateRow>(
    `SELECT
       l.id::text AS listing_id,
       s.code AS source_code,
       l.title,
       l.district_no,
       l.district_name,
       l.list_price_eur_cents::text,
       l.current_score::text,
       ls.score_version,
       ls.district_price_score::text,
       ls.undervaluation_score::text,
       ls.keyword_signal_score::text,
       ls.time_on_market_score::text,
       ls.confidence_score::text,
       ls.location_score::text,
       ls.matched_positive_keywords,
       ls.matched_negative_keywords,
       ls.baseline_fallback_level,
       lv.version_reason
     FROM listings l
     JOIN sources s ON s.id = l.source_id
     JOIN LATERAL (
       SELECT *
       FROM listing_scores ls
       WHERE ls.listing_id = l.id
       ORDER BY ls.scored_at DESC
       LIMIT 1
     ) ls ON true
     LEFT JOIN LATERAL (
       SELECT version_reason
       FROM listing_versions lv
       WHERE lv.listing_id = l.id
       ORDER BY lv.version_no DESC
       LIMIT 1
     ) lv ON true
     WHERE l.listing_status = 'active'
       AND l.current_score IS NOT NULL
       AND l.district_no IS NOT NULL
     ORDER BY l.current_score DESC, l.id DESC
     LIMIT 250`,
  );

  const candidates = rows.map(toCandidate);
  const perBand = Math.max(1, Math.floor(limit / 3));
  const usedIds = new Set<number>();
  const selected = [
    ...pickBand(candidates, 'high', perBand, usedIds),
    ...pickBand(candidates, 'medium', perBand, usedIds),
    ...pickBand(candidates, 'low', perBand, usedIds),
  ];

  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (usedIds.has(candidate.id)) continue;
    selected.push(candidate);
    usedIds.add(candidate.id);
  }

  const finalSelection = ensureEdgeCase(selected.slice(0, limit), candidates);

  const markdown = [
    '# Manual Score Review Packet',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Requested sample size: ${limit}`,
    'Selection policy: 4 high / 4 medium / 4 low when available, spread across districts first, then fill remaining slots.',
    'Reviewer goal: compare the stored score explanation against actual investor judgment and record any material disagreement.',
    '',
    '## Reviewer checklist',
    '',
    '- Mark an **investor verdict** for every listing.',
    '- Record **disagreement severity** (`none`, `minor`, `major`).',
    '- Note any follow-up action required before changing score weights or score version.',
    '',
    '## Coverage summary',
    '',
    `- Selected listings: ${finalSelection.length}`,
    `- High band: ${finalSelection.filter((candidate) => scoreBand(candidate.currentScore) === 'high').length}`,
    `- Medium band: ${finalSelection.filter((candidate) => scoreBand(candidate.currentScore) === 'medium').length}`,
    `- Low band: ${finalSelection.filter((candidate) => scoreBand(candidate.currentScore) === 'low').length}`,
    `- Edge-case examples: ${finalSelection.filter((candidate) => edgeCaseTags(candidate).length > 0).length}`,
    '',
  ];

  for (const [index, candidate] of finalSelection.entries()) {
    const tags = edgeCaseTags(candidate);
    markdown.push(`## Example ${index + 1}: #${candidate.id} (${candidate.sourceCode})`);
    markdown.push('');
    markdown.push(`- Score band: **${scoreBand(candidate.currentScore)}**`);
    markdown.push(
      `- Score: **${candidate.currentScore.toFixed(2)}** (version ${candidate.scoreVersion})`,
    );
    markdown.push(
      `- District: ${candidate.districtNo ?? 'n/a'} ${candidate.districtName ?? ''}`.trim(),
    );
    markdown.push(`- Price: ${formatEur(candidate.listPriceEurCents)}`);
    markdown.push(`- Title: ${candidate.title}`);
    markdown.push(`- Edge-case tags: ${tags.length > 0 ? tags.join(', ') : 'none'}`);
    markdown.push(`- Score explanation summary: ${summarize(candidate)}`);
    markdown.push('- Investor verdict: [ ] strong yes  [ ] maybe  [ ] pass');
    markdown.push('- Disagreement severity: [ ] none  [ ] minor  [ ] major');
    markdown.push('- Follow-up action: ________________________________');
    markdown.push('- Reviewer notes: _________________________________');
    markdown.push('');
  }

  const output = `${markdown.join('\n').trim()}\n`;

  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output, 'utf8');
    console.log(`Wrote score review packet to ${outputPath}`);
  } else {
    process.stdout.write(output);
  }

  await closePool();
}

main().catch(async (error) => {
  console.error('Score review packet generation failed:', error);
  await closePool().catch(() => undefined);
  process.exit(1);
});
