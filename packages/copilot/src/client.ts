// ── Copilot streaming client ─────────────────────────────────────────────────
// Runs the conversation loop: streams each model turn through a provider,
// runs the tools the model asks for against the DB and sends the results
// back. Supports Anthropic and OpenAI.

import { createLogger } from '@immoradar/observability';
import type { ContentBlock, CopilotRequestMessage } from '@immoradar/contracts';
import type { CopilotStreamEvent } from './types.js';
import { SYSTEM_PROMPT } from './system-prompt.js';
import { COPILOT_TOOLS } from './tools.js';
import { executeTool } from './tool-executor.js';
import { createAnthropicProvider, createOpenAIProvider } from './providers/index.js';
import type {
  LLMProvider,
  ProviderErrorKind,
  ProviderMessage,
  ProviderStopReason,
  ProviderToolCall,
  ProviderToolResult,
  ToolDefinition,
} from './providers/types.js';

const logger = createLogger('copilot');

/** Tool rounds per request. Each round adds one assistant and one user message. */
const MAX_TOOL_ROUNDS = 5;

/** Thinking counts toward the limit as well as the answer. */
const DEFAULT_MAX_TOKENS = 16000;
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';

const PROVIDER_LABELS = { anthropic: 'Anthropic', openai: 'OpenAI' } as const;

/** Claude subscription sign-in tokens start with this. The Messages API needs a Console API key. */
const CLAUDE_SIGN_IN_TOKEN_PREFIX = 'sk-ant-oat';

const STRUCTURED_CONTENT_PLACEHOLDER = '(structured content)';

const SIGN_IN_TOKEN_MESSAGE =
  'Copilot needs an Anthropic API key, not a Claude sign-in token. Create a key in the Claude Console and add it in Settings.';
const REFUSAL_MESSAGE = 'The model declined to answer this request. Try rewording it.';
const MAX_TOKENS_NOTE =
  '*The answer hit the length limit and was cut off. Ask a narrower question.*';
const TOOL_LIMIT_NOTE = `*Copilot stopped after ${MAX_TOOL_ROUNDS} rounds of data lookups. Ask a narrower question.*`;
const UNEXPECTED_ERROR_MESSAGE = 'Copilot hit an unexpected error. Try again.';

function errorMessage(kind: ProviderErrorKind | undefined, label: string): string {
  switch (kind) {
    case 'auth':
      return `${label} rejected the API key. Check the key in Settings.`;
    case 'billing':
      return `${label} rejected the request because of a billing problem. Check the account's plan and credit balance.`;
    case 'rate_limit':
      return `${label} is rate limiting requests. Wait a minute, then try again.`;
    case 'overloaded':
      return `${label} is overloaded. Try again in a few minutes.`;
    case 'invalid_request':
      return `${label} rejected this chat as invalid. Start a new chat and try again.`;
    case 'model_not_found':
      return `The selected model isn't available with this ${label} API key. Check the model in Settings.`;
    case 'timeout':
      return `${label} took too long to respond. Try again.`;
    case 'connection':
      return `Copilot couldn't reach ${label}. Check the server's internet connection, then try again.`;
    case 'server':
      return `${label} had a server error. Try again in a moment.`;
    case undefined:
      return UNEXPECTED_ERROR_MESSAGE;
  }
}

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
      // The app sends '' for an answer that had only cards; the API rejects empty text.
      return { role: msg.role, content: msg.content || STRUCTURED_CONTENT_PLACEHOLDER };
    }
    // For assistant messages with ContentBlock[], send the text so the model
    // can refer to earlier answers.
    const textParts = msg.content
      .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
      .map((b) => b.text);
    return { role: msg.role, content: textParts.join('\n') || STRUCTURED_CONTENT_PLACEHOLDER };
  });
}

function buildSystemPrompt(context: StreamCopilotChatParams['context']): string {
  let systemPrompt = SYSTEM_PROMPT;
  if (context?.currentListingId) {
    systemPrompt += `\n\nThe user is currently viewing listing #${context.currentListingId}. Refer to it naturally if relevant.`;
  }
  if (context?.currentDistrictNo) {
    systemPrompt += `\nThe user is currently browsing district ${context.currentDistrictNo}.`;
  }
  return systemPrompt;
}

// ── Create provider from config ─────────────────────────────────────────

