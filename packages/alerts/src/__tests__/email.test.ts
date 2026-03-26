import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));

vi.mock('nodemailer', () => ({
  default: { createTransport },
}));

describe('sendAlertEmail', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../delivery/email.js');
    mod.resetEmailTransportForTests();
  });

  it('returns false when disabled', async () => {
    const { sendAlertEmail } = await import('../delivery/email.js');
    await expect(
      sendAlertEmail({
        to: 'user@example.com',
        subject: 'Test',
        body: 'Hello',
        config: { enabled: false },
      }),
    ).resolves.toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('sends via nodemailer when enabled', async () => {
    sendMail.mockResolvedValueOnce({
      messageId: 'abc123',
      accepted: ['user@example.com'],
      rejected: [],
    });

    const { sendAlertEmail } = await import('../delivery/email.js');
    await expect(
      sendAlertEmail({
        to: 'user@example.com',
        subject: 'Test subject',
        body: 'Hello world',
        config: {
          enabled: true,
          smtpHost: 'smtp.example.com',
          smtpPort: 587,
          fromAddress: 'alerts@example.com',
          smtpUser: 'mailer',
          smtpPassword: 'secret',
        },
      }),
    ).resolves.toBe(true);

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: {
        user: 'mailer',
        pass: 'secret',
      },
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'alerts@example.com',
      to: 'user@example.com',
      subject: 'Test subject',
      text: 'Hello world',
    });
  });

  it('returns false when sendMail rejects', async () => {
    sendMail.mockRejectedValueOnce(new Error('smtp down'));

    const { sendAlertEmail } = await import('../delivery/email.js');
    await expect(
      sendAlertEmail({
        to: 'user@example.com',
        subject: 'Test subject',
        body: 'Hello world',
        config: {
          enabled: true,
          smtpHost: 'smtp.example.com',
          smtpPort: 465,
          smtpSecure: true,
          fromAddress: 'alerts@example.com',
        },
      }),
    ).resolves.toBe(false);
  });
});
