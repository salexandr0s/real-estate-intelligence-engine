import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadCanaryConfig, loadConfig, loadRepoEnvFiles, resetConfig } from './index.js';

const ENV_KEYS = [
  'NODE_ENV',
  'API_BEARER_TOKEN',
  'PLAYWRIGHT_HEADLESS',
  'PROMETHEUS_ENABLED',
  'METRICS_TOKEN',
  'API_DOCS_PUBLIC',
  'API_DOCS_PUBLIC_PRODUCTION_OVERRIDE',
  'API_TRUST_PROXY',
  'DOCUMENT_DOWNLOAD_TIMEOUT_MS',
  'DOCUMENT_MAX_BYTES',
  'IMMORADAR_RUNTIME_BOOT_MODE',
  'IMMORADAR_RUNTIME_HOME',
  'ARTIFACTS_DIR',
  'FEATURE_GEOCODING_ENABLED',
] as const;

describe('config loaders', () => {
  afterEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    resetConfig();
  });

  it('allows canary config in production without API bearer token', () => {
    process.env.NODE_ENV = 'production';

    const config = loadCanaryConfig();

    expect(config.nodeEnv).toBe('production');
    expect(config.playwright.headless).toBe(true);
  });

  it('keeps full production config strict about API bearer token', () => {
    process.env.NODE_ENV = 'production';
    process.env.PROMETHEUS_ENABLED = 'false';

    expect(() => loadConfig()).toThrow(/API_BEARER_TOKEN/);
  });

  it('requires METRICS_TOKEN in production when Prometheus is enabled', () => {
    process.env.NODE_ENV = 'production';
    process.env.API_BEARER_TOKEN = 'prod-token';
    process.env.PROMETHEUS_ENABLED = 'true';

    expect(() => loadConfig()).toThrow(/METRICS_TOKEN/);
  });

  it('blocks public docs in production without an explicit override', () => {
    process.env.NODE_ENV = 'production';
    process.env.API_BEARER_TOKEN = 'prod-token';
    process.env.METRICS_TOKEN = 'metrics-token';
    process.env.API_DOCS_PUBLIC = 'true';

    expect(() => loadConfig()).toThrow(/API_DOCS_PUBLIC_PRODUCTION_OVERRIDE/);
  });

  it('defaults trustProxy to false and document limits to hardened defaults', () => {
    const config = loadConfig();

    expect(config.api.trustProxy).toBe(false);
    expect(config.documents.downloadTimeoutMs).toBe(20000);
    expect(config.documents.maxBytes).toBe(10000000);
  });

  it('keeps a proxy address intact and refuses a hop count', () => {
    process.env.API_TRUST_PROXY = '10.0.0.1';
    expect(loadConfig().api.trustProxy).toBe('10.0.0.1');

    resetConfig();
    process.env.API_TRUST_PROXY = '1';
    expect(() => loadConfig()).toThrow(/API_TRUST_PROXY/);
  });

  // A bundled install has no .env, so the default decides whether listings get coordinates.
  it('turns geocoding on unless the env turns it off', () => {
    delete process.env.FEATURE_GEOCODING_ENABLED;
    expect(loadConfig().features.geocodingEnabled).toBe(true);

    resetConfig();
    process.env.FEATURE_GEOCODING_ENABLED = 'false';
    expect(loadConfig().features.geocodingEnabled).toBe(false);
  });

  it('parses the runtime boot mode for bundled local launches', () => {
    process.env.IMMORADAR_RUNTIME_BOOT_MODE = 'setup';

    const config = loadConfig();

    expect(config.runtime.bootMode).toBe('setup');
  });

  it('refuses a relative ARTIFACTS_DIR and defaults to a folder under the runtime home', () => {
    process.env.ARTIFACTS_DIR = 'artifacts';
    expect(() => loadConfig()).toThrow(/ARTIFACTS_DIR/);

    resetConfig();
    delete process.env.ARTIFACTS_DIR;
    process.env.IMMORADAR_RUNTIME_HOME = '/tmp/engine-home';
    expect(loadConfig().artifacts.dir).toBe('/tmp/engine-home/artifacts');
  });
});

