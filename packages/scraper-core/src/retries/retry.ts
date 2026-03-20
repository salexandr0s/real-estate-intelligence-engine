import type { ErrorClass, RetryPolicy } from '@rei/contracts';
import { createLogger } from '@rei/observability';

const logger = createLogger('retry');

/** Error wrapper that carries classification metadata. */
export class ClassifiedError extends Error {
  constructor(
    public readonly originalError: Error,
    public readonly errorClass: ErrorClass,
    public readonly attempt: number,
    public readonly willRetry: boolean,
  ) {
    super(originalError.message);
    this.name = 'ClassifiedError';
    this.stack = originalError.stack;
  }
}

/**
 * Determine whether a given error class is retryable.
 *
 * - transient_network: always retryable
 * - soft_anti_bot: retryable once (handled by maxAttempts in policy)
 * - parse_failure: retryable once (fresh context may help)
 * - terminal_page: never retryable
 * - unknown: retryable (may be transient)
 */
function isRetryable(errorClass: ErrorClass): boolean {
  return errorClass !== 'terminal_page';
}

/**
 * Calculate delay for the next retry attempt using exponential backoff with jitter.
 *
 * Formula: min(maxDelay, baseDelay * 2^attempt) * (1 +/- jitterFactor * random)
 */
function calculateDelay(policy: RetryPolicy, attempt: number): number {
  const exponentialDelay = policy.baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, policy.maxDelayMs);
  const jitter = 1 + (Math.random() * 2 - 1) * policy.jitterFactor;
  return Math.round(cappedDelay * jitter);
}

/**
 * Execute an async function with retry logic using exponential backoff and jitter.
 *
 * @param fn - The async function to execute
 * @param policy - Retry policy controlling attempts, delays, and jitter
 * @param classifyError - Function that maps an error to an ErrorClass
 * @returns The result of the function on success
 * @throws ClassifiedError on exhausted retries or non-retryable errors
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  classifyError: (error: unknown) => ErrorClass,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const errorClass = classifyError(err);
      lastError = error;

      const isLastAttempt = attempt === policy.maxAttempts - 1;
      const retryable = isRetryable(errorClass);

      logger.warn(`Attempt ${attempt + 1}/${policy.maxAttempts} failed`, {
        errorClass,
        retryable: retryable && !isLastAttempt,
      });

      if (!retryable || isLastAttempt) {
        throw new ClassifiedError(error, errorClass, attempt + 1, false);
      }

      const delayMs = calculateDelay(policy, attempt);
      logger.debug(`Retrying in ${delayMs}ms`, { errorClass });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // Should never reach here, but TypeScript needs the safety net
  throw new ClassifiedError(
    lastError ?? new Error('Retry exhausted'),
    'unknown',
    policy.maxAttempts,
    false,
  );
}
