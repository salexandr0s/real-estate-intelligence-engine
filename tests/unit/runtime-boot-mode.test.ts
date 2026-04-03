import { describe, expect, it } from 'vitest';

import {
  shouldClearAutomatedSchedules,
  shouldRegisterAutomatedSchedules,
} from '../../apps/worker-scraper/src/runtime-boot-mode.js';

describe('runtime boot mode scheduling', () => {
  it('disables automated schedules in setup mode', () => {
    const config = {
      runtime: { bootMode: 'setup' as const },
      scheduler: { enabled: true },
    };

    expect(shouldClearAutomatedSchedules(config)).toBe(true);
    expect(shouldRegisterAutomatedSchedules(config)).toBe(false);
  });

  it('registers automated schedules only when active mode is enabled', () => {
    const activeConfig = {
      runtime: { bootMode: 'active' as const },
      scheduler: { enabled: true },
    };
    const disabledConfig = {
      runtime: { bootMode: 'active' as const },
      scheduler: { enabled: false },
    };

    expect(shouldRegisterAutomatedSchedules(activeConfig)).toBe(true);
    expect(shouldClearAutomatedSchedules(activeConfig)).toBe(false);
    expect(shouldRegisterAutomatedSchedules(disabledConfig)).toBe(false);
  });
});
