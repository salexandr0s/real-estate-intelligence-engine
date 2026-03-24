import { createLogger } from '@immoradar/observability';

const log = createLogger('alert:email');

export interface EmailConfig {
  enabled: boolean;
  smtpHost?: string;
  smtpPort?: number;
  fromAddress?: string;
}

/**
 * Send an alert notification via email.
 * Currently logs the email that would be sent.
 * Replace with actual SMTP/API call when email is configured.
 */
export async function sendAlertEmail(params: {
  to: string;
  subject: string;
  body: string;
  config: EmailConfig;
}): Promise<boolean> {
  if (!params.config.enabled) {
    log.debug('Email delivery disabled, skipping');
    return false;
  }

  // TODO: Replace with actual email sending (nodemailer, SendGrid, etc.)
  log.info('Email sending not yet implemented — logged only', {
    to: params.to,
    subject: params.subject,
    bodyLength: params.body.length,
  });

  return true;
}
