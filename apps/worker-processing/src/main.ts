import { loadConfig } from '@rei/config';
import { createLogger, setLogLevel } from '@rei/observability';
import type { LogLevel } from '@rei/observability';

const logger = createLogger('worker-processing');

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel as LogLevel);

  logger.info('Processing worker starting', {
    nodeEnv: config.nodeEnv,
  } as Record<string, unknown>);

  logger.info('Processing worker ready, waiting for queue implementation', {
    redisUrl: config.redis.url,
    prefix: config.redis.prefix,
  } as Record<string, unknown>);

  // Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down processing worker`);
    // TODO: Close BullMQ workers, DB connections
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void main();
