import { createLogger } from '@rei/observability';

const log = createLogger('alert:webhook');

export interface WebhookConfig {
  enabled: boolean;
  defaultUrl?: string;
  timeoutMs?: number;
}

/** Blocked IP ranges for SSRF prevention (private/internal networks). */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '169.254.169.254', // AWS/cloud metadata
  '[::1]',
]);

function isUrlAllowed(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  // Only allow http/https
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return false;
  }

  // Block known internal hostnames
  if (BLOCKED_HOSTNAMES.has(parsed.hostname)) {
    return false;
  }

  // Block private IP ranges (10.x, 172.16-31.x, 192.168.x)
  const parts = parsed.hostname.split('.').map(Number);
  if (parts.length === 4 && parts.every((p) => !Number.isNaN(p))) {
    if (parts[0] === 10) return false;
    if (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) return false;
    if (parts[0] === 192 && parts[1] === 168) return false;
    if (parts[0] === 169 && parts[1] === 254) return false;
  }

  return true;
}

/**
 * Send an alert notification via webhook.
 */
export async function sendAlertWebhook(params: {
  url: string;
  payload: Record<string, unknown>;
  config: WebhookConfig;
}): Promise<boolean> {
  if (!params.config.enabled) {
    log.debug('Webhook delivery disabled, skipping');
    return false;
  }

  if (!isUrlAllowed(params.url)) {
    log.warn('Webhook URL rejected by SSRF policy', { url: params.url });
    return false;
  }

  try {
    const response = await fetch(params.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params.payload),
      signal: AbortSignal.timeout(params.config.timeoutMs ?? 10000),
    });

    // Drain response body to avoid socket hang-ups
    const responseText = await response.text();

    if (!response.ok) {
      log.warn('Webhook delivery failed', {
        url: params.url,
        status: response.status,
        bodyPreview: responseText.slice(0, 200),
      });
      return false;
    }

    log.info('Webhook alert sent', { url: params.url, status: response.status });
    return true;
  } catch (err) {
    log.error('Webhook delivery error', {
      url: params.url,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