describe('loadRepoEnvFiles', () => {
  const SET_BY_TESTS = [
    'IMMORADAR_TEST_FROM_SHELL',
    'IMMORADAR_TEST_FROM_LOCAL',
    'IMMORADAR_TEST_FROM_BASE',
    'IMMORADAR_RUNTIME_HOME',
  ] as const;
  let root: string;

  function markCheckout(dir: string, packageName = 'immoradar'): void {
    writeFileSync(join(dir, 'turbo.json'), '{}');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: packageName }));
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'immoradar-env-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    for (const key of SET_BY_TESTS) {
      delete process.env[key];
    }
    vi.restoreAllMocks();
  });

  it('prefers the shell, then .env.local, then .env, from anywhere in the checkout', () => {
    markCheckout(root);
    writeFileSync(
      join(root, '.env.local'),
      'IMMORADAR_TEST_FROM_SHELL=local\nIMMORADAR_TEST_FROM_LOCAL=local\n',
    );
    writeFileSync(
      join(root, '.env'),
      'IMMORADAR_TEST_FROM_SHELL=base\nIMMORADAR_TEST_FROM_LOCAL=base\nIMMORADAR_TEST_FROM_BASE=base\n',
    );
    const packageDir = join(root, 'apps', 'api');
    mkdirSync(packageDir, { recursive: true });
    process.env.IMMORADAR_TEST_FROM_SHELL = 'shell';

    loadRepoEnvFiles(packageDir);

    expect(process.env.IMMORADAR_TEST_FROM_SHELL).toBe('shell');
    expect(process.env.IMMORADAR_TEST_FROM_LOCAL).toBe('local');
    expect(process.env.IMMORADAR_TEST_FROM_BASE).toBe('base');
  });

  it('reads nothing outside a checkout, or for a process the app started', () => {
    writeFileSync(join(root, '.env'), 'IMMORADAR_TEST_FROM_BASE=base\n');
    loadRepoEnvFiles(root);
    expect(process.env.IMMORADAR_TEST_FROM_BASE).toBeUndefined();

    markCheckout(root);
    process.env.IMMORADAR_RUNTIME_HOME = '/tmp/engine-home';
    loadRepoEnvFiles(root);
    expect(process.env.IMMORADAR_TEST_FROM_BASE).toBeUndefined();
  });

  it('reads nothing from the Turbo root of another project', () => {
    markCheckout(root, 'other-project');
    writeFileSync(join(root, '.env'), 'IMMORADAR_TEST_FROM_BASE=base\n');
    const packageDir = join(root, 'apps', 'api');
    mkdirSync(packageDir, { recursive: true });

    loadRepoEnvFiles(packageDir);

    expect(process.env.IMMORADAR_TEST_FROM_BASE).toBeUndefined();
  });

  it('names the file and the cause when a .env cannot be read', () => {
    markCheckout(root);
    mkdirSync(join(root, '.env'));

    expect(() => loadRepoEnvFiles(root)).toThrow(`Could not read ${join(root, '.env')}: EISDIR`);
  });

  it('warns with the key, never the value, when a value runs over several lines', () => {
    markCheckout(root);
    writeFileSync(
      join(root, '.env'),
      'IMMORADAR_TEST_FROM_BASE="opened-but-never-closed\nIMMORADAR_TEST_FROM_LOCAL="closed"\n',
    );
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);

    loadRepoEnvFiles(root);

    expect(emitWarning).toHaveBeenCalledTimes(1);
    const message = String(emitWarning.mock.calls[0]?.[0]);
    expect(message).toContain('IMMORADAR_TEST_FROM_BASE');
    expect(message).not.toContain('opened-but-never-closed');
  });
});
