import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  type Listener = () => void;
  class Emitter {
    private readonly listeners = new Map<string, Listener[]>();
    on(event: string, listener: Listener): this {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }
    emit(event: string): void {
      for (const listener of this.listeners.get(event) ?? []) listener();
    }
  }
  class FakeContext extends Emitter {
    setDefaultNavigationTimeout(): void {}
    async close(): Promise<void> {
      this.emit('close');
    }
  }
  class FakeBrowser extends Emitter {
    connected = true;
    isConnected(): boolean {
      return this.connected;
    }
    async newContext(): Promise<FakeContext> {
      return new FakeContext();
    }
    async close(): Promise<void> {
      this.crash();
    }
    crash(): void {
      this.connected = false;
      this.emit('disconnected');
    }
  }
  const browsers: FakeBrowser[] = [];
  const launch = vi.fn(async () => {
    const browser = new FakeBrowser();
    browsers.push(browser);
    return browser;
  });
  return { browsers, launch };
});

vi.mock('playwright', () => ({ chromium: { launch: fake.launch } }));
vi.mock('@immoradar/scraper-core', () => ({
  DEFAULT_BROWSER_CONTEXT_CONFIG: { locale: 'de-AT', timezoneId: 'Europe/Vienna' },
  pickRandomViewport: () => ({ width: 1280, height: 800 }),
  pickRandomUserAgent: () => 'test-agent',
}));

async function flushMicrotasks(): Promise<void> {
  for (let tick = 0; tick < 5; tick++) await Promise.resolve();
}

async function freshPool(): Promise<typeof import('./browser-pool.js')> {
  vi.resetModules();
  return import('./browser-pool.js');
}

describe('browser pool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fake.launch.mockClear();
    fake.browsers.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env['PLAYWRIGHT_BROWSER_RECYCLE_AFTER_CONTEXTS'];
  });

  it('closes an idle browser without counting the close toward the crash limit', async () => {
    const pool = await freshPool();
    // Counted as restarts, six idle closes within an hour would block the next launch.
    for (let cycle = 0; cycle < 7; cycle++) {
      const context = await pool.createScrapeContext();
      await context.close();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fake.browsers.at(-1)?.isConnected()).toBe(false);
    }
    expect(fake.launch).toHaveBeenCalledTimes(7);
  });

  it('stops relaunching a browser that keeps crashing', async () => {
    const pool = await freshPool();
    await pool.getBrowser();
    for (let crash = 0; crash < 5; crash++) {
      fake.browsers.at(-1)!.crash();
      await pool.getBrowser();
    }
    fake.browsers.at(-1)!.crash();
    await expect(pool.getBrowser()).rejects.toThrow(/restart limit/);
  });

  it('replaces the browser once it has served the recycle count', async () => {
    process.env['PLAYWRIGHT_BROWSER_RECYCLE_AFTER_CONTEXTS'] = '2';
    const pool = await freshPool();
    await (await pool.createScrapeContext()).close();
    expect(fake.browsers[0]!.isConnected()).toBe(true);
    await (await pool.createScrapeContext()).close();
    expect(fake.browsers[0]!.isConnected()).toBe(false);
    await pool.createScrapeContext();
    expect(fake.launch).toHaveBeenCalledTimes(2);
  });

  it('hands the page slot on in order and skips a waiter that gave up', async () => {
    const pool = await freshPool();
    const releaseFirst = await pool.acquirePageSlot();
    const gaveUp = new AbortController();
    const second = pool.acquirePageSlot(gaveUp.signal);
    let thirdHasSlot = false;
    const third = pool.acquirePageSlot().then((release) => {
      thirdHasSlot = true;
      return release;
    });

    gaveUp.abort();
    await expect(second).rejects.toBeDefined();
    await flushMicrotasks();
    expect(thirdHasSlot).toBe(false);

    releaseFirst();
    releaseFirst();
    const releaseThird = await third;
    expect(thirdHasSlot).toBe(true);

    let fourthHasSlot = false;
    const fourth = pool.acquirePageSlot().then((release) => {
      fourthHasSlot = true;
      return release;
    });
    await flushMicrotasks();
    expect(fourthHasSlot).toBe(false);
    releaseThird();
    (await fourth)();
  });
});
