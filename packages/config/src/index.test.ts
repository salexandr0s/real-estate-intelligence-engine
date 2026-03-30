import { afterEach, describe, expect, it } from 'vitest';

import { loadCanaryConfig, loadConfig, resetConfig } from './index.js';

const ENV_KEYS = ['NODE_ENV', 'API_BEARER_TOKEN', 'PLAYWRIGHT_HEADLESS'] as const;

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

    expect(() => loadConfig()).toThrow(/API_BEARER_TOKEN/);
  });
});
