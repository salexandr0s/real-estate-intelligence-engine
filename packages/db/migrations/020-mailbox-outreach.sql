-- Migration 020: mailbox and outreach workflow

CREATE TABLE IF NOT EXISTS mailbox_accounts (
  id                        BIGSERIAL PRIMARY KEY,
  user_id                   BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  provider_code             TEXT NOT NULL DEFAULT 'imap_smtp'
                              CHECK (provider_code IN ('imap_smtp')),
  mode                      TEXT NOT NULL DEFAULT 'shared_env'
                              CHECK (mode IN ('shared_env')),
  email                     CITEXT NOT NULL,
  display_name              TEXT,
  secret_ref                TEXT NOT NULL,
  is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
  sync_status               TEXT NOT NULL DEFAULT 'idle'
                              CHECK (sync_status IN ('idle', 'syncing', 'healthy', 'degraded', 'failed', 'disabled')),
  poll_interval_seconds     INTEGER NOT NULL DEFAULT 60 CHECK (poll_interval_seconds > 0),
  last_sync_started_at      TIMESTAMPTZ,
  last_sync_completed_at    TIMESTAMPTZ,
  last_successful_sync_at   TIMESTAMPTZ,
  last_seen_uid             BIGINT,
  last_seen_uidvalidity     BIGINT,
  last_error_code           TEXT,
  last_error_message        TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_mailbox_accounts_user_email UNIQUE (user_id, email)
);

CREATE INDEX IF NOT EXISTS idx_mailbox_accounts_user_active
  ON mailbox_accounts (user_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_mailbox_accounts_sync_status
  ON mailbox_accounts (sync_status, last_successful_sync_at DESC);

CREATE TRIGGER trg_mailbox_accounts_updated_at
BEFORE UPDATE ON mailbox_accounts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS outreach_threads (
  id                        BIGSERIAL PRIMARY KEY,
  user_id                   BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  listing_id                BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  mailbox_account_id        BIGINT NOT NULL REFERENCES mailbox_accounts(id) ON DELETE RESTRICT,
  contact_name              TEXT,
  contact_company           TEXT,
  contact_email             CITEXT NOT NULL,
  contact_phone             TEXT,
  workflow_state            TEXT NOT NULL
                              CHECK (workflow_state IN ('draft', 'queued_send', 'sent_waiting_reply', 'reply_received', 'followup_due', 'followup_sent', 'paused', 'closed', 'failed')),
  last_outbound_at          TIMESTAMPTZ,
  last_inbound_at           TIMESTAMPTZ,
  next_action_at            TIMESTAMPTZ,
  auto_followup_count       INTEGER NOT NULL DEFAULT 0 CHECK (auto_followup_count >= 0),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_threads_open_listing_contact
  ON outreach_threads (user_id, listing_id, contact_email)
  WHERE workflow_state <> 'closed';

CREATE INDEX IF NOT EXISTS idx_outreach_threads_user_updated
  ON outreach_threads (user_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_outreach_threads_user_listing_updated
  ON outreach_threads (user_id, listing_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_outreach_threads_due
  ON outreach_threads (workflow_state, next_action_at ASC, id ASC)
  WHERE workflow_state = 'sent_waiting_reply';

CREATE TRIGGER trg_outreach_threads_updated_at
BEFORE UPDATE ON outreach_threads
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS outreach_messages (
  id                        BIGSERIAL PRIMARY KEY,
  thread_id                 BIGINT REFERENCES outreach_threads(id) ON DELETE CASCADE,
  mailbox_account_id        BIGINT NOT NULL REFERENCES mailbox_accounts(id) ON DELETE RESTRICT,
  direction                 TEXT NOT NULL
                              CHECK (direction IN ('outbound', 'inbound')),
  message_kind              TEXT NOT NULL
                              CHECK (message_kind IN ('initial', 'followup', 'reply', 'system')),
  delivery_status           TEXT NOT NULL DEFAULT 'draft'
                              CHECK (delivery_status IN ('draft', 'queued', 'sent', 'received', 'failed', 'suppressed')),
  provider_message_id       TEXT,
  imap_uid                  BIGINT,
  imap_uidvalidity          BIGINT,
  in_reply_to               TEXT,
  references_header         TEXT,
  subject                   TEXT NOT NULL,
  body_text                 TEXT,
  body_html                 TEXT,
  from_email                CITEXT,
  to_email                  CITEXT,
  cc_json                   JSONB NOT NULL DEFAULT '[]'::jsonb,
  bcc_json                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  match_strategy            TEXT NOT NULL DEFAULT 'manual'
                              CHECK (match_strategy IN ('manual', 'headers', 'from_subject', 'unmatched')),
  storage_key               TEXT,
  checksum                  TEXT,
  error_message             TEXT,
  occurred_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_messages_provider
  ON outreach_messages (mailbox_account_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outreach_messages_thread_occurred
  ON outreach_messages (thread_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_outreach_messages_mailbox_uid
  ON outreach_messages (mailbox_account_id, imap_uid DESC)
  WHERE imap_uid IS NOT NULL;

CREATE TRIGGER trg_outreach_messages_updated_at
BEFORE UPDATE ON outreach_messages
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS outreach_events (
  id                        BIGSERIAL PRIMARY KEY,
  thread_id                 BIGINT NOT NULL REFERENCES outreach_threads(id) ON DELETE CASCADE,
  message_id                BIGINT REFERENCES outreach_messages(id) ON DELETE SET NULL,
  event_type                TEXT NOT NULL,
  from_state                TEXT,
  to_state                  TEXT,
  payload                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_outreach_events_from_state
    CHECK (from_state IS NULL OR from_state IN ('draft', 'queued_send', 'sent_waiting_reply', 'reply_received', 'followup_due', 'followup_sent', 'paused', 'closed', 'failed')),
  CONSTRAINT chk_outreach_events_to_state
    CHECK (to_state IS NULL OR to_state IN ('draft', 'queued_send', 'sent_waiting_reply', 'reply_received', 'followup_due', 'followup_sent', 'paused', 'closed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_outreach_events_thread_occurred
  ON outreach_events (thread_id, occurred_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS outreach_message_documents (
  message_id                BIGINT NOT NULL REFERENCES outreach_messages(id) ON DELETE CASCADE,
  document_id               BIGINT NOT NULL REFERENCES listing_documents(id) ON DELETE CASCADE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_outreach_message_documents_document
  ON outreach_message_documents (document_id);
