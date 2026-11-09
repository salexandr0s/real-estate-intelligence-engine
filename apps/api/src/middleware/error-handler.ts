import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@immoradar/observability';
import { createLogger } from '@immoradar/observability';
import { API_ERROR_CODES } from '@immoradar/contracts';

const logger = createLogger('api:error-handler');

/** The envelope code for a client error that carries no code of its own. */
function clientErrorCode(statusCode: number): string {
  switch (statusCode) {
    case 401:
      return API_ERROR_CODES.UNAUTHORIZED;
    case 403:
      return API_ERROR_CODES.FORBIDDEN;
    case 409:
      return API_ERROR_CODES.CONFLICT;
    case 429:
      return API_ERROR_CODES.RATE_LIMITED;
    default:
      return API_ERROR_CODES.BAD_REQUEST;
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    // Handle AppError subclasses (ValidationError, NotFoundError, etc.)
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    }

    // Handle Fastify validation errors (from schema validation)
    if (error.validation) {
      return reply.status(400).send({
        error: {
          code: API_ERROR_CODES.VALIDATION_ERROR,
          message: error.message,
          details: {
            validation: error.validation,
          },
        },
      });
    }

    // Handle Fastify 404 (route not found)
    if (error.statusCode === 404) {
      return reply.status(404).send({
        error: {
          code: API_ERROR_CODES.NOT_FOUND,
          message: 'Route not found',
        },
      });
    }

    // Fastify's own client errors (malformed JSON, unsupported media type, body too large) keep
    // their status and code, so a bad request doesn't read as a server failure.
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 0;
    if (statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        error: {
          code:
            typeof error.code === 'string' && error.code !== ''
              ? error.code
              : clientErrorCode(statusCode),
          message:
            typeof error.message === 'string' && error.message !== ''
              ? error.message
              : 'The request could not be processed.',
        },
      });
    }

    // Unexpected errors - log full details, return generic response
    logger.error('Unhandled error', {
      errorClass: error.name,
      message: error.message,
      url: request.url,
      method: request.method,
      stack: error.stack,
    } as Record<string, unknown>);

    return reply.status(500).send({
      error: {
        code: API_ERROR_CODES.INTERNAL_ERROR,
        message: 'An unexpected error occurred',
      },
    });
  });

  // Handle 404s for unregistered routes
  app.setNotFoundHandler((_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(404).send({
      error: {
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'Route not found',
      },
    });
  });
}
