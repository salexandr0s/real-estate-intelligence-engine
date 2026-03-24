import { describe, it, expect } from 'vitest';
import {
  registry,
  scrapeRunsTotal,
  apiRequestDuration,
  queueDepth,
  sourceHealthGauge,
  redactLogContext,
  redactSensitive,
  WARN_CLASSES,
  logArtifactRef,
  OperationalWarning,
  TransientError,
  FatalError,
} from '@immoradar/observability';

describe('Prometheus metrics', () => {
  it('registry exposes metrics in text format', async () => {
    const output = await registry.metrics();
    expect(output).toContain('# HELP');
    expect(output).toContain('# TYPE');
  });

  it('registry contentType is prometheus text', () => {
    expect(registry.contentType).toContain('text/plain');
  });

  it('counter increments', async () => {
    scrapeRunsTotal.inc({ source: 'test', status: 'ok' });
    const output = await registry.metrics();
    expect(output).toContain('immoradar_scrape_runs_total');
  });

  it('histogram observes values', async () => {
    apiRequestDuration.observe({ method: 'GET', route: '/test', status_code: '200' }, 0.05);
    const output = await registry.metrics();
    expect(output).toContain('immoradar_api_request_duration_seconds');
  });

  it('gauge sets values', async () => {
    queueDepth.set({ queue: 'ingestion' }, 5);
    sourceHealthGauge.set({ source: 'willhaben' }, 1);
    const output = await registry.metrics();
    expect(output).toContain('immoradar_queue_depth');
    expect(output).toContain('immoradar_source_health');
  });
});

describe('redactLogContext', () => {
  it('redacts sensitive keys', () => {
    const ctx = redactLogContext({
      password: 'hunter2',
      token: 'abc123',
      authorization: 'Bearer xxx',
      cookie: 'session=abc',
      apiKey: 'key-123',
      api_key: 'key-456',
      secret: 'shh',
      normalField: 'ok',
    });
    expect(ctx.password).toBe('[REDACTED]');
    expect(ctx.token).toBe('[REDACTED]');
    expect(ctx.authorization).toBe('[REDACTED]');
    expect(ctx.cookie).toBe('[REDACTED]');
    expect(ctx.apiKey).toBe('[REDACTED]');
    expect(ctx.api_key).toBe('[REDACTED]');
    expect(ctx.secret).toBe('[REDACTED]');
    expect(ctx.normalField).toBe('ok');
  });

  it('truncates large string values', () => {
    const bigValue = 'x'.repeat(600);
    const ctx = redactLogContext({ body: bigValue });
    expect(ctx.body).toContain('... [truncated 600 chars]');
    expect((ctx.body as string).length).toBeLessThan(300);
  });

  it('masks email addresses', () => {
    const ctx = redactLogContext({ message: 'Contact user@example.com for details' });
    expect(ctx.message).toBe('Contact [email] for details');
    expect(ctx.message).not.toContain('user@example.com');
  });

  it('passes through non-string non-sensitive values', () => {
    const ctx = redactLogContext({ count: 42, nested: { a: 1 } });
    expect(ctx.count).toBe(42);
    expect(ctx.nested).toEqual({ a: 1 });
  });
});

describe('redactSensitive', () => {
  it('masks URL query params with sensitive keys', () => {
    const url = 'https://api.example.com/data?token=abc123&key=secret456&name=ok';
    const result = redactSensitive(url);
    expect(result).toContain('token=***');
    expect(result).toContain('key=***');
    expect(result).toContain('name=ok');
    expect(result).not.toContain('abc123');
    expect(result).not.toContain('secret456');
  });

  it('masks Authorization header values in JSON', () => {
    const json = '{"authorization":"Bearer eyJhbGc","other":"ok"}';
    const result = redactSensitive(json);
    expect(result).toContain('"authorization":"Bearer ***"');
    expect(result).not.toContain('eyJhbGc');
    expect(result).toContain('"other":"ok"');
  });

  it('masks email addresses preserving first char and domain', () => {
    const text = 'Contact admin@example.com for help';
    const result = redactSensitive(text);
    expect(result).toContain('a***@example.com');
    expect(result).not.toContain('admin@');
  });

  it('handles combined sensitive data', () => {
    const input = 'url=https://x.com?secret=abc user=test@mail.com "authorization":"Basic creds"';
    const result = redactSensitive(input);
    expect(result).not.toContain('abc');
    expect(result).not.toContain('test@');
    expect(result).not.toContain('creds');
  });
});

describe('WARN_CLASSES', () => {
  it('exports expected warning class keys', () => {
    expect(WARN_CLASSES.PARSE_DEGRADED).toBe('parse_degraded');
    expect(WARN_CLASSES.RATE_LIMITED).toBe('rate_limited');
    expect(WARN_CLASSES.FALLBACK_USED).toBe('fallback_used');
    expect(WARN_CLASSES.CACHE_MISS).toBe('cache_miss');
  });
});

describe('logArtifactRef', () => {
  it('returns reference object with storage key', () => {
    const ref = logArtifactRef('s3://bucket/key.html', 12345);
    expect(ref).toEqual({ artifactRef: 's3://bucket/key.html', sizeBytes: 12345, inline: false });
  });

  it('works without sizeBytes', () => {
    const ref = logArtifactRef('s3://bucket/key.html');
    expect(ref).toEqual({
      artifactRef: 's3://bucket/key.html',
      sizeBytes: undefined,
      inline: false,
    });
  });
});

describe('Error severity classes', () => {
  it('OperationalWarning has warning severity', () => {
    const w = new OperationalWarning('low data', 'low_data');
    expect(w.severity).toBe('warning');
    expect(w.statusCode).toBe(200);
    expect(w.name).toBe('OperationalWarning');
    expect(w.code).toBe('low_data');
  });

  it('TransientError is retryable', () => {
    const t = new TransientError('timeout', 'timeout');
    expect(t.severity).toBe('error');
    expect(t.retryable).toBe(true);
    expect(t.statusCode).toBe(503);
    expect(t.name).toBe('TransientError');
  });

  it('FatalError is non-retryable', () => {
    const f = new FatalError('schema violation', 'schema_error');
    expect(f.severity).toBe('critical');
    expect(f.retryable).toBe(false);
    expect(f.statusCode).toBe(500);
    expect(f.name).toBe('FatalError');
  });

  it('all inherit from Error', () => {
    expect(new OperationalWarning('x', 'x')).toBeInstanceOf(Error);
    expect(new TransientError('x', 'x')).toBeInstanceOf(Error);
    expect(new FatalError('x', 'x')).toBeInstanceOf(Error);
  });
});
