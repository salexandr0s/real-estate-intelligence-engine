// ── Anthropic LLM provider ──────────────────────────────────────────────────
// Wraps the @anthropic-ai/sdk streaming API behind the provider abstraction.

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlockParam, Tool } from '@anthropic-ai/sdk/resources/messages';
import type {
  LLMProvider,
  ProviderEvent,
  StreamParams,
  ProviderMessage,
  ToolDefinition,
} from './types.js';

// ── Format converters ─────────────────────────────────────────────────────

function toAnthropicTools(tools: ToolDefinition[]): Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Tool['input_schema'],
  }));
}

function toAnthropicMessages(messages: ProviderMessage[]): MessageParam[] {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }

    // Convert ProviderContentBlock[] to Anthropic ContentBlockParam[]
    const blocks: ContentBlockParam[] = msg.content.map((block): ContentBlockParam => {
      switch (block.type) {
        case 'text':
          return { type: 'text', text: block.text };
        case 'tool_use':
          return {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          };
        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: block.toolUseId,
            content: block.content,
            is_error: block.isError,
          };
      }
    });

    return { role: msg.role, content: blocks };
  });
}

// ── OAuth billing header ─────────────────────────────────────────────────
// OAuth subscription tokens require a billing header in the system prompt
// to unlock models beyond Haiku.

const OAUTH_BILLING_HEADER =
  'x-anthropic-billing-header: cc_version=2.1.81.df2; cc_entrypoint=cli; cch=0f1a3;';

// ── Streaming implementation ─────────────────────────────────────────────

async function* streamAnthropic(
  client: Anthropic,
  model: string,
  params: StreamParams,
  isOAuth: boolean,
): AsyncGenerator<ProviderEvent> {
  // For OAuth tokens, send system prompt as structured blocks with the billing header
  const system = isOAuth
    ? [
        { type: 'text' as const, text: OAUTH_BILLING_HEADER },
        { type: 'text' as const, text: params.systemPrompt },
      ]
    : params.systemPrompt;

  const stream = client.messages.stream({
    model,
    max_tokens: params.maxTokens,
    system,
    messages: toAnthropicMessages(params.messages),
    tools: toAnthropicTools(params.tools),
  });

  let currentToolUseId: string | null = null;
  let currentToolUseName: string | null = null;
  let toolInputJson = '';
  let hasToolCalls = false;

  for await (const event of stream) {
    if (event.type === 'content_block_start') {
      if (event.content_block.type === 'tool_use') {
        currentToolUseId = event.content_block.id;
        currentToolUseName = event.content_block.name;
        toolInputJson = '';
        hasToolCalls = true;
        yield {
          type: 'tool_call_start',
          id: event.content_block.id,
          name: event.content_block.name,
        };
      }
    } else if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') {
        yield { type: 'text_delta', delta: event.delta.text };
      } else if (event.delta.type === 'input_json_delta') {
        toolInputJson += event.delta.partial_json;
        if (currentToolUseId) {
          yield {
            type: 'tool_call_delta',
            id: currentToolUseId,
            jsonChunk: event.delta.partial_json,
          };
        }
      }
    } else if (event.type === 'content_block_stop') {
      if (currentToolUseId && currentToolUseName) {
        let parsedInput: unknown = {};
        try {
          parsedInput = toolInputJson ? (JSON.parse(toolInputJson) as unknown) : {};
        } catch {
          // Malformed JSON from model — use empty object
        }
        yield {
          type: 'tool_call_complete',
          id: currentToolUseId,
          name: currentToolUseName,
          input: parsedInput,
        };
        currentToolUseId = null;
        currentToolUseName = null;
        toolInputJson = '';
      }
    } else if (event.type === 'message_delta') {
      if (event.delta.stop_reason === 'end_turn' && !hasToolCalls) {
        yield { type: 'end_turn' };
        return;
      }
    }
  }

  if (hasToolCalls) {
    yield { type: 'needs_tool_results' };
  } else {
    yield { type: 'end_turn' };
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createAnthropicProvider(apiKey: string, model: string): LLMProvider {
  // OAuth tokens (from Claude subscription) start with 'sk-ant-oat'
  // and must be sent via Authorization: Bearer with the OAuth beta header.
  const isOAuth = apiKey.startsWith('sk-ant-oat');
  const client = isOAuth
    ? new Anthropic({
        authToken: apiKey,
        defaultHeaders: {
          'anthropic-beta': 'oauth-2025-04-20,claude-code-20250219',
        },
      })
    : new Anthropic({ apiKey });

  return {
    streamChat(params: StreamParams): AsyncGenerator<ProviderEvent> {
      return streamAnthropic(client, model, params, isOAuth);
    },
    continueWithToolResults(params: StreamParams): AsyncGenerator<ProviderEvent> {
      return streamAnthropic(client, model, params, isOAuth);
    },
  };
}
