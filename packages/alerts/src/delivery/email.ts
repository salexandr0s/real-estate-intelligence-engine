import nodemailer from 'nodemailer';
import { createLogger } from '@immoradar/observability';

const log = createLogger('alert:email');

export interface EmailConfig {
  enabled: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPassword?: string;
  fromAddress?: string;
}

let cachedTransportKey: string | null = null;
let cachedTransporter: nodemailer.Transporter | null = null;

function getTransportKey(config: EmailConfig): string {
  return JSON.stringify({
    host: config.smtpHost ?? '',
    port: config.smtpPort ?? 587,
    secure: config.smtpSecure ?? false,
    user: config.smtpUser ?? '',
    from: config.fromAddress ?? '',
  });
}

function getTransporter(config: EmailConfig): nodemailer.Transporter {
  const key = getTransportKey(config);
  if (cachedTransporter && cachedTransportKey === key) {
    return cachedTransporter;
  }

  const options: {
    host: string;
    port: number;
    secure: boolean;
    auth?: {
      user: string;
      pass: string;
    };
  } = {
    host: config.smtpHost ?? 'localhost',
    port: config.smtpPort ?? 587,
    secure: config.smtpSecure ?? false,
  };

  if (config.smtpUser && config.smtpPassword) {
    options.auth = {
      user: config.smtpUser,
      pass: config.smtpPassword,
    };
  }

  cachedTransportKey = key;
  cachedTransporter = nodemailer.createTransport(options);
  return cachedTransporter;
}

export function resetEmailTransportForTests(): void {
  cachedTransportKey = null;
  cachedTransporter = null;
}

/**
 * Send an alert notification via SMTP.
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

  if (!params.config.fromAddress) {
    log.warn('Email delivery missing from address, skipping', {
      to: params.to,
    });
    return false;
  }

  try {
    const transporter = getTransporter(params.config);
    const result = await transporter.sendMail({
      from: params.config.fromAddress,
      to: params.to,
      subject: params.subject,
      text: params.body,
    });

    log.info('Email sent', {
      to: params.to,
      subject: params.subject,
      messageId: result.messageId ?? null,
      accepted: result.accepted.length,
      rejected: result.rejected.length,
    });
    return result.accepted.length > 0 && result.rejected.length === 0;
  } catch (error) {
    log.error('Email delivery failed', {
      to: params.to,
      subject: params.subject,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
