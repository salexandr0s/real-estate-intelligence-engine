# Storage Access Policy

## MinIO / S3-Compatible Object Storage

### Access Control

- All buckets are **private by default** — no public access is enabled.
- Access is restricted to **service accounts** authenticated via S3 access key and secret key.
- No anonymous access or presigned URLs are used for artifact retrieval.

### Artifact Access Pattern

- Artifacts (HTML snapshots, screenshots, HAR files) are stored with a **storage key** referenced in the database (`body_storage_key`, `screenshot_storage_key`, `har_storage_key` columns).
- All artifact retrieval is performed **server-side** by backend services (API, workers).
- Artifacts are **never exposed directly** to the macOS app or any external client.
- The API may return metadata about artifacts (e.g., storage key, size) but never the artifact content itself to app users.

### Artifact Categories

| Artifact Type | Bucket Prefix     | Purpose                        | Access Level       |
| ------------- | ----------------- | ------------------------------ | ------------------ |
| HTML snapshots | `raw-html/`      | Raw page HTML for debugging    | Internal only      |
| Screenshots   | `screenshots/`    | Visual captures on parse failure | Internal only    |
| HAR files     | `har/`            | Network request traces         | Internal only      |

### Security Rules

1. Screenshots and HTML snapshots are **internal debugging tools** — they must never be exposed to app users.
2. Service account credentials are stored in environment variables (`S3_ACCESS_KEY`, `S3_SECRET_KEY`) and loaded via `@immoradar/config`.
3. Credentials must never appear in logs — the observability package redacts secret-like keys automatically.
4. Bucket lifecycle policies handle automatic cleanup of old artifacts (see `infrastructure/storage/lifecycle-policy.json`).
