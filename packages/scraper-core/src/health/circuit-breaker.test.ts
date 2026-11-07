import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SourceCircuitBreaker } from './circuit-breaker.js';

const START = new Date('2026-11-07T10:00:00Z').getTime();

describe('SourceCircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not open on 404s and parse failures, only on failures that count', () => {
    const breaker = new SourceCircuitBreaker(5, 300_000);

    for (let i = 0; i < 10; i++) {
      breaker.recordFailure('willhaben', i % 2 === 0 ? 'terminal_page' : 'parse_failure');
    }
    expect(breaker.isOpen('willhaben')).toBe(false);
    expect(breaker.getConsecutiveFailures('willhaben')).toBe(0);

    for (let i = 0; i < 5; i++) breaker.recordFailure('willhaben', 'soft_anti_bot');
    expect(breaker.isOpen('willhaben')).toBe(true);
  });

  it('keeps a half-open circuit half-open when the probe hits a 404', () => {
    const breaker = new SourceCircuitBreaker(1, 300_000);
    breaker.recordFailure('willhaben', 'transient_network');
    vi.setSystemTime(START + 300_000);
    expect(breaker.isOpen('willhaben')).toBe(false);

    breaker.recordFailure('willhaben', 'terminal_page');

    expect(breaker.getCircuitState('willhaben')).toBe('half_open');
  });

  it('reports when an open circuit lets traffic through again, and null otherwise', () => {
    const breaker = new SourceCircuitBreaker(2, 300_000);
    expect(breaker.openUntil('willhaben')).toBeNull();

    breaker.recordFailure('willhaben', 'transient_network');
    breaker.recordFailure('willhaben', 'transient_network');
    expect(breaker.openUntil('willhaben')).toBe(START + 300_000);

    vi.setSystemTime(START + 299_999);
    expect(breaker.openUntil('willhaben')).toBe(START + 300_000);
    expect(breaker.isOpen('willhaben')).toBe(true);

    vi.setSystemTime(START + 300_000);
    expect(breaker.openUntil('willhaben')).toBeNull();
    expect(breaker.isOpen('willhaben')).toBe(false);
  });
});
