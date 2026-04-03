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

function envStringList(key: string, fallback: string[]): string[] {
  const raw = process.env[key];
  if (raw !== undefined)
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return fallback;
}

export interface PlaywrightConfig {
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
}

export interface ScraperConfig {
  defaultRateLimitRpm: number;
  defaultConcurrencyPerSource: number;
  cooldownAfterBlockMs: number;
  jitterMinMs: number;
  jitterMaxMs: number;
  canaryEnabled: boolean;
  detailWorkerConcurrency: number;
  browserRuntime: 'playwright' | 'patchright';
  patchrightSourceCodes: string[];
}

export interface CanaryConfig {
  nodeEnv: string;
  logLevel: string;
  playwright: PlaywrightConfig;
  scraper: ScraperConfig;
}

export type RuntimeBootMode = 'setup' | 'active';

export interface AppConfig {
  nodeEnv: string;
  logLevel: string;
  api: {
    host: string;
    port: number;
    baseUrl: string;
    authMode: string;
    bearerToken: string;
    corsOrigins: string[];
    rateLimitMax: number;
    rateLimitWindowMs: number;
    trustProxy: boolean | number | string;
    docsPublic: boolean;
    allowPublicDocsInProduction: boolean;
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
  observability: {
    prometheusEnabled: boolean;
    metricsToken: string;
  };
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    forcePathStyle: boolean;
  };
  playwright: PlaywrightConfig;
  scraper: ScraperConfig;
  documents: {
    downloadTimeoutMs: number;
    maxBytes: number;
  };
  runtime: {
    bootMode: RuntimeBootMode;
  };
  scheduler: {
    enabled: boolean;
    staleThresholdDays: number;
    zombieRunTimeoutMinutes: number;
  };
  alerts: {
    emailEnabled: boolean;
    webhookEnabled: boolean;
    pushEnabled: boolean;
    operatorUserId: number | null;
    apns: {
      teamId: string;
      keyId: string;
      keyPath: string;
      bundleId: string;
      production: boolean;
    };
    email: {
      smtpHost: string;
      smtpPort: number;
      fromAddress: string;
      smtpSecure: boolean;
      smtpUser: string;
      smtpPassword: string;
    };
  };
  outreach: {
    enabled: boolean;
    mailboxMode: 'shared_env';
    pollIntervalSeconds: number;
    initialLookbackDays: number;
    followupDelayHours: number;
    maxAutoFollowups: number;
    fromName: string;
    imap: {
      host: string;
      port: number;
      secure: boolean;
      user: string;
      password: string;
      mailbox: string;
    };
    smtp: {
      host: string;
      port: number;
      secure: boolean;
      user: string;
      password: string;
    };
  };
  features: {
    geocodingEnabled: boolean;
    crossSourceClusteringEnabled: boolean;
  };
  copilot: {
    anthropicApiKey: string;
    openaiApiKey: string;
    defaultProvider: 'anthropic' | 'openai';
    model: string;
    maxTokens: number;
  };
}

let _config: AppConfig | null = null;
let _canaryConfig: CanaryConfig | null = null;

function loadPlaywrightConfig(): PlaywrightConfig {
  return {
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
  };
}

function loadRuntimeBootMode(): RuntimeBootMode {
  const raw = envStr('IMMORADAR_RUNTIME_BOOT_MODE', 'active');
  return raw === 'setup' ? 'setup' : 'active';
}

function loadScraperConfig(): ScraperConfig {
  return {
    defaultRateLimitRpm: envInt('SCRAPER_DEFAULT_RATE_LIMIT_RPM', 12),
    defaultConcurrencyPerSource: envInt('SCRAPER_DEFAULT_CONCURRENCY_PER_SOURCE', 1),
    cooldownAfterBlockMs: envInt('SCRAPER_COOLDOWN_AFTER_BLOCK_MS', 900000),
    jitterMinMs: envInt('SCRAPER_JITTER_MIN_MS', 2000),
    jitterMaxMs: envInt('SCRAPER_JITTER_MAX_MS', 7000),
    canaryEnabled: envBool('SCRAPER_CANARY_ENABLED', true),
    detailWorkerConcurrency: envInt('DETAIL_WORKER_CONCURRENCY', 3),
    browserRuntime:
      envStr('SCRAPER_BROWSER_RUNTIME', 'playwright') === 'patchright'
        ? 'patchright'
        : 'playwright',
    patchrightSourceCodes: envStringList('SCRAPER_PATCHRIGHT_SOURCES', []),
  };
}

