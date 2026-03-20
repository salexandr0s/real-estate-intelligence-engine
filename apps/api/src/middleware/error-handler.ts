import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@rei/observability';
import { createLogger } from '@rei/observability';
import { API_ERROR_CODES } from '@rei/contracts';

const logger = createLogger('api:error-handler');

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
