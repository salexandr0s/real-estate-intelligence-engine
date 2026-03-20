// ── Environment Configuration ───────────────────────────────────────────────

function envStr(key: string, fallback?: string): string {
  const val = process.env[key];
  if (val !== undefined) return val;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${key}`);
}

function envInt(key: string, fallback?: number): number {
  const raw = process.env[key];
  if (raw !== undefined) {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) throw new Error(`Invalid integer for ${key}: ${raw}`);
    return n;
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${key}`);
}

function envBool(key: string, fallback?: boolean): boolean {
  const raw = process.env[key];
  if (raw !== undefined) return raw === 'true' || raw === '1';
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${key}`);
}

export interface AppConfig {
  nodeEnv: string;
  logLevel: string;
  api: {
    host: string;
    port: number;
    baseUrl: string;
    authMode: string;
    bearerToken: string;
  };
  database: {
    url: string;
    poolMax: number;
    statementTimeoutMs: number;
  };
  redis: {
    url: string;
    prefix: string;
  };
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    forcePathStyle: boolean;
  };
  playwright: {
    browser: string;
    headless: boolean;
    defaultTimeoutMs: number;
    navigationTimeoutMs: number;
    locale: string;
    timezoneId: string;
    maxContextsPerWorker: number;
    captureScreenshotOnFailure: boolean;
    captureHtmlOnFailure: boolean;
    captureHarOnFailure: boolean;
  };
  scraper: {
    defaultRateLimitRpm: number;
    defaultConcurrencyPerSource: number;
    cooldownAfterBlockMs: number;
    jitterMinMs: number;
    jitterMaxMs: number;
    canaryEnabled: boolean;
  };
  scheduler: {
    enabled: boolean;
    loopIntervalMs: number;
  };
  alerts: {
    emailEnabled: boolean;
    webhookEnabled: boolean;
  };
  features: {
    geocodingEnabled: boolean;
    crossSourceClusteringEnabled: boolean;
  };
}

let _config: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (_config) return _config;

  _config = {
    nodeEnv: envStr('NODE_ENV', 'development'),
    logLevel: envStr('LOG_LEVEL', 'info'),
    api: {
      host: envStr('API_HOST', '0.0.0.0'),
      port: envInt('API_PORT', 8080),
      baseUrl: envStr('API_BASE_URL', 'http://localhost:8080'),
      authMode: envStr('API_AUTH_MODE', 'single_user_token'),
      bearerToken: envStr('API_BEARER_TOKEN', 'dev-token'),
    },
    database: {
      url: envStr('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/real_estate_intel'),
      poolMax: envInt('DATABASE_POOL_MAX', 20),
      statementTimeoutMs: envInt('DATABASE_STATEMENT_TIMEOUT_MS', 10000),
    },
    redis: {
      url: envStr('REDIS_URL', 'redis://localhost:6379'),
      prefix: envStr('BULLMQ_PREFIX', 'rei'),
    },
    s3: {
      endpoint: envStr('S3_ENDPOINT', 'http://localhost:9000'),
      region: envStr('S3_REGION', 'eu-central-1'),
      bucket: envStr('S3_BUCKET', 'real-estate-intel'),
      accessKey: envStr('S3_ACCESS_KEY', 'minioadmin'),
      secretKey: envStr('S3_SECRET_KEY', 'minioadmin'),
      forcePathStyle: envBool('S3_FORCE_PATH_STYLE', true),
    },
    playwright: {
      browser: envStr('PLAYWRIGHT_BROWSER', 'chromium'),
      headless: envBool('PLAYWRIGHT_HEADLESS', true),
      defaultTimeoutMs: envInt('PLAYWRIGHT_DEFAULT_TIMEOUT_MS', 30000),
      navigationTimeoutMs: envInt('PLAYWRIGHT_NAVIGATION_TIMEOUT_MS', 45000),
      locale: envStr('PLAYWRIGHT_LOCALE', 'de-AT'),
      timezoneId: envStr('PLAYWRIGHT_TIMEZONE_ID', 'Europe/Vienna'),
      maxContextsPerWorker: envInt('PLAYWRIGHT_MAX_CONTEXTS_PER_WORKER', 2),
      captureScreenshotOnFailure: envBool('PLAYWRIGHT_CAPTURE_SCREENSHOT_ON_FAILURE', true),
      captureHtmlOnFailure: envBool('PLAYWRIGHT_CAPTURE_HTML_ON_FAILURE', true),
      captureHarOnFailure: envBool('PLAYWRIGHT_CAPTURE_HAR_ON_FAILURE', false),
    },
    scraper: {
      defaultRateLimitRpm: envInt('SCRAPER_DEFAULT_RATE_LIMIT_RPM', 12),
      defaultConcurrencyPerSource: envInt('SCRAPER_DEFAULT_CONCURRENCY_PER_SOURCE', 1),
      cooldownAfterBlockMs: envInt('SCRAPER_COOLDOWN_AFTER_BLOCK_MS', 900000),
      jitterMinMs: envInt('SCRAPER_JITTER_MIN_MS', 2000),
      jitterMaxMs: envInt('SCRAPER_JITTER_MAX_MS', 7000),
      canaryEnabled: envBool('SCRAPER_CANARY_ENABLED', true),
    },
    scheduler: {
      enabled: envBool('SCHEDULER_ENABLED', true),
      loopIntervalMs: envInt('SCHEDULER_LOOP_INTERVAL_MS', 30000),
    },
    alerts: {
      emailEnabled: envBool('ALERTS_EMAIL_ENABLED', false),
      webhookEnabled: envBool('ALERTS_WEBHOOK_ENABLED', false),
    },
    features: {
      geocodingEnabled: envBool('FEATURE_GEOCODING_ENABLED', false),
      crossSourceClusteringEnabled: envBool('FEATURE_CROSS_SOURCE_CLUSTERING_ENABLED', false),
    },
  };

  return _config;
}

export function resetConfig(): void {
  _config = null;
}
