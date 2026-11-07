import { describe, expect, it } from 'vitest';
import {
  discoveryCron,
  maxPagesForSource,
  shouldRegisterAutomatedSchedules,
  stableMinuteOffset,
} from './schedule.js';

describe('discoveryCron', () => {
  it('holds a 15-minute source to the 180-minute floor', () => {
    expect(discoveryCron('wohnnet', 15, 180)).toMatch(/^\d+ \*\/3 \* \* \*$/);
  });

  it('keeps an interval above the floor', () => {
    expect(discoveryCron('edikte', 360, 180)).toMatch(/^\d+ \*\/6 \* \* \*$/);
  });

  it('runs hourly at most when the floor is lowered', () => {
    expect(discoveryCron('wohnnet', 15, 0)).toMatch(/^\d+ \*\/1 \* \* \*$/);
  });

  it('switches to a daily run where an hour step would not parse', () => {
    expect(discoveryCron('edikte', 1440, 180)).toMatch(/^\d+ 0 \* \* \*$/);
  });

  it('gives a source the same minute on every sync', () => {
    const first = discoveryCron('wohnnet', 15, 180);
    expect(discoveryCron('wohnnet', 15, 180)).toBe(first);
    expect(first.split(' ')[0]).toBe(String(stableMinuteOffset('discovery-wohnnet')));
  });
});

describe('maxPagesForSource', () => {
  it('holds a source config to the cap', () => {
    expect(maxPagesForSource({ crawlProfile: { maxPagesPerRun: 100 } }, 60)).toBe(60);
  });

  it('keeps a lower number and reads the older key', () => {
    expect(maxPagesForSource({ crawlProfile: { maxPagesPerRun: 5 } }, 60)).toBe(5);
    expect(maxPagesForSource({ crawlProfile: { maxPages: 8 } }, 60)).toBe(8);
  });

  it('uses the cap when the config says nothing usable', () => {
    expect(maxPagesForSource(null, 60)).toBe(60);
    expect(maxPagesForSource({}, 60)).toBe(60);
    expect(maxPagesForSource({ crawlProfile: { maxPagesPerRun: 'many' } }, 60)).toBe(60);
  });
});

describe('shouldRegisterAutomatedSchedules', () => {
  it('registers only in active mode with the scheduler on', () => {
    const on = { scheduler: { enabled: true } };
    const off = { scheduler: { enabled: false } };

    expect(shouldRegisterAutomatedSchedules({ runtime: { bootMode: 'active' }, ...on })).toBe(true);
    expect(shouldRegisterAutomatedSchedules({ runtime: { bootMode: 'active' }, ...off })).toBe(
      false,
    );
    expect(shouldRegisterAutomatedSchedules({ runtime: { bootMode: 'setup' }, ...on })).toBe(false);
  });
});
