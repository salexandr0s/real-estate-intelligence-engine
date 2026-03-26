import { createMachine, getNextSnapshot } from 'xstate';
import type { OutreachWorkflowState } from '@immoradar/contracts';

export type OutreachMachineEvent =
  | { type: 'QUEUE_INITIAL' }
  | { type: 'SEND_SUCCEEDED'; sendKind: 'initial' | 'followup' }
  | { type: 'SEND_FAILED' }
  | { type: 'FOLLOWUP_DUE' }
  | { type: 'REPLY_RECEIVED' }
  | { type: 'PAUSE' }
  | { type: 'RESUME'; hasSentInitial: boolean; followupStillPending: boolean }
  | { type: 'CLOSE' }
  | { type: 'RETRY' };

const outreachMachine = createMachine({
  types: {} as {
    context: Record<string, never>;
    events: OutreachMachineEvent;
  },
  context: {},
  id: 'outreach',
  initial: 'draft',
  states: {
    draft: {
      on: {
        QUEUE_INITIAL: 'queued_send',
        CLOSE: 'closed',
      },
    },
    queued_send: {
      on: {
        SEND_SUCCEEDED: [
          {
            guard: ({ event }) => event.sendKind === 'initial',
            target: 'sent_waiting_reply',
          },
          {
            guard: ({ event }) => event.sendKind === 'followup',
            target: 'followup_sent',
          },
        ],
        SEND_FAILED: 'failed',
        PAUSE: 'paused',
        CLOSE: 'closed',
      },
    },
    sent_waiting_reply: {
      on: {
        FOLLOWUP_DUE: 'followup_due',
        REPLY_RECEIVED: 'reply_received',
        PAUSE: 'paused',
        CLOSE: 'closed',
      },
    },
    followup_due: {
      on: {
        REPLY_RECEIVED: 'reply_received',
        PAUSE: 'paused',
        CLOSE: 'closed',
        RETRY: 'queued_send',
      },
    },
    followup_sent: {
      on: {
        REPLY_RECEIVED: 'reply_received',
        PAUSE: 'paused',
        CLOSE: 'closed',
      },
    },
    reply_received: {
      on: {
        CLOSE: 'closed',
      },
    },
    paused: {
      on: {
        REPLY_RECEIVED: 'reply_received',
        RESUME: [
          {
            guard: ({ event }) => !event.hasSentInitial,
            target: 'queued_send',
          },
          {
            guard: ({ event }) => event.followupStillPending,
            target: 'sent_waiting_reply',
          },
          {
            target: 'followup_sent',
          },
        ],
        CLOSE: 'closed',
      },
    },
    failed: {
      on: {
        REPLY_RECEIVED: 'reply_received',
        RETRY: 'queued_send',
        CLOSE: 'closed',
      },
    },
    closed: {
      type: 'final',
    },
  },
});

export function applyOutreachTransition(
  currentState: OutreachWorkflowState,
  event: OutreachMachineEvent,
): OutreachWorkflowState {
  const snapshot = outreachMachine.resolveState({ value: currentState, context: {} });
  const next = getNextSnapshot(outreachMachine, snapshot, event);
  return next.value as OutreachWorkflowState;
}

export { outreachMachine };
