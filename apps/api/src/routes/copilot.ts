import type { FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import { loadConfig } from '@immoradar/config';
import { createLogger, ValidationError } from '@immoradar/observability';
import { streamCopilotChat } from '@immoradar/copilot';
import type { CopilotStreamEvent } from '@immoradar/copilot';

const logger = createLogger('api:copilot');

// ── Request validation ──────────────────────────────────────────────────────

const copilotMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
});

const copilotChatBodySchema = z.object({
  messages: z
    .array(copilotMessageSchema)
    .min(1, 'At least one message is required')
    .max(50, 'Maximum 50 messages allowed'),
  context: z
    .object({
      currentListingId: z.number().int().optional(),
      currentDistrictNo: z.number().int().min(1).max(23).optional(),
    })
    .optional(),
  provider: z.enum(['anthropic', 'openai']).optional(),
  model: z.string().optional(),
});

// ── SSE helper ──────────────────────────────────────────────────────────────

function writeSSE(res: import('http').ServerResponse, event: string, data: unknown): void {
  if (res.destroyed) return;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Connection already closed
  }
}

// ── Route registration ──────────────────────────────────────────────────────

export async function copilotRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/copilot/chat',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: 60000,
        },
      },
      schema: {
        tags: ['Copilot'],
        summary: 'AI copilot chat with streaming response',
        description:
          'Send a conversation to the AI copilot and receive a streaming SSE response with text deltas and rich content blocks.',
        body: {
          type: 'object',
          properties: {
            messages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant'] },
                  content: {},
                },
                required: ['role', 'content'],
              },
            },
            context: {
              type: 'object',
              properties: {
                currentListingId: { type: 'integer' },
                currentDistrictNo: { type: 'integer' },
              },
            },
            provider: {
              type: 'string',
              enum: ['anthropic', 'openai'],
              description: 'LLM provider. Defaults to the configured default.',
            },
            model: {
              type: 'string',
              description: 'Model override. Uses provider default if omitted.',
            },
          },
          required: ['messages'],
        },
      },
    },
    async (request, reply) => {
      // Validate request body
      let body: z.infer<typeof copilotChatBodySchema>;
      try {
        body = copilotChatBodySchema.parse(request.body);
      } catch (err) {
        if (err instanceof ZodError) {
          const first = err.issues[0];
          throw new ValidationError(first?.message ?? 'Validation failed', {
            field: first?.path.join('.'),
            issues: err.issues,
          });
        }
        throw err;
      }

      const config = loadConfig();

      // Hijack the response for SSE streaming
      reply.hijack();

      const res = reply.raw;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      // Write initial connection event immediately
      res.write(`event: connected\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);

      // Track client disconnect via the RESPONSE close event.
      // IMPORTANT: Do NOT use request.raw.on('close') — for POST requests,
      // IncomingMessage emits 'close' once the body is consumed (immediately),
      // which is NOT a client disconnect.
      let aborted = false;
      res.on('close', () => {
        aborted = true;
      });

      const provider = body.provider ?? config.copilot.defaultProvider;
      // Design decision: The client sends their own LLM provider API key via
      // X-Copilot-Api-Key. The key is never stored server-side — only forwarded
      // to the LLM provider within this request's lifetime. Requires TLS in production.
      const clientKey = request.headers['x-copilot-api-key'] as string | undefined;
      const apiKey =
        clientKey ??
        (provider === 'anthropic' ? config.copilot.anthropicApiKey : config.copilot.openaiApiKey) ??
        '';

      try {
        const stream = streamCopilotChat({
          messages: body.messages.map((m) => ({
            role: m.role,
            content: m.content as string | import('@immoradar/contracts').ContentBlock[],
          })),
          context: body.context,
          provider,
          apiKey,
          model: body.model || config.copilot.model || undefined,
          maxTokens: config.copilot.maxTokens,
        });

        for await (const event of stream) {
          if (aborted) break;
          writeSSE(res, event.type, eventPayload(event));
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        logger.error('Copilot route error', {
          errorClass: err instanceof Error ? err.name : 'Unknown',
          message: errMsg,
        });
        // Sanitize error before sending to client
        const isAuthError =
          errMsg.toLowerCase().includes('api key') ||
          errMsg.toLowerCase().includes('auth') ||
          errMsg.toLowerCase().includes('401');
        const clientMessage = isAuthError
          ? 'Authentication failed with the AI provider. Please check your API key in Settings.'
          : 'An error occurred. Please try again.';
        writeSSE(res, 'error', { message: clientMessage });
      } finally {
        if (!res.destroyed) {
          res.end();
        }
      }
    },
  );
}

// ── Event payload extractor ─────────────────────────────────────────────────

function eventPayload(event: CopilotStreamEvent): unknown {
  switch (event.type) {
    case 'text_delta':
      return { delta: event.delta };
    case 'tool_use':
      return { toolName: event.toolName };
    case 'content_block':
      return event.block;
    case 'done':
      return {};
    case 'error':
      return { message: event.message };
    default:
      return {};
  }
}
