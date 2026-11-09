import Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { streamCopilotChat } from '../client.js';
import type { StreamCopilotChatParams } from '../client.js';
import { executeTool } from '../tool-executor.js';
import type { CopilotStreamEvent } from '../types.js';

const { streamMock, constructorSpy } = vi.hoisted(() => ({
  streamMock: vi.fn(),
  constructorSpy: vi.fn(),
}));

// The real SDK, error classes included, with the client's stream call replaced.
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic extends actual.default {
    constructor(options?: ConstructorParameters<typeof actual.default>[0]) {
      super(options);
      constructorSpy(options);
      this.beta.messages.stream = streamMock;
    }
  }
  return { ...actual, default: FakeAnthropic };
});

// executeTool queries the database; these tests only need its results.
vi.mock('../tool-executor.js', () => ({ executeTool: vi.fn() }));

interface FakeStreamParts {
  events?: unknown[];
  message?: { content: unknown[]; stop_reason: string };
  error?: Error;
}

function fakeStream({ events = [], message, error }: FakeStreamParts) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
      if (error) throw error;
    },
    finalMessage: () => Promise.resolve(message),
  };
}

const toolStart = (id: string, name: string) => ({
  type: 'content_block_start',
  index: 0,
  content_block: { type: 'tool_use', id, name, input: {} },
});

const textDelta = (text: string) => ({
  type: 'content_block_delta',
  index: 0,
  delta: { type: 'text_delta', text },
});

const baseParams: StreamCopilotChatParams = {
  messages: [{ role: 'user', content: 'Find flats in district 2' }],
  provider: 'anthropic',
  apiKey: 'sk-ant-api03-test',
};

async function collect(params: StreamCopilotChatParams): Promise<CopilotStreamEvent[]> {
  const events: CopilotStreamEvent[] = [];
  for await (const event of streamCopilotChat(params)) events.push(event);
  return events;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('streamCopilotChat with Anthropic', () => {
  it('sends the first assistant turn back unchanged, with every tool result in one message', async () => {
    const firstTurn = [
      { type: 'thinking', thinking: '', signature: 'sig-1' },
      { type: 'text', text: 'Checking listings.', citations: null },
      { type: 'tool_use', id: 'toolu_1', name: 'search_listings', input: { districtNo: 2 } },
      { type: 'tool_use', id: 'toolu_2', name: 'get_market_stats', input: {} },
    ];
    streamMock
      .mockReturnValueOnce(
        fakeStream({
          events: [
            toolStart('toolu_1', 'search_listings'),
            toolStart('toolu_2', 'get_market_stats'),
          ],
          message: { content: firstTurn, stop_reason: 'tool_use' },
        }),
      )
      .mockReturnValueOnce(
        fakeStream({
          events: [textDelta('Two flats match.')],
          message: {
            content: [{ type: 'text', text: 'Two flats match.', citations: null }],
            stop_reason: 'end_turn',
          },
        }),
      );
    vi.mocked(executeTool)
      .mockResolvedValueOnce({
        contentBlock: { type: 'text', text: 'cards' },
        rawForClaude: '[{"id":1}]',
      })
      .mockRejectedValueOnce(new Error('db down'));

    const events = await collect(baseParams);

    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(streamMock.mock.calls[0]?.[0]).toMatchObject({ model: 'claude-sonnet-5-5' });
    const secondRequest = streamMock.mock.calls[1]?.[0] as { messages: unknown };
    expect(secondRequest.messages).toEqual([
      { role: 'user', content: 'Find flats in district 2' },
      { role: 'assistant', content: firstTurn },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '[{"id":1}]', is_error: false },
          {
            type: 'tool_result',
            tool_use_id: 'toolu_2',
            content: 'Error executing get_market_stats: db down',
            is_error: true,
          },
        ],
      },
    ]);
    expect(events).toContainEqual({ type: 'text_delta', delta: 'Two flats match.' });
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('after a mid-answer fallback, drops thinking and tool calls from the declined attempt', async () => {
    const declinedText = { type: 'text', text: 'Checking.', citations: null };
    const fallback = {
      type: 'fallback',
      from: { model: 'claude-sonnet-5-5' },
      to: { model: 'claude-sonnet-5' },
    };
    const keptCall = { type: 'tool_use', id: 'toolu_1', name: 'search_listings', input: {} };
    streamMock
      .mockReturnValueOnce(
        fakeStream({
          message: {
            content: [
              { type: 'thinking', thinking: '', signature: 'sig-declined' },
              declinedText,
              { type: 'tool_use', id: 'toolu_0', name: 'get_market_stats', input: {} },
              fallback,
              keptCall,
            ],
            stop_reason: 'tool_use',
          },
        }),
      )
      .mockReturnValueOnce(
        fakeStream({ message: { content: [declinedText], stop_reason: 'end_turn' } }),
      );
    vi.mocked(executeTool).mockResolvedValueOnce({
      contentBlock: { type: 'text', text: 'cards' },
      rawForClaude: '[]',
    });

    await collect(baseParams);

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith('search_listings', {});
    const secondRequest = streamMock.mock.calls[1]?.[0] as { messages: unknown[] };
    expect(secondRequest.messages.slice(1)).toEqual([
      { role: 'assistant', content: [declinedText, fallback, keptCall] },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '[]', is_error: false }],
      },
    ]);
  });

  it('ends a refused turn with a plain message', async () => {
    streamMock.mockReturnValueOnce(
      fakeStream({ message: { content: [], stop_reason: 'refusal' } }),
    );

    expect(await collect(baseParams)).toEqual([
      { type: 'text_delta', delta: 'The model declined to answer this request. Try rewording it.' },
      { type: 'done' },
    ]);
  });

  it('maps a 429 to the rate-limit message', async () => {
    const rateLimited = new Anthropic.RateLimitError(
      429,
      { type: 'error', error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } },
      'Rate limit exceeded',
      new Headers(),
      'rate_limit_error',
    );
    streamMock.mockReturnValueOnce(fakeStream({ error: rateLimited }));

    expect(await collect(baseParams)).toEqual([
      {
        type: 'error',
        message: 'Anthropic is rate limiting requests. Wait a minute, then try again.',
      },
    ]);
  });

  it('does not read "generate" in an untyped error as a rate limit', async () => {
    streamMock.mockReturnValueOnce(
      fakeStream({ error: new Error('Failed to generate a moderate summary') }),
    );

    expect(await collect(baseParams)).toEqual([
      { type: 'error', message: 'Copilot hit an unexpected error. Try again.' },
    ]);
  });

  it('refuses a Claude sign-in token before creating a client', async () => {
    const events = await collect({ ...baseParams, apiKey: 'sk-ant-oat01-test' });

    expect(events).toEqual([{ type: 'error', message: expect.stringContaining('Claude Console') }]);
    expect(constructorSpy).not.toHaveBeenCalled();
    expect(streamMock).not.toHaveBeenCalled();
  });
});
