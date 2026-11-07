import { createLogger } from '@immoradar/observability';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

const logger = createLogger('artifact-writer');

/** Folder inside the artifacts directory that holds every scraper artifact. */
const FAILURES_DIR = 'failures';

const DAY_MS = 86_400_000;

/** The part of a Playwright or Patchright page that a screenshot needs. */
export interface ScreenshotPage {
  screenshot(options: { fullPage: false; type: 'png' }): Promise<Buffer>;
}

/**
 * Interface for writing scraper artifacts (HTML snapshots, screenshots, HARs) to storage.
 * Implementations may target local filesystem, S3, or other backends.
 */
export interface ArtifactWriterPort {
  writeHtml(sourceCode: string, runId: string, key: string, html: string): Promise<string>;
  writeScreenshot(sourceCode: string, runId: string, key: string, buffer: Buffer): Promise<string>;
  captureScreenshot(
    sourceCode: string,
    runId: string,
    key: string,
    page: ScreenshotPage,
  ): Promise<string>;
  writeHar(sourceCode: string, runId: string, key: string, buffer: Buffer): Promise<string>;
}

/**
 * Generate a storage key, relative to the artifacts directory, following the pattern:
 *   failures/{prefix}/{sourceCode}/{yyyy}/{mm}/{dd}/{uuid}.{ext}
 */
function generateStorageKey(prefix: string, sourceCode: string, extension: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = now.getUTCDate().toString().padStart(2, '0');
  const uuid = randomUUID();

  return `${FAILURES_DIR}/${prefix}/${sourceCode}/${yyyy}/${mm}/${dd}/${uuid}.${extension}`;
}

/**
 * Local filesystem implementation of ArtifactWriter.
 *
 * Stores artifacts under `failures/` in the artifacts directory, with date-partitioned paths, so
 * `pruneFailureArtifacts` can expire them. HTML files are gzip-compressed before writing.
 */
export class ArtifactWriter implements ArtifactWriterPort {
  private readonly baseDir: string;

  /** @param baseDir The configured artifacts directory (`config.artifacts.dir`). */
  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * Write an HTML snapshot to storage (gzip-compressed).
   *
   * @returns The storage key (path relative to the artifacts directory) of the written file
   */
  async writeHtml(sourceCode: string, runId: string, _key: string, html: string): Promise<string> {
    const storageKey = generateStorageKey('raw-html', sourceCode, 'html.gz');
    const fullPath = join(this.baseDir, storageKey);

    await mkdir(dirname(fullPath), { recursive: true });

    const compressed = await gzipAsync(Buffer.from(html, 'utf-8'));
    await writeFile(fullPath, compressed);

    logger.debug('Wrote HTML artifact', {
      sourceCode,
      scrapeRunId: parseInt(runId, 10) || undefined,
      storageKey,
      originalBytes: html.length,
      compressedBytes: compressed.length,
    });

    return storageKey;
  }

  /**
   * Write a screenshot the caller already took. Prefer `captureScreenshot`, which takes a
   * viewport-only shot.
   *
   * @returns The storage key (path relative to the artifacts directory) of the written file
   */
  async writeScreenshot(
    sourceCode: string,
    runId: string,
    _key: string,
    buffer: Buffer,
  ): Promise<string> {
    const storageKey = generateStorageKey('screenshots', sourceCode, 'png');
    const fullPath = join(this.baseDir, storageKey);

    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, buffer);

    logger.debug('Wrote screenshot artifact', {
      sourceCode,
      scrapeRunId: parseInt(runId, 10) || undefined,
      storageKey,
      bytes: buffer.length,
    });

    return storageKey;
  }

  /**
   * Take a viewport-only PNG of the page and write it. A full-page shot of a long listing page
   * runs to megabytes, and the viewport shows what a failure looked like.
   *
   * @returns The storage key (path relative to the artifacts directory) of the written file
   */
  async captureScreenshot(
    sourceCode: string,
    runId: string,
    key: string,
    page: ScreenshotPage,
  ): Promise<string> {
    const buffer = await page.screenshot({ fullPage: false, type: 'png' });
    return this.writeScreenshot(sourceCode, runId, key, buffer);
  }

  /**
   * Write a HAR (HTTP Archive) file to storage.
   *
   * HAR files are saved as-is (JSON format). They capture all network
   * requests and responses during a browser session.
   *
   * @returns The storage key (path relative to the artifacts directory) of the written file
   */
  async writeHar(sourceCode: string, runId: string, _key: string, buffer: Buffer): Promise<string> {
    const storageKey = generateStorageKey('har', sourceCode, 'har');
    const fullPath = join(this.baseDir, storageKey);

    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, buffer);

    logger.debug('Wrote HAR artifact', {
      sourceCode,
      scrapeRunId: parseInt(runId, 10) || undefined,
      storageKey,
      bytes: buffer.length,
    });

    return storageKey;
  }
}

export interface PruneResult {
  removedFiles: number;
  removedBytes: number;
}

function hasErrorCode(err: unknown, code: string): boolean {
  return err instanceof Error && 'code' in err && err.code === code;
}

async function pruneDirectory(
  path: string,
  cutoffMs: number,
  result: PruneResult,
  removeWhenEmpty: boolean,
): Promise<void> {
  let modifiedMs: number;
  let entries;
  try {
    modifiedMs = (await lstat(path)).mtimeMs;
    entries = await readdir(path, { withFileTypes: true });
  } catch (err) {
    if (hasErrorCode(err, 'ENOENT')) return;
    throw err;
  }

  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      await pruneDirectory(child, cutoffMs, result, true);
      continue;
    }
    // Symlinks and other special files were not written here and stay.
    if (!entry.isFile()) continue;
    try {
      const info = await lstat(child);
      if (info.mtimeMs >= cutoffMs) continue;
      await unlink(child);
      result.removedFiles += 1;
      result.removedBytes += info.size;
    } catch (err) {
      if (!hasErrorCode(err, 'ENOENT')) {
        logger.warn('Could not prune failure artifact', {
          path: child,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // A folder nobody added to within the retention window goes once it is empty. rmdir refuses a
  // folder that still has entries, and a folder the writer just made has a recent mtime.
  if (removeWhenEmpty && modifiedMs < cutoffMs) {
    await rmdir(path).catch(() => undefined);
  }
}

/**
 * Removes files under `<dir>/failures` last modified more than `days` days ago, and folders there
 * that are left empty. Nothing outside `<dir>/failures` is touched, and symlinks are skipped.
 *
 * @param dir The artifacts directory (`config.artifacts.dir`)
 * @param days Retention in days (`config.scraper.artifactRetentionDays`); must be positive
 * @throws RangeError when `days` is not a positive number
 */
export async function pruneFailureArtifacts(dir: string, days: number): Promise<PruneResult> {
  if (!Number.isFinite(days) || days <= 0) {
    throw new RangeError(`Artifact retention must be a positive number of days, got ${days}`);
  }
  const result: PruneResult = { removedFiles: 0, removedBytes: 0 };
  await pruneDirectory(join(dir, FAILURES_DIR), Date.now() - days * DAY_MS, result, false);
  return result;
}
