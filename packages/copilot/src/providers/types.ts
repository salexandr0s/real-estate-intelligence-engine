// ── Provider-agnostic types for LLM streaming with tool use ─────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

/** One turn of the app's chat history, flattened to text. */
export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ProviderToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

/** Why the model stopped, mapped to the cases the conversation loop handles. */
export type ProviderStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'pause_turn';

export type ProviderEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'turn_end'; stopReason: ProviderStopReason; toolCalls: ProviderToolCall[] };

export interface ConversationParams {
  systemPrompt: string;
  messages: ProviderMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
}

/**
 * A conversation that keeps the provider's own transcript, so every assistant
 * turn goes back to the model exactly as the provider returned it.
 */
export interface ProviderConversation {
  /** Streams one model turn, appends it to the transcript and ends with `turn_end`. */
  streamTurn(): AsyncGenerator<ProviderEvent>;
  /** Appends the results for the last turn's tool calls as one message. */
  addToolResults(results: ProviderToolResult[]): void;
}

export type ProviderErrorKind =
  | 'auth'
  | 'billing'
  | 'rate_limit'
  | 'overloaded'
  | 'invalid_request'
  | 'model_not_found'
  | 'timeout'
  | 'connection'
  | 'server';

export interface LLMProvider {
  startConversation(params: ConversationParams): ProviderConversation;
  /** Maps an SDK error to a kind. Returns undefined for errors the SDK didn't raise. */
  classifyError(err: unknown): ProviderErrorKind | undefined;
}
