// ── OpenAI LLM provider ─────────────────────────────────────────────────────
// Wraps the openai SDK streaming API behind the provider abstraction.

import OpenAI from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type {
  ConversationParams,
  LLMProvider,
  ProviderConversation,
  ProviderErrorKind,
  ProviderEvent,
  ProviderMessage,
  ProviderStopReason,
  ProviderToolResult,
  ToolDefinition,
} from './types.js';

type FinishReason = ChatCompletionChunk.Choice['finish_reason'];

// ── Format converters ─────────────────────────────────────────────────────

function toOpenAITools(tools: ToolDefinition[]): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

function toOpenAIMessages(
  systemPrompt: string,
  messages: ProviderMessage[],
): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }];
  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content });
    } else {
      result.push({ role: 'assistant', content: msg.content });
    }
  }
  return result;
}

function toStopReason(finishReason: FinishReason, hasToolCalls: boolean): ProviderStopReason {
  switch (finishReason) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    case 'stop':
      return 'end_turn';
    default:
      // The stream ended without a finish reason.
      return hasToolCalls ? 'tool_use' : 'end_turn';
  }
}

// ── Error classification ─────────────────────────────────────────────────

function classifyOpenAIError(err: unknown): ProviderErrorKind | undefined {
  if (!(err instanceof OpenAI.APIError)) return undefined;
  if (err.code === 'insufficient_quota') return 'billing';
  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) {
    return 'auth';
  }
  if (err instanceof OpenAI.RateLimitError) return 'rate_limit';
  if (err instanceof OpenAI.NotFoundError) return 'model_not_found';
  if (err instanceof OpenAI.BadRequestError) return 'invalid_request';
  // The timeout error extends the connection error, so test it first.
  if (err instanceof OpenAI.APIConnectionTimeoutError) return 'timeout';
  if (err instanceof OpenAI.APIConnectionError) return 'connection';
  return err.status === 503 ? 'overloaded' : 'server';
}

// ── Conversation ─────────────────────────────────────────────────────────

interface PendingToolCall {
  id: string;
  name: string;
  argumentChunks: string[];
}

function parseArguments(pending: PendingToolCall): unknown {
  const fullJson = pending.argumentChunks.join('');
  try {
    return fullJson ? (JSON.parse(fullJson) as unknown) : {};
  } catch {
    return { _parseError: true, _rawJson: fullJson };
  }
}

function startConversation(
  client: OpenAI,
  model: string,
  params: ConversationParams,
): ProviderConversation {
  const transcript = toOpenAIMessages(params.systemPrompt, params.messages);
  const tools = toOpenAITools(params.tools);

  return {
    async *streamTurn(): AsyncGenerator<ProviderEvent> {
      const stream = await client.chat.completions.create({
        model,
        max_tokens: params.maxTokens,
        messages: [...transcript],
        tools,
        stream: true,
      });

      // Tool calls stream as deltas keyed by index.
      const pending = new Map<number, PendingToolCall>();
      let text = '';
      let finishReason: FinishReason = null;

      for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        if (choice.delta.content) {
          text += choice.delta.content;
          yield { type: 'text_delta', delta: choice.delta.content };
        }

        for (const tc of choice.delta.tool_calls ?? []) {
          const existing = pending.get(tc.index);
          if (existing) {
            if (tc.function?.arguments) existing.argumentChunks.push(tc.function.arguments);
            continue;
          }
          const call: PendingToolCall = {
            id: tc.id ?? `tool_${tc.index}`,
            name: tc.function?.name ?? '',
            argumentChunks: tc.function?.arguments ? [tc.function.arguments] : [],
          };
          pending.set(tc.index, call);
          yield { type: 'tool_call_start', id: call.id, name: call.name };
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
          break;
        }
      }

      const calls = [...pending.values()];
      if (calls.length > 0) {
        const toolCalls: ChatCompletionMessageToolCall[] = calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.argumentChunks.join('') },
        }));
        transcript.push({ role: 'assistant', content: text || null, tool_calls: toolCalls });
      } else if (text) {
        transcript.push({ role: 'assistant', content: text });
      }

      yield {
        type: 'turn_end',
        stopReason: toStopReason(finishReason, calls.length > 0),
        toolCalls: calls.map((c) => ({ id: c.id, name: c.name, input: parseArguments(c) })),
      };
    },

    addToolResults(results: ProviderToolResult[]): void {
      for (const r of results) {
        transcript.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.content });
      }
    },
  };
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createOpenAIProvider(apiKey: string, model: string): LLMProvider {
  const client = new OpenAI({ apiKey });
  return {
    startConversation: (params) => startConversation(client, model, params),
    classifyError: classifyOpenAIError,
  };
}