function createProvider(
  providerName: 'anthropic' | 'openai',
  apiKey: string,
  model?: string,
): LLMProvider {
  switch (providerName) {
    case 'anthropic':
      return createAnthropicProvider(apiKey, model ?? DEFAULT_ANTHROPIC_MODEL);
    case 'openai':
      return createOpenAIProvider(apiKey, model ?? DEFAULT_OPENAI_MODEL);
  }
}

// ── Tool execution ──────────────────────────────────────────────────────

interface ToolOutcome {
  block?: ContentBlock;
  result: ProviderToolResult;
}

async function runTool(call: ProviderToolCall): Promise<ToolOutcome> {
  try {
    const result = await executeTool(call.name, call.input);
    return {
      block: result.contentBlock,
      result: { toolCallId: call.id, content: result.rawForClaude, isError: false },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Tool execution failed', {
      toolName: call.name,
      errorClass: err instanceof Error ? err.name : 'Unknown',
      message,
    });
    return {
      result: {
        toolCallId: call.id,
        content: `Error executing ${call.name}: ${message}`,
        isError: true,
      },
    };
  }
}

// ── Error logging ───────────────────────────────────────────────────────

/** Logs the raw provider error on the server. The client only gets a fixed message. */
function logProviderError(providerName: string, err: unknown): void {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const details: Record<string, unknown> = {
    provider: providerName,
    // SDK errors keep the default name 'Error', so log the class instead.
    errorClass: err instanceof Error ? err.constructor.name : typeof err,
    message: rawMessage.replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]'),
  };
  if (typeof err === 'object' && err !== null) {
    if ('status' in err) details.status = err.status;
    if ('type' in err) details.type = err.type;
    if ('requestID' in err) details.requestId = err.requestID;
    if ('request_id' in err) details.requestId = err.request_id;
  }
  logger.error('Copilot provider error', details);
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
  const label = PROVIDER_LABELS[providerName];

  if (!apiKey) {
    yield { type: 'error', message: `No ${label} API key is set. Add one in Settings.` };
    return;
  }
  // Checked before any client exists, so a sign-in token never reaches the API.
  if (providerName === 'anthropic' && apiKey.startsWith(CLAUDE_SIGN_IN_TOKEN_PREFIX)) {
    yield { type: 'error', message: SIGN_IN_TOKEN_MESSAGE };
    return;
  }

  const provider = createProvider(providerName, apiKey, model);
  const conversation = provider.startConversation({
    systemPrompt: buildSystemPrompt(context),
    messages: toProviderMessages(messages),
    tools: toToolDefinitions(),
    maxTokens,
  });

  let streamedText = false;
  const note = (text: string): CopilotStreamEvent => ({
    type: 'text_delta',
    delta: streamedText ? `\n\n${text}` : text,
  });

  try {
    for (let round = 0; ; round++) {
      let stopReason: ProviderStopReason | undefined;
      let toolCalls: ProviderToolCall[] = [];

      for await (const event of conversation.streamTurn()) {
        if (event.type === 'text_delta') {
          streamedText = true;
          yield { type: 'text_delta', delta: event.delta };
        } else if (event.type === 'tool_call_start') {
          yield { type: 'tool_use', toolName: event.name };
        } else {
          stopReason = event.stopReason;
          toolCalls = event.toolCalls;
        }
      }

      if (stopReason === undefined) {
        throw new Error('Provider turn ended without a stop reason');
      }
      if (stopReason === 'refusal') {
        yield note(REFUSAL_MESSAGE);
        break;
      }
      if (stopReason === 'max_tokens') {
        // Tool calls in a cut-off turn can be incomplete, so none of them run.
        yield note(MAX_TOKENS_NOTE);
        break;
      }
      if (stopReason === 'end_turn' || (stopReason === 'tool_use' && toolCalls.length === 0)) {
        break;
      }
      if (round >= MAX_TOOL_ROUNDS) {
        yield note(TOOL_LIMIT_NOTE);
        break;
      }
      if (stopReason === 'tool_use') {
        const results: ProviderToolResult[] = [];
        for (const call of toolCalls) {
          const outcome = await runTool(call);
          if (outcome.block) yield { type: 'content_block', block: outcome.block };
          results.push(outcome.result);
        }
        conversation.addToolResults(results);
      }
      // pause_turn: the paused turn is already in the transcript, and the
      // next request lets the model continue it.
    }
  } catch (err) {
    logProviderError(providerName, err);
    yield { type: 'error', message: errorMessage(provider.classifyError(err), label) };
    return;
  }

  yield { type: 'done' };
}
