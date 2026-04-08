// ── OpenTelemetry Tracing ───────────────────────────────────────────────────

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | null = null;

function isTracingEnabled(): boolean {
  const raw = process.env['OTEL_ENABLED']?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * Initialize OpenTelemetry tracing. Opt-in: no-op when
 * OTEL_ENABLED is falsey or OTEL_EXPORTER_OTLP_ENDPOINT is not set.
 */
export function initTracing(serviceName: string): void {
  if (sdk) return;
  if (!isTracingEnabled()) return;

  const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  if (!endpoint) return;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
}

export async function shutdownTracing(): Promise<void> {
  if (!sdk) return;

  const activeSDK = sdk;
  sdk = null;

  try {
    await activeSDK.shutdown();
  } catch {
    // Tracing teardown must never crash the host process.
  }
}
