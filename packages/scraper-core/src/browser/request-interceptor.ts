/**
 * Request filtering for scraper browser contexts.
 *
 * A scraper needs the document plus the first-party scripts, XHR and fetch calls that render
 * listings on several sites. Images, styles, fonts, media and beacons are dropped, and so is every
 * request to another site, except the main-frame navigation itself.
 */

/** Resource types a scraper never needs, from first parties included. */
const BLOCKED_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  'image',
  'stylesheet',
  'font',
  'media',
  'ping',
  'beacon',
]);

/**
 * Suffixes under which each name is its own site, so `justiz.gv.at` and `bmj.gv.at` differ. Only
 * the Austrian ones are listed: every scraped site is under `.at`, and a suffix like this only
 * matters when the page and the request share it.
 */
const MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set(['ac.at', 'co.at', 'gv.at', 'or.at']);

interface InterceptedFrame {
  url(): string;
  parentFrame(): InterceptedFrame | null;
}

interface InterceptedRequest {
  url(): string;
  resourceType(): string;
  isNavigationRequest(): boolean;
  /** Throws for requests a service worker makes. */
  frame(): InterceptedFrame;
  serviceWorker(): { url(): string } | null;
}

interface InterceptedRoute {
  request(): InterceptedRequest;
  abort(errorCode?: string): Promise<void>;
  continue(): Promise<void>;
}

/** The part of a Playwright or Patchright browser context that interception uses. */
export interface InterceptableContext {
  route(url: string, handler: (route: InterceptedRoute) => Promise<void>): Promise<unknown>;
}

function registrableDomain(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === '') return null;
  // IPv6 hosts keep their brackets in URL.hostname.
  if (host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
  const labels = host.split('.');
  const suffixLabels = MULTI_LABEL_SUFFIXES.has(labels.slice(-2).join('.')) ? 2 : 1;
  return labels.slice(-(suffixLabels + 1)).join('.');
}

function siteOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    return registrableDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

function frameOf(request: InterceptedRequest): InterceptedFrame | null {
  try {
    return request.frame();
  } catch {
    return null;
  }
}

/** URL of the page the request belongs to: the top frame, or the service worker's script. */
function pageUrlOf(request: InterceptedRequest): string | null {
  const worker = request.serviceWorker();
  if (worker) return worker.url();
  const frame = frameOf(request);
  if (!frame) return null;
  let top = frame;
  for (let parent = top.parentFrame(); parent !== null; parent = parent.parentFrame()) top = parent;
  return top.url();
}

function isMainFrameNavigation(request: InterceptedRequest): boolean {
  if (!request.isNavigationRequest()) return false;
  const frame = frameOf(request);
  return frame !== null && frame.parentFrame() === null;
}

function shouldBlock(request: InterceptedRequest): boolean {
  if (isMainFrameNavigation(request)) return false;
  if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) return true;
  const requestSite = siteOf(request.url());
  const pageSite = siteOf(pageUrlOf(request));
  // Without a page site (about:blank, or a request racing the first commit) there is nothing to
  // compare against, so the request goes through.
  return requestSite !== null && pageSite !== null && requestSite !== pageSite;
}

/**
 * Routes every request of the context through the filter above. Call it before the first
 * navigation. Blocked requests fail with `net::ERR_BLOCKED_BY_CLIENT`.
 */
export async function setupRequestInterception(context: InterceptableContext): Promise<void> {
  await context.route('**/*', async (route) => {
    if (shouldBlock(route.request())) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
}
