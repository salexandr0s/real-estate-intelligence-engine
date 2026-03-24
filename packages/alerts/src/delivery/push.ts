import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';
import http2 from 'node:http2';

import { createLogger } from '@immoradar/observability';

const log = createLogger('alert:push');

// ── Types ───────────────────────────────────────────────────────────────────

export interface PushConfig {
  enabled: boolean;
  teamId: string;
  keyId: string;
  keyPath: string;
  bundleId: string;
  /** true = api.push.apple.com, false = api.sandbox.push.apple.com */
  production: boolean;
}

export interface PushResult {
  sent: number;
  failed: number;
  invalidTokens: string[];
}

// ── Module-level caches ─────────────────────────────────────────────────────

/** Cached .p8 private key contents. */
let cachedKey: string | undefined;

/** Cached JWT and its creation timestamp. */
let cachedJwt: { token: string; createdAt: number } | undefined;

/** Reusable HTTP/2 session (APNs recommends persistent connections). */
let h2Session: http2.ClientHttp2Session | undefined;

const JWT_LIFETIME_MS = 50 * 60 * 1000; // 50 minutes (APNs allows 60)

// ── Helpers ─────────────────────────────────────────────────────────────────

function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

async function loadKey(keyPath: string): Promise<string> {
  if (cachedKey) return cachedKey;
  cachedKey = await readFile(keyPath, 'utf8');
  return cachedKey;
}

function buildJwt(teamId: string, keyId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);

  // Check if cached JWT is still valid
  if (cachedJwt && Date.now() - cachedJwt.createdAt < JWT_LIFETIME_MS) {
    return cachedJwt.token;
  }

  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const payload = base64url(JSON.stringify({ iss: teamId, iat: now }));
  const signingInput = `${header}.${payload}`;

  const sign = createSign('SHA256');
  sign.update(signingInput);
  const signature = sign.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }, 'base64url');

  const token = `${signingInput}.${signature}`;
  cachedJwt = { token, createdAt: Date.now() };
  return token;
}

function getApnsHost(production: boolean): string {
  return production ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
}

function getSession(host: string): http2.ClientHttp2Session {
  if (h2Session && !h2Session.closed && !h2Session.destroyed) {
    return h2Session;
  }

  h2Session = http2.connect(host);

  h2Session.on('error', (err) => {
    log.error('HTTP/2 session error', {
      error: err instanceof Error ? err.message : String(err),
    });
    h2Session = undefined;
  });

  h2Session.on('close', () => {
    h2Session = undefined;
  });

  return h2Session;
}

interface ApnsResponse {
  status: number;
  body: string;
}

function sendSinglePush(
  session: http2.ClientHttp2Session,
  deviceToken: string,
  jwt: string,
  bundleId: string,
  bodyJson: string,
): Promise<ApnsResponse> {
  return new Promise((resolve, reject) => {
    const req = session.request({
      [http2.constants.HTTP2_HEADER_METHOD]: 'POST',
      [http2.constants.HTTP2_HEADER_PATH]: `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
    });

    let status = 0;
    const chunks: Buffer[] = [];

    req.on('response', (headers) => {
      const raw = headers[http2.constants.HTTP2_HEADER_STATUS];
      status = typeof raw === 'number' ? raw : Number(raw);
    });

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve({ status, body: Buffer.concat(chunks).toString('utf8') });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end(bodyJson);
  });
}

function parseApnsReason(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'reason' in parsed) {
      return String((parsed as Record<string, unknown>)['reason']);
    }
  } catch {
    // Ignore parse errors
  }
  return undefined;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Send an APNs push notification to one or more device tokens.
 *
 * Uses HTTP/2 with a persistent session and caches the ES256 JWT
 * for 50 minutes (APNs allows 60).
 */
export async function sendAlertPush(params: {
  deviceTokens: string[];
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  config: PushConfig;
}): Promise<PushResult> {
  const result: PushResult = { sent: 0, failed: 0, invalidTokens: [] };

  if (!params.config.enabled) {
    log.debug('Push delivery disabled, skipping');
    return result;
  }

  if (params.deviceTokens.length === 0) {
    return result;
  }

  const privateKey = await loadKey(params.config.keyPath);
  const jwt = buildJwt(params.config.teamId, params.config.keyId, privateKey);
  const host = getApnsHost(params.config.production);
  const session = getSession(host);

  const bodyJson = JSON.stringify({
    aps: {
      alert: { title: params.title, body: params.body },
      sound: 'default',
      'thread-id': params.config.bundleId,
    },
    ...params.payload,
  });

  // Send to all tokens concurrently — HTTP/2 multiplexes on a single connection
  await Promise.allSettled(
    params.deviceTokens.map(async (token) => {
      try {
        const response = await sendSinglePush(
          session,
          token,
          jwt,
          params.config.bundleId,
          bodyJson,
        );

        if (response.status === 200) {
          result.sent++;
        } else if (response.status === 410) {
          result.invalidTokens.push(token);
          log.info('Device token unregistered', { token });
        } else if (response.status === 400) {
          const reason = parseApnsReason(response.body);
          if (reason === 'BadDeviceToken') {
            result.invalidTokens.push(token);
            log.info('Bad device token', { token });
          } else {
            result.failed++;
            log.warn('APNs bad request', {
              token,
              reason,
              bodyPreview: response.body.slice(0, 200),
            });
          }
        } else if (response.status === 429) {
          result.failed++;
          const retryAfter = parseApnsReason(response.body);
          log.warn('APNs rate limited', { token, retryAfter });
        } else {
          result.failed++;
          log.warn('APNs delivery failed', {
            token,
            status: response.status,
            bodyPreview: response.body.slice(0, 200),
          });
        }
      } catch (err) {
        result.failed++;
        log.error('APNs request error', {
          token,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  log.info('Push delivery complete', {
    sent: result.sent,
    failed: result.failed,
    invalidTokens: result.invalidTokens.length,
    total: params.deviceTokens.length,
  });

  return result;
}

/**
 * Gracefully close the persistent HTTP/2 session to APNs.
 * Call during worker shutdown to avoid unclean TCP teardown.
 */
export function closePushSession(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!h2Session || h2Session.closed || h2Session.destroyed) {
      resolve();
      return;
    }
    h2Session.close(resolve);
    h2Session = undefined;
  });
}
