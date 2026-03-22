import { createLogger } from '@rei/observability';

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

  try {
    const response = await fetch(params.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params.payload),
      signal: AbortSignal.timeout(params.config.timeoutMs ?? 10000),
    });

    if (!response.ok) {
      log.warn('Webhook delivery failed', { url: params.url, status: response.status } as Record<
        string,
        unknown
      >);
      return false;
    }

    log.info('Webhook alert sent', { url: params.url, status: response.status } as Record<
      string,
      unknown
    >);
    return true;
  } catch (err) {
    log.error('Webhook delivery error', {
      url: params.url,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
    return false;
  }
}
