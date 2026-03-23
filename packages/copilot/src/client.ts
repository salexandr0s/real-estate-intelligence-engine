// ── Copilot streaming client ─────────────────────────────────────────────────
// Orchestrates the conversation loop: streams the LLM response via a
// provider abstraction, intercepts tool calls, executes them against
// the DB, and resumes the conversation.  Supports Anthropic and OpenAI.

import { createLogger } from '@rei/observability';
import type { ContentBlock, CopilotRequestMessage } from '@rei/contracts';
import type { CopilotStreamEvent } from './types.js';
import { SYSTEM_PROMPT } from './system-prompt.js';
import { COPILOT_TOOLS } from './tools.js';
import { executeTool } from './tool-executor.js';
import { createAnthropicProvider, createOpenAIProvider } from './providers/index.js';
import type {
  LLMProvider,
  ProviderMessage,
  ProviderContentBlock,
  ToolDefinition,
} from './providers/types.js';

const logger = createLogger('copilot');

const MAX_TOOL_LOOPS = 5;

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_ANTHROPIC_OAUTH_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';

// ── Convert tool definitions to provider format ─────────────────────────

function toToolDefinitions(): ToolDefinition[] {
  return COPILOT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema as Record<string, unknown>,
  }));
}

// ── Convert request messages to provider format ─────────────────────────

function toProviderMessages(messages: CopilotRequestMessage[]): ProviderMessage[] {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }
    // For assistant messages with ContentBlock[], serialize to text so
    // the LLM can reference earlier responses.
    const textParts = msg.content
      .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
      .map((b) => b.text);
    return {
      role: msg.role,
      content: textParts.join('\n') || '(structured content)',
    };
  });
}

// ── Create provider from config ─────────────────────────────────────────

function createProvider(
  providerName: 'anthropic' | 'openai',
  apiKey: string,
  model?: string,
): LLMProvider {
  switch (providerName) {
    case 'anthropic': {
      const isOAuth = apiKey.startsWith('sk-ant-oat');
      const defaultModel = isOAuth ? DEFAULT_ANTHROPIC_OAUTH_MODEL : DEFAULT_ANTHROPIC_MODEL;
      return createAnthropicProvider(apiKey, model ?? defaultModel);
    }
    case 'openai':
      return createOpenAIProvider(apiKey, model ?? DEFAULT_OPENAI_MODEL);
  }
}

// ── Streaming entry point ───────────────────────────────────────────────

export interface StreamCopilotChatParams {
  messages: CopilotRequestMessage[];
  context?: { currentListingId?: number; currentDistrictNo?: number };
  provider: 'anthropic' | 'openai';
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export async function* streamCopilotChat(
  params: StreamCopilotChatParams,
): AsyncGenerator<CopilotStreamEvent> {
  const {
    messages,
    context,
    provider: providerName,
    apiKey,
    model,
    maxTokens = DEFAULT_MAX_TOKENS,
  } = params;

  if (!apiKey) {
    yield { type: 'error', message: `${providerName} API key not configured` };
    return;
  }

  const provider = createProvider(providerName, apiKey, model);

  // Build the system prompt with optional context
  let systemPrompt = SYSTEM_PROMPT;
  if (context?.currentListingId) {
    systemPrompt += `\n\nThe user is currently viewing listing #${context.currentListingId}. Refer to it naturally if relevant.`;
  }
  if (context?.currentDistrictNo) {
    systemPrompt += `\nThe user is currently browsing district ${context.currentDistrictNo}.`;
  }

  const tools = toToolDefinitions();
  const providerMessages = toProviderMessages(messages);

  // Conversation loop — the LLM may call tools, then we continue
  let conversationMessages: ProviderMessage[] = [...providerMessages];
  let loopCount = 0;
  let isFirstIteration = true;

  while (loopCount < MAX_TOOL_LOOPS) {
    loopCount++;

    // Collect completed tool calls from the response
    const completedToolCalls: {
      id: string;
      name: string;
      input: unknown;
    }[] = [];

    // Track the full assistant content for the conversation history
    const assistantBlocks: ProviderContentBlock[] = [];
    let accumulatedText = '';

    try {
      const streamParams = {
        systemPrompt,
        messages: conversationMessages,
        tools,
        maxTokens,
      };

      const stream = isFirstIteration
        ? provider.streamChat(streamParams)
        : provider.continueWithToolResults(streamParams);
      isFirstIteration = false;

      for await (const event of stream) {
        switch (event.type) {
          case 'text_delta':
            accumulatedText += event.delta;
            yield { type: 'text_delta', delta: event.delta };
            break;

          case 'tool_call_start':
            yield { type: 'tool_use', toolName: event.name };
            break;

          case 'tool_call_delta':
            // Internal streaming of tool input — no client event needed
            break;

          case 'tool_call_complete':
            completedToolCalls.push({
              id: event.id,
              name: event.name,
              input: event.input,
            });
            assistantBlocks.push({
              type: 'tool_use',
              id: event.id,
              name: event.name,
              input: event.input as Record<string, unknown>,
            });
            break;

          case 'end_turn':
            yield { type: 'done' };
            return;

          case 'needs_tool_results':
            // Will be handled below after the stream ends
            break;
        }
      }

      // Capture any accumulated text in the assistant message
      if (accumulatedText.length > 0) {
        assistantBlocks.push({ type: 'text', text: accumulatedText });
      }

      // If no tool calls were made, we are done
      if (completedToolCalls.length === 0) {
        yield { type: 'done' };
        return;
      }

      // Execute all tool calls and build tool result blocks
      const toolResultBlocks: ProviderContentBlock[] = [];
      for (const toolCall of completedToolCalls) {
        try {
          const result = await executeTool(toolCall.name, toolCall.input);
          // Yield the content block for the client
          yield { type: 'content_block', block: result.contentBlock };
          toolResultBlocks.push({
            type: 'tool_result',
            toolUseId: toolCall.id,
            content: result.rawForClaude,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          logger.error('Tool execution failed', {
            toolName: toolCall.name,
            errorClass: err instanceof Error ? err.name : 'Unknown',
            message: errMsg,
          });
          toolResultBlocks.push({
            type: 'tool_result',
            toolUseId: toolCall.id,
            content: `Error executing ${toolCall.name}: ${errMsg}`,
            isError: true,
          });
        }
      }

      // Continue conversation with tool results
      conversationMessages = [
        ...conversationMessages,
        { role: 'assistant' as const, content: assistantBlocks },
        { role: 'user' as const, content: toolResultBlocks },
      ];
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      logger.error('Copilot stream error', {
        errorClass: err instanceof Error ? err.name : 'Unknown',
        message: errMsg,
      });
      // Sanitize error for client — don't leak API keys or internal details
      const isAuthError =
        errMsg.toLowerCase().includes('api key') ||
        errMsg.toLowerCase().includes('auth') ||
        errMsg.toLowerCase().includes('unauthorized');
      const clientMessage = isAuthError
        ? 'Authentication failed with the AI provider. Please check your API key in Settings.'
        : 'An error occurred while processing your request. Please try again.';
      yield { type: 'error', message: clientMessage };
      return;
    }
  }

  // If we exhausted the loop, yield a final message
  yield {
    type: 'text_delta',
    delta: '\n\n*Reached maximum tool call depth. Please refine your question.*',
  };
  yield { type: 'done' };
}
