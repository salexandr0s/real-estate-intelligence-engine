/**
 * BullMQ worker: delivers alerts via push (APNs), email, and webhook channels.
 * Picks up jobs from the ALERT_DELIVERY queue, routes to the appropriate sender,
 * and updates alert status in the database.
 */

import { Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { createLogger } from '@rei/observability';
import { alertDeliveryTotal, alertDeliveryDuration } from '@rei/observability';
import { QUEUE_NAMES, getRedisConnection, getQueuePrefix } from '@rei/scraper-core';
import type { AlertDeliveryJobData } from '@rei/scraper-core';
import { alerts, deadLetter, deviceTokens, appUsers } from '@rei/db';
import { sendAlertEmail, sendAlertPush, sendAlertWebhook } from '@rei/alerts';
import type { PushConfig } from '@rei/alerts';
import { loadConfig } from '@rei/config';

const log = createLogger('worker:delivery');

export function createDeliveryWorker(): Worker<AlertDeliveryJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();
  const config = loadConfig();

  const pushConfig: PushConfig = {
    enabled: config.alerts.pushEnabled,
    teamId: config.alerts.apns.teamId,
    keyId: config.alerts.apns.keyId,
    keyPath: config.alerts.apns.keyPath,
    bundleId: config.alerts.apns.bundleId,
    production: config.alerts.apns.production,
  };

  const worker = new Worker<AlertDeliveryJobData>(
    QUEUE_NAMES.ALERT_DELIVERY,
    async (job: Job<AlertDeliveryJobData>) => {
      const { alertId, channel, userId } = job.data;
      const startTime = Date.now();

      const alert = await alerts.findById(alertId);
      if (!alert) {
        log.warn('Alert not found, skipping delivery', { alertId });
        alertDeliveryTotal.inc({ channel, outcome: 'skipped' });
        return;
      }

      if (alert.status !== 'queued') {
        log.debug('Alert already processed, skipping', { alertId, status: alert.status });
        alertDeliveryTotal.inc({ channel, outcome: 'skipped' });
        return;
      }

      let delivered = false;

      switch (channel) {
        case 'push': {
          if (!pushConfig.enabled) {
            log.debug('Push delivery disabled, skipping', { alertId });
            alertDeliveryTotal.inc({ channel, outcome: 'skipped' });
            return;
          }

          const tokens = await deviceTokens.findByUser(userId);
          if (tokens.length === 0) {
            log.debug('No device tokens for user, skipping push', { userId, alertId });
            alertDeliveryTotal.inc({ channel, outcome: 'skipped' });
            await alerts.updateStatus(alertId, 'suppressed');
            return;
          }

          const result = await sendAlertPush({
            deviceTokens: tokens.map((t) => t.token),
            title: alert.title,
            body: alert.body,
            payload: alert.payload,
            config: pushConfig,
          });

          // Clean up invalid tokens
          for (const invalidToken of result.invalidTokens) {
            await deviceTokens.removeByToken(invalidToken);
            log.info('Removed invalid APNs token', { token: invalidToken.slice(0, 8) + '...' });
          }

          delivered = result.sent > 0;
          break;
        }

        case 'email': {
          if (!config.alerts.emailEnabled) {
            log.debug('Email delivery disabled, skipping', { alertId });
            alertDeliveryTotal.inc({ channel, outcome: 'skipped' });
            return;
          }

          const email = await appUsers.findEmail(userId);
          if (!email) {
            log.warn('No email for user, skipping', { userId, alertId });
            alertDeliveryTotal.inc({ channel, outcome: 'skipped' });
            await alerts.updateStatus(alertId, 'suppressed');
            return;
          }

          delivered = await sendAlertEmail({
            to: email,
            subject: alert.title,
            body: alert.body,
            config: {
              enabled: config.alerts.emailEnabled,
              smtpHost: config.alerts.email.smtpHost,
              smtpPort: config.alerts.email.smtpPort,
              fromAddress: config.alerts.email.fromAddress,
            },
          });
          break;
        }

        case 'webhook': {
          if (!config.alerts.webhookEnabled) {
            log.debug('Webhook delivery disabled, skipping', { alertId });
            alertDeliveryTotal.inc({ channel, outcome: 'skipped' });
            return;
          }

          const user = await appUsers.findById(userId);
          const webhookUrl = (user?.notificationSettings as Record<string, unknown> | null)
            ?.webhookUrl;
          if (typeof webhookUrl !== 'string' || !webhookUrl) {
            log.warn('No webhook URL configured for user, skipping', { userId, alertId });
            alertDeliveryTotal.inc({ channel, outcome: 'skipped' });
            await alerts.updateStatus(alertId, 'suppressed');
            return;
          }

          delivered = await sendAlertWebhook({
            url: webhookUrl,
            payload: {
              alertId: alert.id,
              alertType: alert.alertType,
              title: alert.title,
              body: alert.body,
              listingId: alert.listingId,
              matchedAt: alert.matchedAt,
              ...alert.payload,
            },
            config: {
              enabled: config.alerts.webhookEnabled,
              timeoutMs: 10_000,
            },
          });
          break;
        }

        default:
          log.warn('Unknown delivery channel, skipping', { channel, alertId });
          alertDeliveryTotal.inc({ channel, outcome: 'skipped' });
          return;
      }

      const durationSec = (Date.now() - startTime) / 1000;
      alertDeliveryDuration.observe({ channel }, durationSec);

      if (delivered) {
        await alerts.updateStatus(alertId, 'sent', new Date());
        alertDeliveryTotal.inc({ channel, outcome: 'sent' });
        log.info('Alert delivered', {
          alertId,
          channel,
          durationMs: Math.round(durationSec * 1000),
        });
      } else {
        await alerts.updateStatus(alertId, 'failed', undefined, 'Delivery returned false');
        alertDeliveryTotal.inc({ channel, outcome: 'failed' });
        log.warn('Alert delivery failed', { alertId, channel });
      }
    },
    {
      connection,
      prefix,
      concurrency: 5,
    },
  );

  worker.on('failed', (job, err) => {
    const isTerminal = job != null && job.attemptsMade >= (job.opts?.attempts ?? 1);
    log.error('Delivery job failed', {
      jobId: job?.id,
      alertId: job?.data.alertId,
      channel: job?.data.channel,
      attempt: job?.attemptsMade,
      terminal: isTerminal,
      error: err.message,
    });

    if (isTerminal && job) {
      // Update alert status to failed
      alerts
        .updateStatus(job.data.alertId, 'failed', undefined, err.message)
        .catch((statusErr) => log.error('Status update failed', { error: String(statusErr) }));

      // Persist to DLQ
      deadLetter
        .insert({
          queueName: QUEUE_NAMES.ALERT_DELIVERY,
          jobId: job.id ?? 'unknown',
          jobData: job.data as unknown as Record<string, unknown>,
          errorMessage: err.message,
          errorClass: 'delivery_failure',
          sourceCode: 'alert-delivery',
          attempts: job.attemptsMade,
        })
        .catch((dlqErr) => log.error('DLQ insert failed', { error: String(dlqErr) }));

      alertDeliveryTotal.inc({ channel: job.data.channel, outcome: 'failed' });
    }
  });

  return worker;
}
