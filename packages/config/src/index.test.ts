import { afterEach, describe, expect, it } from 'vitest';

import { loadCanaryConfig, loadConfig, resetConfig } from './index.js';

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
    expect(config.documents.maxBytes).toBe(25000000);
  });

  it('parses the runtime boot mode for bundled local launches', () => {
    process.env.IMMORADAR_RUNTIME_BOOT_MODE = 'setup';

    const config = loadConfig();

    expect(config.runtime.bootMode).toBe('setup');
  });
});
