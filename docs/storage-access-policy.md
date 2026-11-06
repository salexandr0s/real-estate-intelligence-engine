# Storage Access Policy

## Local Artifact Folder

### Location

- Artifacts are files in the folder named by `ARTIFACTS_DIR`, which must be an absolute path.
- Without it, the folder is `artifacts` under `IMMORADAR_RUNTIME_HOME`, or `~/Library/Application Support/ImmoRadar/runtime/artifacts` for commands run from a checkout.

### Artifact Access Pattern

- Artifacts (HTML snapshots, screenshots, HAR files) are stored with a **storage key** referenced in the database (`body_storage_key`, `screenshot_storage_key`, `har_storage_key` columns).
- All artifact retrieval is performed **server-side** by backend services (API, workers).
- Artifacts are **never exposed directly** to the macOS app or any external client.
- The API may return metadata about artifacts (e.g., storage key, size) but never the artifact content itself to app users.

### Artifact Categories

| Artifact Type | Folder            | Purpose                        | Access Level       |
| ------------- | ----------------- | ------------------------------ | ------------------ |
| HTML snapshots | `raw-html/`      | Raw page HTML for debugging    | Internal only      |
| Screenshots   | `screenshots/`    | Visual captures on parse failure | Internal only    |
| HAR files     | `har/`            | Network request traces         | Internal only      |

### Security Rules

1. Screenshots and HTML snapshots are **internal debugging tools** — they must never be exposed to app users.
2. Credentials must never appear in logs — the observability package redacts secret-like keys automatically.
