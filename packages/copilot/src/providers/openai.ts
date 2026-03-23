// ── OpenAI LLM provider ─────────────────────────────────────────────────────
// Wraps the openai SDK streaming API behind the provider abstraction.

import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionChunk,
} from 'openai/resources/chat/completions';
import type {
  LLMProvider,
  ProviderEvent,
  StreamParams,
  ProviderMessage,
  ProviderContentBlock,
  ToolDefinition,
} from './types.js';

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
    if (typeof msg.content === 'string') {
      if (msg.role === 'user') {
        result.push({ role: 'user', content: msg.content });
      } else {
        result.push({ role: 'assistant', content: msg.content });
      }
      continue;
    }

    // ProviderContentBlock[] — need to decompose into OpenAI message types
    const blocks = msg.content;
    convertBlocksToOpenAIMessages(msg.role, blocks, result);
  }

  return result;
}

function convertBlocksToOpenAIMessages(
  role: 'user' | 'assistant',
  blocks: ProviderContentBlock[],
  result: ChatCompletionMessageParam[],
): void {
  // Group blocks by type for correct OpenAI message construction.
  // Assistant messages with tool_use blocks become assistant messages with tool_calls.
  // Tool_result blocks become separate "tool" role messages.
  // Text blocks are straightforward.

  if (role === 'assistant') {
    const textBlocks = blocks.filter(
      (b): b is ProviderContentBlock & { type: 'text' } => b.type === 'text',
    );
    const toolUseBlocks = blocks.filter(
      (b): b is ProviderContentBlock & { type: 'tool_use' } => b.type === 'tool_use',
    );

    if (toolUseBlocks.length > 0) {
      result.push({
        role: 'assistant',
        content: textBlocks.length > 0 ? textBlocks.map((b) => b.text).join('\n') : null,
        tool_calls: toolUseBlocks.map((b) => ({
          id: b.id,
          type: 'function' as const,
          function: {
            name: b.name,
            arguments: JSON.stringify(b.input),
          },
        })),
      });
    } else if (textBlocks.length > 0) {
      result.push({
        role: 'assistant',
        content: textBlocks.map((b) => b.text).join('\n'),
      });
    }
  } else {
    // User role — text blocks go as user messages, tool_result blocks as tool messages
    const textBlocks = blocks.filter(
      (b): b is ProviderContentBlock & { type: 'text' } => b.type === 'text',
    );
    const toolResultBlocks = blocks.filter(
      (b): b is ProviderContentBlock & { type: 'tool_result' } => b.type === 'tool_result',
    );

    if (textBlocks.length > 0) {
      result.push({
        role: 'user',
        content: textBlocks.map((b) => b.text).join('\n'),
      });
    }

    for (const tr of toolResultBlocks) {
      result.push({
        role: 'tool',
        tool_call_id: tr.toolUseId,
        content: tr.content,
      });
    }
  }
}

// ── Streaming implementation ─────────────────────────────────────────────

interface PendingToolCall {
  index: number;
  id: string;
  name: string;
  argumentChunks: string[];
}

function completePendingToolCall(pending: PendingToolCall): ProviderEvent {
  const fullJson = pending.argumentChunks.join('');
  let parsedInput: unknown = {};
  try {
    parsedInput = fullJson ? (JSON.parse(fullJson) as unknown) : {};
  } catch {
    parsedInput = { _parseError: true, _rawJson: fullJson };
  }
  return {
    type: 'tool_call_complete',
    id: pending.id,
    name: pending.name,
    input: parsedInput,
  };
}

async function* streamOpenAI(
  client: OpenAI,
  model: string,
  params: StreamParams,
): AsyncGenerator<ProviderEvent> {
  const stream = await client.chat.completions.create({
    model,
    max_tokens: params.maxTokens,
    messages: toOpenAIMessages(params.systemPrompt, params.messages),
    tools: toOpenAITools(params.tools),
    stream: true,
  });

  // Track in-progress tool calls by index
  const pendingToolCalls = new Map<number, PendingToolCall>();

  for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
    const choice = chunk.choices[0];
    if (!choice) continue;

    const delta = choice.delta;

    // Text content
    if (delta.content) {
      yield { type: 'text_delta', delta: delta.content };
    }

    // Tool calls — OpenAI streams them with index-based deltas
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const existing = pendingToolCalls.get(tc.index);

        if (!existing) {
          // New tool call starting
          const id = tc.id ?? `tool_${tc.index}`;
          const name = tc.function?.name ?? '';
          const pending: PendingToolCall = {
            index: tc.index,
            id,
            name,
            argumentChunks: [],
          };
          if (tc.function?.arguments) {
            pending.argumentChunks.push(tc.function.arguments);
          }
          pendingToolCalls.set(tc.index, pending);
          yield { type: 'tool_call_start', id, name };

          if (tc.function?.arguments) {
            yield {
              type: 'tool_call_delta',
              id,
              jsonChunk: tc.function.arguments,
            };
          }
        } else {
          // Delta for existing tool call
          if (tc.function?.arguments) {
            existing.argumentChunks.push(tc.function.arguments);
            yield {
              type: 'tool_call_delta',
              id: existing.id,
              jsonChunk: tc.function.arguments,
            };
          }
        }
      }
    }

    // Check finish reason
    if (choice.finish_reason === 'tool_calls') {
      // Complete all pending tool calls
      for (const pending of pendingToolCalls.values()) {
        yield completePendingToolCall(pending);
      }
      yield { type: 'needs_tool_results' };
      return;
    }

    if (choice.finish_reason === 'stop') {
      yield { type: 'end_turn' };
      return;
    }
  }

  // Stream ended without explicit finish_reason — complete any pending tool calls
  if (pendingToolCalls.size > 0) {
    for (const pending of pendingToolCalls.values()) {
      yield completePendingToolCall(pending);
    }
    yield { type: 'needs_tool_results' };
  } else {
    yield { type: 'end_turn' };
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createOpenAIProvider(apiKey: string, model: string): LLMProvider {
  const client = new OpenAI({ apiKey });

  return {
    streamChat(params: StreamParams): AsyncGenerator<ProviderEvent> {
      return streamOpenAI(client, model, params);
    },
    continueWithToolResults(params: StreamParams): AsyncGenerator<ProviderEvent> {
      return streamOpenAI(client, model, params);
    },
  };
}
