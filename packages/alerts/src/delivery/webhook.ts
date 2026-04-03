import { createLogger } from '@immoradar/observability';
import { isUrlAllowedAsync } from './outbound-url-policy.js';

const log = createLogger('alert:webhook');

export interface WebhookConfig {
  enabled: boolean;
  defaultUrl?: string;
  timeoutMs?: number;
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

  if (!(await isUrlAllowedAsync(params.url))) {
    log.warn('Webhook URL rejected by SSRF policy', { url: params.url });
    return false;
  }

  try {
    const response = await fetch(params.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params.payload),
      signal: AbortSignal.timeout(params.config.timeoutMs ?? 10000),
      redirect: 'manual',
    });

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

export { isUrlAllowed, isUrlAllowedAsync } from './outbound-url-policy.js';
