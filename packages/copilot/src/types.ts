// ── Re-export shared content block types from contracts ─────────────────────

export type {
  TextBlock,
  ListingCardDTO,
  ListingCardsBlock,
  ComparisonRow,
  ComparisonTableBlock,
  ScoreComponent,
  ScoreBreakdownBlock,
  PricePoint,
  PriceHistoryBlock,
  ChartSeries,
  ChartDataBlock,
  StatItem,
  MarketStatsBlock,
  ContentBlock,
  CopilotRequestMessage,
  CopilotChatRequest,
} from '@immoradar/contracts';

// ── Internal types ──────────────────────────────────────────────────────────

/** Result returned by each tool executor — includes the rich block for the
 *  client AND a textual summary for Claude to reason about. */
export interface ToolResult {
  contentBlock: import('@immoradar/contracts').ContentBlock;
  rawForClaude: string;
}

/** Events yielded by the streaming copilot orchestration. */
export type CopilotStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use'; toolName: string }
  | { type: 'content_block'; block: import('@immoradar/contracts').ContentBlock }
  | { type: 'done' }
  | { type: 'error'; message: string };
