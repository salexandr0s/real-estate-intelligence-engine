import { describe, expect, it } from 'vitest';
import { applyOutreachTransition } from './machine.js';

describe('applyOutreachTransition', () => {
  it('queues the initial send from draft', () => {
    expect(applyOutreachTransition('draft', { type: 'QUEUE_INITIAL' })).toBe('queued_send');
  });

  it('moves queued initial sends into sent_waiting_reply on success', () => {
    expect(
      applyOutreachTransition('queued_send', { type: 'SEND_SUCCEEDED', sendKind: 'initial' }),
    ).toBe('sent_waiting_reply');
  });

  it('moves queued follow-ups into followup_sent on success', () => {
    expect(
      applyOutreachTransition('queued_send', { type: 'SEND_SUCCEEDED', sendKind: 'followup' }),
    ).toBe('followup_sent');
  });

  it('marks queued sends as failed when delivery fails', () => {
    expect(applyOutreachTransition('queued_send', { type: 'SEND_FAILED' })).toBe('failed');
  });

  it('marks sent threads as followup_due when the reminder window is reached', () => {
    expect(applyOutreachTransition('sent_waiting_reply', { type: 'FOLLOWUP_DUE' })).toBe(
      'followup_due',
    );
  });

  it('requeues due follow-ups on retry', () => {
    expect(applyOutreachTransition('followup_due', { type: 'RETRY' })).toBe('queued_send');
  });

  it('requeues failed sends on retry', () => {
    expect(applyOutreachTransition('failed', { type: 'RETRY' })).toBe('queued_send');
  });

  it('pauses active states', () => {
    expect(applyOutreachTransition('queued_send', { type: 'PAUSE' })).toBe('paused');
    expect(applyOutreachTransition('sent_waiting_reply', { type: 'PAUSE' })).toBe('paused');
    expect(applyOutreachTransition('followup_due', { type: 'PAUSE' })).toBe('paused');
    expect(applyOutreachTransition('followup_sent', { type: 'PAUSE' })).toBe('paused');
  });

  it('resumes paused threads back to the initial queue when nothing has been sent yet', () => {
    expect(
      applyOutreachTransition('paused', {
        type: 'RESUME',
        hasSentInitial: false,
        followupStillPending: false,
      }),
    ).toBe('queued_send');
  });

  it('resumes paused threads to sent_waiting_reply when follow-up is still pending', () => {
    expect(
      applyOutreachTransition('paused', {
        type: 'RESUME',
        hasSentInitial: true,
        followupStillPending: true,
      }),
    ).toBe('sent_waiting_reply');
  });

  it('resumes paused threads to followup_sent once the follow-up already went out', () => {
    expect(
      applyOutreachTransition('paused', {
        type: 'RESUME',
        hasSentInitial: true,
        followupStillPending: false,
      }),
    ).toBe('followup_sent');
  });

  it('moves to reply_received from any open thread state when a reply lands', () => {
    expect(applyOutreachTransition('queued_send', { type: 'REPLY_RECEIVED' })).toBe(
      'reply_received',
    );
    expect(applyOutreachTransition('sent_waiting_reply', { type: 'REPLY_RECEIVED' })).toBe(
      'reply_received',
    );
    expect(applyOutreachTransition('followup_due', { type: 'REPLY_RECEIVED' })).toBe(
      'reply_received',
    );
    expect(applyOutreachTransition('followup_sent', { type: 'REPLY_RECEIVED' })).toBe(
      'reply_received',
    );
    expect(applyOutreachTransition('paused', { type: 'REPLY_RECEIVED' })).toBe('reply_received');
    expect(applyOutreachTransition('failed', { type: 'REPLY_RECEIVED' })).toBe('reply_received');
  });

  it('closes threads from draft and post-send states', () => {
    expect(applyOutreachTransition('draft', { type: 'CLOSE' })).toBe('closed');
    expect(applyOutreachTransition('reply_received', { type: 'CLOSE' })).toBe('closed');
    expect(applyOutreachTransition('paused', { type: 'CLOSE' })).toBe('closed');
  });
});
