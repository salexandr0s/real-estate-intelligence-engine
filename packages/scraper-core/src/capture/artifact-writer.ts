import { createLogger } from '@rei/observability';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const logger = createLogger('artifact-writer');

/**
 * Interface for writing scraper artifacts (HTML snapshots, screenshots) to storage.
 * Implementations may target local filesystem, S3, or other backends.
 */
export interface ArtifactWriterPort {
  writeHtml(sourceCode: string, runId: string, key: string, html: string): Promise<string>;
  writeScreenshot(sourceCode: string, runId: string, key: string, buffer: Buffer): Promise<string>;
}

/**
 * Generate a storage key following the pattern:
 *   {prefix}/{sourceCode}/{yyyy}/{mm}/{dd}/{uuid}.{ext}
 */
function generateStorageKey(
  prefix: string,
  sourceCode: string,
  extension: string,
): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = now.getUTCDate().toString().padStart(2, '0');
  const uuid = randomUUID();

  return `${prefix}/${sourceCode}/${yyyy}/${mm}/${dd}/${uuid}.${extension}`;
}

/**
 * Local filesystem implementation of ArtifactWriter.
 *
 * Stores artifacts under a configurable base directory with date-partitioned paths.
 * HTML files are gzip-compressed before writing.
 */
export class ArtifactWriter implements ArtifactWriterPort {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * Write an HTML snapshot to storage (gzip-compressed).
   *
   * @returns The storage key (relative path) of the written file
   */
  async writeHtml(
    sourceCode: string,
    runId: string,
    _key: string,
    html: string,
  ): Promise<string> {
    const storageKey = generateStorageKey('raw-html', sourceCode, 'html.gz');
    const fullPath = join(this.baseDir, storageKey);

    await mkdir(dirname(fullPath), { recursive: true });

    const compressed = gzipSync(Buffer.from(html, 'utf-8'));
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
   * Write a screenshot to storage.
   *
   * @returns The storage key (relative path) of the written file
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
}
