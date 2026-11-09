// ── Anthropic LLM provider ──────────────────────────────────────────────────
// Wraps the @anthropic-ai/sdk streaming API behind the provider abstraction.

import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaStopReason,
  BetaTool,
  BetaToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type {
  ConversationParams,
  LLMProvider,
  ProviderConversation,
  ProviderErrorKind,
  ProviderEvent,
  ProviderStopReason,
  ProviderToolCall,
  ProviderToolResult,
  ToolDefinition,
} from './types.js';

// When the model declines a request on policy grounds, the API retries it on
// a fallback model that Anthropic picks (`fallbacks: 'default'`).
const SERVER_SIDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// ── Format converters ─────────────────────────────────────────────────────

function toAnthropicTools(tools: ToolDefinition[]): BetaTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    // COPILOT_TOOLS declares object schemas, the shape input_schema requires.
    input_schema: t.inputSchema as BetaTool['input_schema'],
  }));
}

function toStopReason(reason: BetaStopReason | null): ProviderStopReason {
  switch (reason) {
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    case 'pause_turn':
      return 'pause_turn';
    default:
      // end_turn, stop_sequence, compaction (not enabled here) or no reason.
      return 'end_turn';
  }
}

/**
 * After a mid-answer fallback, the blocks the declining model wrote before the last `fallback`
 * block are not sent back, apart from text. Its thinking and tool calls belong to the declined
 * attempt, so those tool calls are never run either. The fallback block stays where it appeared.
 */
function contentToEcho(content: BetaContentBlock[]): BetaContentBlock[] {
  const boundary = content.map((block) => block.type).lastIndexOf('fallback');
  if (boundary === -1) return content;
  return content.filter((block, index) => index >= boundary || block.type === 'text');
}

function toolCallsIn(content: BetaContentBlock[]): ProviderToolCall[] {
  const calls: ProviderToolCall[] = [];
  for (const block of content) {
    if (block.type === 'tool_use') {
      calls.push({ id: block.id, name: block.name, input: block.input });
    }
  }
  return calls;
}

// ── Error classification ─────────────────────────────────────────────────

function classifyAnthropicError(err: unknown): ProviderErrorKind | undefined {
  if (!(err instanceof Anthropic.APIError)) return undefined;
  if (err.type === 'billing_error') return 'billing';
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  ) {
    return 'auth';
  }
  if (err instanceof Anthropic.RateLimitError) return 'rate_limit';
  if (err instanceof Anthropic.NotFoundError) return 'model_not_found';
  if (err instanceof Anthropic.BadRequestError) return 'invalid_request';
  // The timeout error extends the connection error, so test it first.
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (err instanceof Anthropic.APIConnectionError) return 'connection';
  // A 529, or an error event in the middle of a stream (no status, typed body).
  if (err.status === 529 || err.type === 'overloaded_error') return 'overloaded';
  switch (err.type) {
    case 'rate_limit_error':
      return 'rate_limit';
    case 'authentication_error':
    case 'permission_error':
      return 'auth';
    case 'invalid_request_error':
      return 'invalid_request';
    case 'not_found_error':
      return 'model_not_found';
    case 'timeout_error':
      return 'timeout';
    default:
      return 'server';
  }
}

// ── Conversation ─────────────────────────────────────────────────────────

function startConversation(
  client: Anthropic,
  model: string,
  params: ConversationParams,
): ProviderConversation {
  const transcript: BetaMessageParam[] = params.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const tools = toAnthropicTools(params.tools);

  return {
    async *streamTurn(): AsyncGenerator<ProviderEvent> {
      const stream = client.beta.messages.stream({
        model,
        max_tokens: params.maxTokens,
        system: params.systemPrompt,
        messages: [...transcript],
        tools,
        betas: [SERVER_SIDE_FALLBACK_BETA],
        fallbacks: 'default',
      });

      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          yield {
            type: 'tool_call_start',
            id: event.content_block.id,
            name: event.content_block.name,
          };
        } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text_delta', delta: event.delta.text };
        }
      }

      const message = await stream.finalMessage();
      // Without a fallback the turn goes back exactly as returned, so thinking blocks keep
      // their signatures.
      const content = contentToEcho(message.content);
      if (content.length > 0) {
        transcript.push({ role: 'assistant', content });
      }
      yield {
        type: 'turn_end',
        stopReason: toStopReason(message.stop_reason),
        toolCalls: toolCallsIn(content),
      };
    },

    addToolResults(results: ProviderToolResult[]): void {
      const content: BetaToolResultBlockParam[] = results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.toolCallId,
        content: r.content,
        is_error: r.isError,
      }));
      transcript.push({ role: 'user', content });
    },
  };
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createAnthropicProvider(apiKey: string, model: string): LLMProvider {
  const client = new Anthropic({ apiKey });
  return {
    startConversation: (params) => startConversation(client, model, params),
    classifyError: classifyAnthropicError,
  };
}
