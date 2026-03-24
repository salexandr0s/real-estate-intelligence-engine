import { createLogger } from '@immoradar/observability';

const log = createLogger('request-interceptor');

/** Domains to block during scraping (analytics, ads, tracking) */
const BLOCKED_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'facebook.net',
  'facebook.com/tr',
  'connect.facebook.net',
  'hotjar.com',
  'clarity.ms',
  'sentry.io',
  'newrelic.com',
  'segment.io',
  'segment.com',
  'mixpanel.com',
  'amplitude.com',
] as const;

/** Resource types to block for faster page loads */
const BLOCKED_RESOURCE_TYPES = new Set(['media', 'font']);

/**
 * Set up request interception on a browser context to block
 * analytics/tracking scripts and unnecessary resource types.
 *
 * Must be called BEFORE navigating to any page.
 */
export async function setupRequestInterception(context: {
  route: (
    pattern: string,
    handler: (route: {
      request: () => { url: () => string; resourceType: () => string };
      abort: () => Promise<void>;
      continue: () => Promise<void>;
    }) => Promise<void>,
  ) => Promise<void>;
}): Promise<void> {
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    const resourceType = request.resourceType();

    // Block known analytics/tracking domains
    const isBlocked = BLOCKED_DOMAINS.some((domain) => url.includes(domain));
    if (isBlocked) {
      log.debug('Blocked tracking request', { url: url.slice(0, 100) });
      await route.abort();
      return;
    }

    // Block heavy resource types
    if (BLOCKED_RESOURCE_TYPES.has(resourceType)) {
      await route.abort();
      return;
    }

    await route.continue();
  });
}
