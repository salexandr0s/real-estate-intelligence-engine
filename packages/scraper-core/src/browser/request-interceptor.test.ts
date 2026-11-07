import { beforeAll, describe, expect, it } from 'vitest';
import { setupRequestInterception, type InterceptableContext } from './request-interceptor.js';

type Handler = Parameters<InterceptableContext['route']>[1];
type FakeRequest = ReturnType<Parameters<Handler>[0]['request']>;

interface FakeFrame {
  url(): string;
  parentFrame(): FakeFrame | null;
}

function frame(url: string, parent: FakeFrame | null = null): FakeFrame {
  return { url: () => url, parentFrame: () => parent };
}

function request(
  url: string,
  resourceType: string,
  owner: FakeFrame,
  options: { navigation?: boolean } = {},
): FakeRequest {
  return {
    url: () => url,
    resourceType: () => resourceType,
    isNavigationRequest: () => options.navigation ?? false,
    frame: () => owner,
    serviceWorker: () => null,
  };
}

let handler: Handler;

beforeAll(async () => {
  await setupRequestInterception({
    route: async (_url, installed) => {
      handler = installed;
    },
  });
});

async function decide(req: FakeRequest): Promise<string[]> {
  const calls: string[] = [];
  await handler({
    request: () => req,
    abort: async () => {
      calls.push('abort');
    },
    continue: async () => {
      calls.push('continue');
    },
  });
  return calls;
}

const willhaben = frame('https://www.willhaben.at/iad/immobilien/d/123');

describe('setupRequestInterception', () => {
  it('lets the main-frame document through, even when it moves to another site', async () => {
    const previousPage = frame('https://www.immobilienscout24.at/expose/1');

    expect(
      await decide(
        request('https://www.willhaben.at/iad/immobilien/d/123', 'document', previousPage, {
          navigation: true,
        }),
      ),
    ).toEqual(['continue']);
  });

  it.each([
    ['script', 'https://www.willhaben.at/_next/static/chunks/main.js'],
    ['xhr', 'https://api.willhaben.at/restapi/v2/atverz'],
    ['fetch', 'https://www.willhaben.at/webapi/iad/search'],
  ])('lets a first-party %s through', async (resourceType, url) => {
    expect(await decide(request(url, resourceType, willhaben))).toEqual(['continue']);
  });

  it.each(['image', 'stylesheet', 'font', 'media', 'ping', 'beacon'])(
    'blocks a first-party %s',
    async (resourceType) => {
      expect(
        await decide(request('https://www.willhaben.at/static/asset', resourceType, willhaben)),
      ).toEqual(['abort']);
    },
  );

  it('blocks third-party scripts and third-party frames', async () => {
    expect(
      await decide(request('https://www.googletagmanager.com/gtm.js', 'script', willhaben)),
    ).toEqual(['abort']);
    expect(
      await decide(
        request('https://ads.example.com/frame', 'document', frame('about:blank', willhaben), {
          navigation: true,
        }),
      ),
    ).toEqual(['abort']);
  });

  it('treats each name under gv.at and co.at as its own site', async () => {
    const edikte = frame('https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/suche');

    expect(await decide(request('https://www.justiz.gv.at/app.js', 'script', edikte))).toEqual([
      'continue',
    ]);
    expect(await decide(request('https://www.bmj.gv.at/app.js', 'script', edikte))).toEqual([
      'abort',
    ]);
    expect(
      await decide(
        request('https://tracker.co.at/t.js', 'script', frame('https://www.makler.co.at/')),
      ),
    ).toEqual(['abort']);
  });

  it('judges a service-worker request by the worker, whose frame() throws', async () => {
    const fromWorker = (url: string): FakeRequest => ({
      ...request(url, 'fetch', willhaben),
      frame: () => {
        throw new Error('Service Worker requests do not have an associated frame.');
      },
      serviceWorker: () => ({ url: () => 'https://www.willhaben.at/sw.js' }),
    });

    expect(await decide(fromWorker('https://www.willhaben.at/webapi/x'))).toEqual(['continue']);
    expect(await decide(fromWorker('https://collector.example.net/x'))).toEqual(['abort']);
  });
});
