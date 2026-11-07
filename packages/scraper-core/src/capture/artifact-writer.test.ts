import { mkdir, mkdtemp, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactWriter, pruneFailureArtifacts } from './artifact-writer.js';

const DAY_MS = 86_400_000;

let artifactsDir: string;

beforeEach(async () => {
  artifactsDir = await mkdtemp(join(tmpdir(), 'immoradar-artifacts-'));
});

afterEach(async () => {
  await rm(artifactsDir, { recursive: true, force: true });
});

async function fileAgedDays(relativePath: string, days: number): Promise<string> {
  const path = join(artifactsDir, relativePath);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, 'x'.repeat(10));
  const when = new Date(Date.now() - days * DAY_MS);
  await utimes(path, when, when);
  return path;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe('ArtifactWriter', () => {
  it('writes under failures/ and returns a key relative to the artifacts directory', async () => {
    const writer = new ArtifactWriter(artifactsDir);

    const key = await writer.writeHtml(
      'willhaben',
      '42',
      'https://example.test/1',
      '<html></html>',
    );

    expect(key).toMatch(
      /^failures\/raw-html\/willhaben\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]+\.html\.gz$/,
    );
    expect(await exists(join(artifactsDir, key))).toBe(true);
  });

  it('takes viewport-only screenshots', async () => {
    const writer = new ArtifactWriter(artifactsDir);
    const page = { screenshot: vi.fn(async () => Buffer.from('png')) };

    const key = await writer.captureScreenshot('willhaben', '42', 'https://example.test/1', page);

    expect(page.screenshot).toHaveBeenCalledWith({ fullPage: false, type: 'png' });
    expect(key).toMatch(/^failures\/screenshots\/willhaben\//);
  });
});

describe('pruneFailureArtifacts', () => {
  it('removes only files under failures/ older than the retention', async () => {
    const oldFile = await fileAgedDays('failures/raw-html/willhaben/2026/10/01/a.html.gz', 8);
    const recentFile = await fileAgedDays('failures/raw-html/willhaben/2026/11/06/b.html.gz', 1);
    const oldOutside = await fileAgedDays('mail/raw/c.eml', 30);
    const oldDocument = await fileAgedDays('documents/d.pdf', 30);

    const result = await pruneFailureArtifacts(artifactsDir, 7);

    expect(result).toEqual({ removedFiles: 1, removedBytes: 10 });
    expect(await exists(oldFile)).toBe(false);
    expect(await exists(recentFile)).toBe(true);
    expect(await exists(oldOutside)).toBe(true);
    expect(await exists(oldDocument)).toBe(true);
  });

  it('leaves a symlink and the folder it points to alone', async () => {
    const outside = await fileAgedDays('elsewhere/keep.txt', 30);
    await mkdir(join(artifactsDir, 'failures'), { recursive: true });
    await symlink(join(artifactsDir, 'elsewhere'), join(artifactsDir, 'failures', 'link'));

    await pruneFailureArtifacts(artifactsDir, 7);

    expect(await exists(outside)).toBe(true);
    expect(await readdir(join(artifactsDir, 'failures'))).toEqual(['link']);
  });

  it('does nothing when there is no failures folder yet', async () => {
    await expect(pruneFailureArtifacts(artifactsDir, 7)).resolves.toEqual({
      removedFiles: 0,
      removedBytes: 0,
    });
  });

  it.each([0, -1, Number.NaN])('refuses a retention of %s days', async (days) => {
    await fileAgedDays('failures/raw-html/willhaben/2026/11/06/b.html.gz', 0);

    await expect(pruneFailureArtifacts(artifactsDir, days)).rejects.toThrow(RangeError);
  });
});
