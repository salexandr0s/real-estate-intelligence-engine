import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sdkInstances: Array<{
    options: unknown;
    start: ReturnType<typeof vi.fn>;
    shutdown: ReturnType<typeof vi.fn>;
  }> = [];

  return {
    sdkInstances,
    exporterOptions: [] as unknown[],
    resourceAttributes: [] as unknown[],
    instrumentations: [] as unknown[],
  };
});

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: class {
    public readonly start = vi.fn();
    public readonly shutdown = vi.fn().mockResolvedValue(undefined);

    constructor(public readonly options: unknown) {
      mocks.sdkInstances.push({
        options,
        start: this.start,
        shutdown: this.shutdown,
      });
    }
  },
}));

vi.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: vi.fn((config: unknown) => {
    mocks.instrumentations.push(config);
    return ['auto-instrumentation'];
  }),
}));

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: class {
    constructor(options: unknown) {
      mocks.exporterOptions.push(options);
    }
  },
}));

vi.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: vi.fn((attrs: unknown) => {
    mocks.resourceAttributes.push(attrs);
    return { attrs };
  }),
}));

vi.mock('@opentelemetry/semantic-conventions', () => ({
  ATTR_SERVICE_NAME: 'service.name',
}));

import { initTracing, shutdownTracing } from './tracing.js';

describe('tracing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sdkInstances.length = 0;
    mocks.exporterOptions.length = 0;
    mocks.resourceAttributes.length = 0;
    mocks.instrumentations.length = 0;
    delete process.env['OTEL_ENABLED'];
    delete process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  });

  afterEach(async () => {
    await shutdownTracing();
  });

  it('does nothing when tracing is not explicitly enabled', () => {
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://otel-collector:4318';

    initTracing('api');

    expect(mocks.sdkInstances).toHaveLength(0);
  });

  it('does nothing when the endpoint is missing', () => {
    process.env['OTEL_ENABLED'] = 'true';

    initTracing('api');

    expect(mocks.sdkInstances).toHaveLength(0);
  });

  it('starts the SDK exactly once when tracing is enabled', () => {
    process.env['OTEL_ENABLED'] = 'true';
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://otel-collector:4318';

    initTracing('api');
    initTracing('api');

    expect(mocks.sdkInstances).toHaveLength(1);
    expect(mocks.resourceAttributes).toEqual([{ 'service.name': 'api' }]);
    expect(mocks.exporterOptions).toEqual([{ url: 'http://otel-collector:4318/v1/traces' }]);
    expect(mocks.instrumentations).toEqual([
      { '@opentelemetry/instrumentation-fs': { enabled: false } },
    ]);
    expect(mocks.sdkInstances[0]?.start).toHaveBeenCalledTimes(1);
  });

  it('treats common truthy OTEL_ENABLED values as enabled', () => {
    process.env['OTEL_ENABLED'] = 'yes';
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://otel-collector:4318';

    initTracing('worker-processing');

    expect(mocks.sdkInstances).toHaveLength(1);
  });

  it('swallows shutdown failures and clears the cached SDK so tracing can restart', async () => {
    process.env['OTEL_ENABLED'] = 'true';
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://otel-collector:4318';

    initTracing('api');
    mocks.sdkInstances[0]?.shutdown.mockRejectedValueOnce(new Error('shutdown failed'));

    await expect(shutdownTracing()).resolves.toBeUndefined();

    initTracing('api');

    expect(mocks.sdkInstances).toHaveLength(2);
    expect(mocks.sdkInstances[1]?.start).toHaveBeenCalledTimes(1);
  });
});
