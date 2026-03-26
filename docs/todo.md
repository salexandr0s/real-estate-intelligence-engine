# TODO: Document Upload & Offer Rating

## What exists

- `packages/documents/` — PDF text extraction, regex fact parser (German/Austrian), Claude AI fallback for scanned docs
- DB schema (`017-documents.sql`) — `listing_documents`, `document_extractions`, `document_fact_spans`
- API routes — `GET /v1/listings/:id/documents`, `GET /v1/documents/:id/facts`
- BullMQ document worker — downloads, hashes, extracts text, parses facts, persists
- Willhaben detail scraper extracts PDF attachment URLs and enqueues them for processing

## What's missing

### Scraper coverage

- [ ] RE/MAX detail scraper doesn't extract document/attachment URLs
- [ ] Check other sources (wohnnet, etc.) for document extraction support
- [ ] Verify Willhaben document extraction is actually working in production (test with a listing that has PDFs)

### User document upload

- [ ] API endpoint for user-uploaded documents (POST with multipart/file upload)
- [ ] Storage backend for uploaded files (S3/MinIO or local)
- [ ] Feed uploaded documents into the existing document processing pipeline
- [ ] Associate uploaded documents with a listing or as standalone (user has an offer PDF but no matching listing)

### Offer rating / assessment

- [ ] Scoring logic that evaluates extracted facts against market baselines (price/m², location comps, energy efficiency)
- [ ] "Is this a good deal?" summary — combining extracted facts with comparable listings in the DB
- [ ] Confidence indicator — how much data was extracted vs. how much is missing
- [ ] Flag red flags (unusually high operating costs, missing energy cert, etc.)

### Standalone Offer Analyser (macOS app — dedicated page)

A full-page view where the user uploads documents for a property offer they received (exposé, floor plan, energy cert, purchase contract, etc.) and gets a comprehensive analysis — independent of whether the property exists in our scraped listings.

- [ ] Dedicated "Offer Analyser" page in sidebar navigation
- [ ] Multi-document upload — drag-and-drop zone or file picker, support for multiple PDFs/images
- [ ] Extraction progress — show processing status per document as facts are being extracted
- [ ] Extracted facts summary — structured display of all parsed data (price, area, rooms, energy, operating costs, etc.) with confidence levels and source snippets
- [ ] Property rating — overall score based on extracted facts vs. market data
- [ ] Comparable properties — show similar listings from our DB (by location, size, type) with price comparisons
- [ ] Price assessment — is the asking price above/below/at market? price per m² vs. area average
- [ ] Red flags — highlight missing info, unusually high costs, poor energy rating, etc.
- [ ] Market context — district/neighborhood stats, price trends if available
- [ ] Export/save — save the analysis for later reference, attach notes

### Listing detail document integration

- [ ] Show attached documents and extracted facts on existing listing detail view
- [ ] Allow uploading additional documents to a listing

## Mailbox / Outreach

Migration note:
- [x] Contact fields already shipped in `packages/db/migrations/019-listing-contacts.sql`
- [x] Mailbox/outreach schema added in `packages/db/migrations/020-mailbox-outreach.sql`
- [ ] Apply `020-mailbox-outreach.sql` to the target database before enabling outreach workers/routes in production

### Backend

- [x] Add `mailbox_accounts`, `outreach_threads`, `outreach_messages`, `outreach_events`, and `outreach_message_documents`
- [x] Add indexes for open-thread dedupe, inbox reads, due follow-ups, and inbound message dedupe
- [x] Add env-backed shared mailbox config for IMAP + SMTP
- [x] Add `packages/outreach` with XState machine and typed transition helpers
- [x] Add `MAILBOX_SYNC` BullMQ worker using IMAPFlow + mailparser
- [x] Preserve raw inbound `.eml` artifacts in object storage/local bucket path
- [x] Match replies by `In-Reply-To` / `References`, with exact sender + normalized-subject fallback
- [x] Feed inbound PDF attachments into the existing `listing_documents` + `DOCUMENT_PROCESSING` pipeline
- [x] Add `OUTREACH_SEND` worker for initial send + one automatic follow-up after 72 hours
- [x] Add DB query modules for mailbox accounts, threads, messages, and events

### API

- [x] Extend `GET /v1/listings/:id` with `outreachSummary`
- [x] Add `GET /v1/mailboxes` and `POST /v1/mailboxes/:id/sync`
- [x] Add `GET /v1/outreach/threads` and `GET /v1/outreach/threads/:id`
- [x] Add `POST /v1/listings/:id/outreach/start`
- [x] Add `PATCH /v1/outreach/threads/:id`
- [x] Add `POST /v1/outreach/threads/:id/follow-up`

### macOS

- [x] Add Outreach sidebar page
- [x] Add listing-detail Outreach panel with start flow, thread state, reply timeline, and follow-up controls
- [x] Add inbox view for open threads, unread replies, and due follow-ups
- [ ] Add dedicated view-model coverage for outreach inbox/thread flows

### Verification

- [ ] Migration smoke test for `020-mailbox-outreach.sql`
- [ ] Query idempotency tests for open-thread dedupe and inbound message dedupe
- [ ] IMAP fixture tests for reply matching, reconnect, cursor resume, and unmatched mail preservation
- [ ] XState transition tests for send, reply stop, pause/resume, close, retry, and delayed follow-up behavior
- [ ] API auth/validation tests for all new routes
- [ ] macOS API decoding and view-model tests for outreach inbox and thread detail