export function loadCanaryConfig(): CanaryConfig {
  if (_canaryConfig) return _canaryConfig;

  _canaryConfig = {
    nodeEnv: envStr('NODE_ENV', 'development'),
    logLevel: envStr('LOG_LEVEL', 'info'),
    playwright: loadPlaywrightConfig(),
    scraper: loadScraperConfig(),
  };

  return _canaryConfig;
}

export function loadConfig(): AppConfig {
  if (_config) return _config;

  const nodeEnv = envStr('NODE_ENV', 'development');
  const docsPublic = envBool('API_DOCS_PUBLIC', nodeEnv !== 'production');
  const allowPublicDocsInProduction = envBool('API_DOCS_PUBLIC_PRODUCTION_OVERRIDE', false);
  const metricsToken = envStr('METRICS_TOKEN', '');

  _config = {
    nodeEnv,
    logLevel: envStr('LOG_LEVEL', 'info'),
    api: {
      host: envStr('API_HOST', '0.0.0.0'),
      port: envInt('API_PORT', 8080),
      baseUrl: envStr('API_BASE_URL', 'http://localhost:8080'),
      authMode: envStr('API_AUTH_MODE', 'single_user_token'),
      bearerToken:
        nodeEnv === 'production'
          ? envStr('API_BEARER_TOKEN')
          : envStr('API_BEARER_TOKEN', 'dev-token'),
      corsOrigins: envStringList('API_CORS_ORIGINS', ['http://localhost:8080']),
      rateLimitMax: envInt('API_RATE_LIMIT_MAX', 100),
      rateLimitWindowMs: envInt('API_RATE_LIMIT_WINDOW_MS', 60000),
      trustProxy: (() => {
        const raw = envStr('API_TRUST_PROXY', 'false');
        if (raw === 'true') return true;
        if (raw === 'false') return false;
        const n = parseInt(raw, 10);
        return Number.isNaN(n) ? raw : n;
      })(),
      docsPublic,
      allowPublicDocsInProduction,
    },
    database: {
      url: envStr('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/immoradar'),
      poolMax: envInt('DATABASE_POOL_MAX', 20),
      statementTimeoutMs: envInt('DATABASE_STATEMENT_TIMEOUT_MS', 10000),
    },
    redis: {
      url: envStr('REDIS_URL', 'redis://localhost:6379'),
      prefix: envStr('BULLMQ_PREFIX', 'immoradar'),
    },
    observability: {
      prometheusEnabled: envBool('PROMETHEUS_ENABLED', true),
      metricsToken,
    },
    s3: {
      endpoint: envStr('S3_ENDPOINT', 'http://localhost:9000'),
      region: envStr('S3_REGION', 'eu-central-1'),
      bucket: envStr('S3_BUCKET', 'immoradar'),
      accessKey: envStr('S3_ACCESS_KEY', 'minioadmin'),
      secretKey: envStr('S3_SECRET_KEY', 'minioadmin'),
      forcePathStyle: envBool('S3_FORCE_PATH_STYLE', true),
    },
    playwright: loadPlaywrightConfig(),
    scraper: loadScraperConfig(),
    documents: {
      downloadTimeoutMs: envInt('DOCUMENT_DOWNLOAD_TIMEOUT_MS', 20000),
      maxBytes: envInt('DOCUMENT_MAX_BYTES', 25000000),
    },
    runtime: {
      bootMode: loadRuntimeBootMode(),
    },
    scheduler: {
      enabled: envBool('SCHEDULER_ENABLED', true),
      staleThresholdDays: envInt('STALE_THRESHOLD_DAYS', 7),
      zombieRunTimeoutMinutes: envInt('ZOMBIE_RUN_TIMEOUT_MINUTES', 30),
    },
    alerts: {
      emailEnabled: envBool('ALERTS_EMAIL_ENABLED', false),
      webhookEnabled: envBool('ALERTS_WEBHOOK_ENABLED', false),
      pushEnabled: envBool('ALERTS_PUSH_ENABLED', false),
      operatorUserId: process.env.OPERATOR_USER_ID ? envInt('OPERATOR_USER_ID') : null,
      apns: {
        teamId: envStr('APNS_TEAM_ID', ''),
        keyId: envStr('APNS_KEY_ID', ''),
        keyPath: envStr('APNS_KEY_PATH', ''),
        bundleId: envStr('APNS_BUNDLE_ID', ''),
        production: envBool('APNS_PRODUCTION', false),
      },
      email: {
        smtpHost: envStr('ALERTS_SMTP_HOST', envStr('SMTP_HOST', 'localhost')),
        smtpPort: envInt('ALERTS_SMTP_PORT', envInt('SMTP_PORT', 587)),
        fromAddress: envStr('ALERTS_FROM_EMAIL', envStr('SMTP_FROM_ADDRESS', 'noreply@localhost')),
        smtpSecure: envBool('ALERTS_SMTP_SECURE', envBool('SMTP_SECURE', false)),
        smtpUser: envStr('ALERTS_SMTP_USER', envStr('SMTP_USER', '')),
        smtpPassword: envStr('ALERTS_SMTP_PASSWORD', envStr('SMTP_PASSWORD', '')),
      },
    },
    outreach: {
      enabled: envBool('OUTREACH_ENABLED', false),
      mailboxMode: 'shared_env',
      pollIntervalSeconds: envInt('OUTREACH_POLL_INTERVAL_SECONDS', 60),
      initialLookbackDays: envInt('OUTREACH_INITIAL_LOOKBACK_DAYS', 7),
      followupDelayHours: envInt('OUTREACH_FOLLOWUP_DELAY_HOURS', 72),
      maxAutoFollowups: envInt('OUTREACH_MAX_AUTO_FOLLOWUPS', 1),
      fromName: envStr('OUTREACH_FROM_NAME', 'ImmoRadar'),
      imap: {
        host: envStr('OUTREACH_IMAP_HOST', ''),
        port: envInt('OUTREACH_IMAP_PORT', 993),
        secure: envBool('OUTREACH_IMAP_SECURE', true),
        user: envStr('OUTREACH_IMAP_USER', ''),
        password: envStr('OUTREACH_IMAP_PASSWORD', ''),
        mailbox: envStr('OUTREACH_IMAP_MAILBOX', 'INBOX'),
      },
      smtp: {
        host: envStr('OUTREACH_SMTP_HOST', ''),
        port: envInt('OUTREACH_SMTP_PORT', 587),
        secure: envBool('OUTREACH_SMTP_SECURE', false),
        user: envStr('OUTREACH_SMTP_USER', ''),
        password: envStr('OUTREACH_SMTP_PASSWORD', ''),
      },
    },
    features: {
      geocodingEnabled: envBool('FEATURE_GEOCODING_ENABLED', false),
      crossSourceClusteringEnabled: envBool('FEATURE_CROSS_SOURCE_CLUSTERING_ENABLED', false),
    },
    copilot: {
      anthropicApiKey: envStr('ANTHROPIC_API_KEY', ''),
      openaiApiKey: envStr('OPENAI_API_KEY', ''),
      defaultProvider: (() => {
        const raw = envStr('COPILOT_DEFAULT_PROVIDER', 'anthropic');
        if (raw === 'anthropic' || raw === 'openai') return raw;
        return 'anthropic';
      })(),
      model: envStr('COPILOT_MODEL', ''),
      maxTokens: envInt('COPILOT_MAX_TOKENS', 4096),
    },
  };

  // Production safety: refuse to start without encrypted connections
  if (nodeEnv === 'production') {
    if (_config.observability.prometheusEnabled && !_config.observability.metricsToken) {
      throw new Error('METRICS_TOKEN is required when PROMETHEUS_ENABLED=true in production');
    }
    if (_config.api.docsPublic && !_config.api.allowPublicDocsInProduction) {
      throw new Error(
        'API_DOCS_PUBLIC=true is blocked in production unless API_DOCS_PUBLIC_PRODUCTION_OVERRIDE=true',
      );
    }
    const dbUrl = new URL(_config.database.url);
    const sslmode = dbUrl.searchParams.get('sslmode');
    const ssl = dbUrl.searchParams.get('ssl');
    const secureModes = new Set(['require', 'verify-ca', 'verify-full']);
    if (!(sslmode && secureModes.has(sslmode)) && ssl !== 'true') {
      throw new Error(
        'DATABASE_URL must include sslmode=require (or verify-ca/verify-full) in production',
      );
    }
    const redisUrl = new URL(_config.redis.url);
    if (!redisUrl.password) {
      throw new Error('REDIS_URL must include authentication in production');
    }
  }

  return _config;
}

export function resetConfig(): void {
  _config = null;
  _canaryConfig = null;
}
