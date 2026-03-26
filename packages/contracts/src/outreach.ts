export type MailboxProviderCode = 'imap_smtp';
export type MailboxMode = 'shared_env';
export type MailboxSyncStatus = 'idle' | 'syncing' | 'healthy' | 'degraded' | 'failed' | 'disabled';

export type OutreachWorkflowState =
  | 'draft'
  | 'queued_send'
  | 'sent_waiting_reply'
  | 'reply_received'
  | 'followup_due'
  | 'followup_sent'
  | 'paused'
  | 'closed'
  | 'failed';

export type OutreachMessageDirection = 'outbound' | 'inbound';
export type OutreachMessageKind = 'initial' | 'followup' | 'reply' | 'system';
export type OutreachDeliveryStatus =
  | 'draft'
  | 'queued'
  | 'sent'
  | 'received'
  | 'failed'
  | 'suppressed';
export type OutreachMatchStrategy = 'manual' | 'headers' | 'from_subject' | 'unmatched';
export type OutreachThreadScope = 'open' | 'closed' | 'all';
export type OutreachThreadAction = 'pause' | 'resume' | 'close' | 'retry';

export interface MailboxAccountRow {
  id: number;
  userId: number;
  providerCode: MailboxProviderCode;
  mode: MailboxMode;
  email: string;
  displayName: string | null;
  secretRef: string;
  isActive: boolean;
  syncStatus: MailboxSyncStatus;
  pollIntervalSeconds: number;
  lastSyncStartedAt: Date | null;
  lastSyncCompletedAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  lastSeenUid: number | null;
  lastSeenUidvalidity: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OutreachThreadRow {
  id: number;
  userId: number;
  listingId: number;
  mailboxAccountId: number;
  contactName: string | null;
  contactCompany: string | null;
  contactEmail: string;
  contactPhone: string | null;
  workflowState: OutreachWorkflowState;
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
  nextActionAt: Date | null;
  autoFollowupCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OutreachMessageRow {
  id: number;
  threadId: number | null;
  mailboxAccountId: number;
  direction: OutreachMessageDirection;
  messageKind: OutreachMessageKind;
  deliveryStatus: OutreachDeliveryStatus;
  providerMessageId: string | null;
  imapUid: number | null;
  imapUidvalidity: number | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  fromEmail: string | null;
  toEmail: string | null;
  cc: string[];
  bcc: string[];
  matchStrategy: OutreachMatchStrategy;
  storageKey: string | null;
  checksum: string | null;
  errorMessage: string | null;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface OutreachEventRow {
  id: number;
  threadId: number;
  messageId: number | null;
  eventType: string;
  fromState: OutreachWorkflowState | null;
  toState: OutreachWorkflowState | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export interface MailboxAccountSummary {
  id: number;
  email: string;
  displayName: string | null;
  syncStatus: MailboxSyncStatus;
  pollIntervalSeconds: number;
  lastSuccessfulSyncAt: string | null;
  lastErrorMessage: string | null;
}

export interface OutreachAttachmentSummary {
  documentId: number;
  label: string | null;
  status: string;
}

export interface OutreachMessage {
  id: number;
  direction: OutreachMessageDirection;
  messageKind: OutreachMessageKind;
  deliveryStatus: OutreachDeliveryStatus;
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  fromEmail: string | null;
  toEmail: string | null;
  matchStrategy: OutreachMatchStrategy;
  occurredAt: string;
  errorMessage: string | null;
  attachments: OutreachAttachmentSummary[];
}

export interface OutreachEvent {
  id: number;
  eventType: string;
  fromState: OutreachWorkflowState | null;
  toState: OutreachWorkflowState | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface OutreachSummary {
  threadId: number;
  workflowState: OutreachWorkflowState;
  unreadInboundCount: number;
  nextActionAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
}

export interface OutreachThreadSummary {
  id: number;
  listingId: number;
  mailboxAccountId: number;
  contactName: string | null;
  contactCompany: string | null;
  contactEmail: string;
  contactPhone: string | null;
  workflowState: OutreachWorkflowState;
  unreadInboundCount: number;
  nextActionAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  updatedAt: string;
}

export interface OutreachThreadDetail extends OutreachThreadSummary {
  messages: OutreachMessage[];
  events: OutreachEvent[];
}

export interface StartOutreachInput {
  contactEmail?: string;
  contactName?: string | null;
  contactCompany?: string | null;
  contactPhone?: string | null;
  subject: string;
  bodyText: string;
}

export interface ThreadActionInput {
  action: OutreachThreadAction;
}

export interface ManualFollowupInput {
  bodyText?: string;
  subject?: string;
}
