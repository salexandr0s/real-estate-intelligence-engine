// ── Structured Logger ───────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
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

function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  return JSON.stringify(entry);
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
          if (shouldLog('debug')) process.stdout.write(formatLog('debug', msg, { ...merged, ...ctx }) + '\n');
        },
        info: (msg: string, ctx?: LogContext) => {
          if (shouldLog('info')) process.stdout.write(formatLog('info', msg, { ...merged, ...ctx }) + '\n');
        },
        warn: (msg: string, ctx?: LogContext) => {
          if (shouldLog('warn')) process.stderr.write(formatLog('warn', msg, { ...merged, ...ctx }) + '\n');
        },
        error: (msg: string, ctx?: LogContext) => {
          if (shouldLog('error')) process.stderr.write(formatLog('error', msg, { ...merged, ...ctx }) + '\n');
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
