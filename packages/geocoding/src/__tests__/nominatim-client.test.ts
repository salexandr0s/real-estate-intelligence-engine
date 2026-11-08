import { afterEach, describe, expect, it, vi } from 'vitest';

const ANSWER = [
  { lat: '48.2', lon: '16.37', type: 'house', importance: 0.5, display_name: 'Wien' },
];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('geocodeAddress', () => {
  // Nominatim bans an IP that sends more than one request a second.
  it('sends concurrent callers one at a time, at least 1.1 s apart', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const startedAt: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const call = startedAt.push(Date.now());
        // The first answer is slow and the second request fails outright.
        if (call === 1) await new Promise((resolve) => setTimeout(resolve, 3000));
        if (call === 2) throw new Error('network down');
        return { ok: true, json: async () => ANSWER };
      }),
    );
    // A fresh module, so no request from another test shifts the timing.
    const { geocodeAddress } = await import('../nominatim-client.js');

    const t0 = Date.now();
    const answers = Promise.all([
      geocodeAddress({ city: 'Wien' }),
      geocodeAddress({ city: 'Wien' }),
      geocodeAddress({ city: 'Wien' }),
    ]);
    await vi.runAllTimersAsync();

    // The second waits for the slow first answer, and the third keeps its distance
    // from the failed second.
    expect(startedAt.map((at) => at - t0)).toEqual([0, 3000, 4100]);
    expect(await answers).toEqual([
      expect.objectContaining({ lat: 48.2, lon: 16.37 }),
      null,
      expect.objectContaining({ lat: 48.2, lon: 16.37 }),
    ]);
  });
});
