/**
 * PG LISTEN/NOTIFY subscription for real-time event delivery.
 *
 * Uses a dedicated pg.Client (not the pool) because LISTEN requires
 * a persistent connection that holds the subscription state.
 *
 * Concurrency safety:
 * - _connectPromise mutex prevents concurrent connectAndListen() calls
 * - Event handlers guard against stale client references via identity check
 */

import pg from 'pg';
import { loadConfig } from '@immoradar/config';
import { createLogger } from '@immoradar/observability';

const logger = createLogger('db:notify');

export interface AlertNotification {
  userId: number;
  alertId: number;
}

export type AlertListener = (notification: AlertNotification) => void;

let _client: pg.Client | null = null;
let _connectPromise: Promise<void> | null = null;
let _listeners: AlertListener[] = [];
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const RECONNECT_DELAY_MS = 5_000;

async function connectAndListen(): Promise<void> {
  // Mutex: if already connecting, wait for the in-flight attempt
  if (_connectPromise) return _connectPromise;

  _connectPromise = doConnect();
  try {
    await _connectPromise;
  } finally {
    _connectPromise = null;
  }
}

async function doConnect(): Promise<void> {
  const config = loadConfig();
  const client = new pg.Client({ connectionString: config.database.url });

  // Guard: only null _client if this is still the active client
  client.on('error', (err) => {
    logger.error('LISTEN client error', { message: err.message });
    scheduleReconnect();
  });

  client.on('end', () => {
    logger.warn('LISTEN client disconnected');
    if (_client === client) {
      _client = null;
    }
    scheduleReconnect();
  });

  client.on('notification', (msg) => {
    if (msg.channel !== 'alert_created' || !msg.payload) return;

    const parts = msg.payload.split(':');
    if (parts.length !== 2) return;

    const userId = Number(parts[0]);
    const alertId = Number(parts[1]);
    if (Number.isNaN(userId) || Number.isNaN(alertId)) return;

    const notification: AlertNotification = { userId, alertId };
    for (const listener of _listeners) {
      try {
        listener(notification);
      } catch (err) {
        logger.error('Alert listener error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  try {
    await client.connect();
    await client.query('LISTEN alert_created');
    _client = client;
    logger.info('LISTEN alert_created registered');
  } catch (err) {
    logger.error('Failed to establish LISTEN connection', {
      error: err instanceof Error ? err.message : String(err),
    });
    await client.end().catch(() => {});
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (_reconnectTimer) return;
  if (_listeners.length === 0) return; // No subscribers, don't reconnect

  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    void connectAndListen();
  }, RECONNECT_DELAY_MS);
}

/**
 * Subscribe to real-time alert notifications via PG LISTEN/NOTIFY.
 * The first subscriber triggers the LISTEN connection; removing all
 * subscribers closes it.
 *
 * Returns an unsubscribe function.
 */
export async function subscribeToAlerts(listener: AlertListener): Promise<() => void> {
  _listeners.push(listener);

  if (!_client && !_connectPromise) {
    await connectAndListen();
  }

  return () => {
    _listeners = _listeners.filter((l) => l !== listener);
    if (_listeners.length === 0) {
      void closeNotifyClient();
    }
  };
}

/** Close the dedicated LISTEN connection. */
export async function closeNotifyClient(): Promise<void> {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (_client) {
    const client = _client;
    _client = null;
    await client.end().catch(() => {});
  }
}
