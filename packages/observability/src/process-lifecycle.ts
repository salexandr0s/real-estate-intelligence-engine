import { createLogger } from './index.js';

export interface ProcessLifecycle {
  /** Aborted as soon as shutdown starts. */
  readonly shutdownSignal: AbortSignal;
  /**
   * Adds a step to run at shutdown. Without a timeout, a hung step holds back the remaining steps
   * until the hard timer ends the process.
   */
  onShutdown(name: string, step: () => Promise<void>, timeoutMs?: number): void;
}

interface ShutdownStep {
  name: string;
  step: () => Promise<void>;
  timeoutMs: number | undefined;
}

function describeError(err: unknown): Record<string, unknown> {
  return err instanceof Error
    ? { errorClass: err.name, error: err.message, stack: err.stack }
    : { error: String(err) };
}

/**
 * Starts a service and owns how it stops. The first signal, rejected main, uncaught exception or
 * unhandled rejection starts shutdown. Anything after that is only logged and does not change the
 * exit code.
 *
 * Shutdown aborts shutdownSignal, arms the hard timer and runs the steps one at a time in
 * registration order. A step that throws or passes its timeout is logged and the next one runs.
 * The process exits 0 after a signal and 1 after an error, whether the steps finished or the hard
 * timer fired.
 *
 * A step added while shutdown is running joins the end of the queue and runs before exit, under
 * the same hard timer.
 */
export function runMain(
  service: string,
  hardTimeoutMs: number,
  main: (lifecycle: ProcessLifecycle) => Promise<void>,
): void {
  const logger = createLogger(service);
  const shutdownController = new AbortController();
  const steps: ShutdownStep[] = [];
  let shuttingDown = false;
  let runningStep: string | undefined;

  async function runStep({ name, step, timeoutMs }: ShutdownStep): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timed out'>((resolve) => {
      if (timeoutMs !== undefined) timer = setTimeout(() => resolve('timed out'), timeoutMs);
    });

    try {
      const outcome = await Promise.race([step(), timedOut]);
      if (outcome === 'timed out') {
        logger.warn(`Shutdown step "${name}" passed its ${timeoutMs} ms limit`);
      }
    } catch (err) {
      logger.error(`Shutdown step "${name}" failed`, describeError(err));
    } finally {
      clearTimeout(timer);
    }
  }

  async function shutdown(exitCode: number): Promise<void> {
    shuttingDown = true;
    // Keeps the code right if the event loop drains while a step waits on nothing.
    process.exitCode = exitCode;
    shutdownController.abort();

    setTimeout(() => {
      logger.error(`Shutdown passed its ${hardTimeoutMs} ms hard limit`, { exitCode, runningStep });
      process.exit(exitCode);
    }, hardTimeoutMs).unref();

    // for...of also reaches steps added while an earlier step runs.
    for (const step of steps) {
      runningStep = step.name;
      await runStep(step);
    }

    logger.info('Shutdown complete', { exitCode });
    process.exit(exitCode);
  }

  function onSignal(signal: NodeJS.Signals): void {
    if (shuttingDown) {
      logger.info(`Received ${signal} during shutdown, ignoring it`);
      return;
    }
    logger.info(`Received ${signal}, shutting down`);
    void shutdown(0);
  }

  function onError(description: string, err: unknown): void {
    logger.error(shuttingDown ? `${description} during shutdown` : description, describeError(err));
    if (!shuttingDown) void shutdown(1);
  }

  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('unhandledRejection', (reason) => onError('Unhandled rejection', reason));
  process.on('uncaughtException', (err) => onError('Uncaught exception', err));

  const lifecycle: ProcessLifecycle = {
    shutdownSignal: shutdownController.signal,
    onShutdown(name, step, timeoutMs) {
      steps.push({ name, step, timeoutMs });
    },
  };

  void main(lifecycle).catch((err: unknown) => onError('Startup failed', err));
}
