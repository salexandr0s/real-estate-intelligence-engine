// ── Structured Logger ───────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  service?: string;
  sourceCode?: string;
  scrapeRunId?: number;
  listingKey?: string;
  jobId?: string;
  errorClass?: string;
  [key: string]: unknown;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[currentLevel];
}

// ── Log Redaction ───────────────────────────────────────────────────────────

const REDACT_KEYS = new Set([
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
]);

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Strips sensitive data from log context before serialization:
 * - Secret/credential keys -> `[REDACTED]`
 * - Large strings (>500 chars) -> truncated with length indicator
 * - Email addresses -> `[email]`
 */
export function redactLogContext(ctx: LogContext): LogContext {
  const result: LogContext = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (REDACT_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 500) {
      result[key] = value.slice(0, 200) + `... [truncated ${value.length} chars]`;
    } else if (typeof value === 'string') {
      result[key] = value.replace(EMAIL_RE, '[email]');
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = redactLogContext(value as LogContext);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const redacted = context ? redactLogContext(context) : undefined;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...redacted,
  };
  return redactSensitive(JSON.stringify(entry));
}

export function createLogger(service: string) {
  const baseCtx: LogContext = { service };

  return {
    debug(message: string, ctx?: LogContext): void {
      if (shouldLog('debug')) {
        process.stdout.write(formatLog('debug', message, { ...baseCtx, ...ctx }) + '\n');
      }
    },
    info(message: string, ctx?: LogContext): void {
      if (shouldLog('info')) {
        process.stdout.write(formatLog('info', message, { ...baseCtx, ...ctx }) + '\n');
      }
    },
    warn(message: string, ctx?: LogContext): void {
      if (shouldLog('warn')) {
        process.stderr.write(formatLog('warn', message, { ...baseCtx, ...ctx }) + '\n');
      }
    },
    error(message: string, ctx?: LogContext): void {
      if (shouldLog('error')) {
        process.stderr.write(formatLog('error', message, { ...baseCtx, ...ctx }) + '\n');
      }
    },
    child(childCtx: LogContext) {
      return createLogger(service).withContext({ ...baseCtx, ...childCtx });
    },
    withContext(extraCtx: LogContext) {
      const merged = { ...baseCtx, ...extraCtx };
      return {
        debug: (msg: string, ctx?: LogContext) => {
          if (shouldLog('debug'))
            process.stdout.write(formatLog('debug', msg, { ...merged, ...ctx }) + '\n');
        },
        info: (msg: string, ctx?: LogContext) => {
          if (shouldLog('info'))
            process.stdout.write(formatLog('info', msg, { ...merged, ...ctx }) + '\n');
        },
        warn: (msg: string, ctx?: LogContext) => {
          if (shouldLog('warn'))
            process.stderr.write(formatLog('warn', msg, { ...merged, ...ctx }) + '\n');
        },
        error: (msg: string, ctx?: LogContext) => {
          if (shouldLog('error'))
            process.stderr.write(formatLog('error', msg, { ...merged, ...ctx }) + '\n');
        },
      };
    },
  };
}

// ── Application Errors ──────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'validation_error', 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string | number) {
    super(`${resource} not found${id ? `: ${id}` : ''}`, 'not_found', 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 'conflict', 409);
    this.name = 'ConflictError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 'unauthorized', 401);
    this.name = 'UnauthorizedError';
  }
}

// ── Warning / Error Severity Classes ────────────────────────────────────────

export type ErrorSeverity = 'warning' | 'error' | 'critical';

/** Operational warnings — not HTTP errors, but worth noting. */
export class OperationalWarning extends AppError {
  public readonly severity: ErrorSeverity = 'warning';

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message, code, 200, details);
    this.name = 'OperationalWarning';
  }
}

/** Transient errors — retryable (e.g. network timeouts, rate limits). */
export class TransientError extends AppError {
  public readonly severity: ErrorSeverity = 'error';
  public readonly retryable = true;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message, code, 503, details);
    this.name = 'TransientError';
  }
}

/** Fatal errors — non-retryable (e.g. schema violations, auth failures). */
export class FatalError extends AppError {
  public readonly severity: ErrorSeverity = 'critical';
  public readonly retryable = false;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message, code, 500, details);
    this.name = 'FatalError';
  }
}

// ── URL Redaction ────────────────────────────────────────────────────────────

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return '[redacted-url]';
  }
}

// ── Warning Classes ─────────────────────────────────────────────────────────

export const WARN_CLASSES = {
  PARSE_DEGRADED: 'parse_degraded',
  RATE_LIMITED: 'rate_limited',
  FALLBACK_USED: 'fallback_used',
  CACHE_MISS: 'cache_miss',
} as const;

// ── Artifact Reference Helper ───────────────────────────────────────────────

export function logArtifactRef(storageKey: string, sizeBytes?: number): Record<string, unknown> {
  return { artifactRef: storageKey, sizeBytes, inline: false };
}

// ── Sensitive Data Redaction ────────────────────────────────────────────────

const SENSITIVE_QUERY_PARAMS_RE = /([?&](?:token|key|secret|password|apikey|api_key)=)[^&]*/gi;
const AUTH_HEADER_RE = /"authorization":"(Bearer|Basic)\s+[^"]+"/gi;
const EMAIL_INLINE_RE = /([a-zA-Z])[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

/**
 * Redacts sensitive data from a serialized string:
 * - URL query params (token=, key=, secret=, password=, apikey=)
 * - Authorization header values
 * - Email addresses (preserves first char + domain)
 */
export function redactSensitive(value: string): string {
  return value
    .replace(SENSITIVE_QUERY_PARAMS_RE, '$1***')
    .replace(AUTH_HEADER_RE, '"authorization":"$1 ***"')
    .replace(EMAIL_INLINE_RE, '$1***@$2');
}

// ── Re-exports ──────────────────────────────────────────────────────────────

export {
  registry,
  scrapeRunsTotal,
  scrapePagesTotal,
  scrapeListingsDiscovered,
  scrapeErrorsTotal,
  normalizationTotal,
  rawSnapshotRate,
  versionCreationRate,
  scoringDuration,
  alertsCreatedTotal,
  alertLagSeconds,
  apiRequestDuration,
  queueDepth,
  sourceHealthGauge,
} from './metrics.js';
export { initTracing, shutdownTracing } from './tracing.js';
