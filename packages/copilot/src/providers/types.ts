// ── Provider-agnostic types for LLM streaming with tool-use ─────────────────

export type ProviderEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; jsonChunk: string }
  | { type: 'tool_call_complete'; id: string; name: string; input: unknown }
  | { type: 'end_turn' }
  | { type: 'needs_tool_results' }; // stop_reason=tool_use, need to feed results and continue

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: string | ProviderContentBlock[];
}

export type ProviderContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface StreamParams {
  systemPrompt: string;
  messages: ProviderMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
}

export interface LLMProvider {
  /** Stream a chat completion with tool-use support. Yields events until the turn is complete. */
  streamChat(params: StreamParams): AsyncGenerator<ProviderEvent>;

  /** Continue the conversation after tool results. Pass the full messages including tool results. */
  continueWithToolResults(params: StreamParams): AsyncGenerator<ProviderEvent>;
}
