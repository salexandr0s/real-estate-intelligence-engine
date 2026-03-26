# API research tooling

These tools are for source onboarding and reverse engineering only. They are **not** production runtime dependencies.

## HAR/OpenAPI discovery

1. Capture normal browser traffic for a source.
2. Export a HAR file.
3. Run:

```bash
scripts/api-research/har-to-openapi.sh path/to/capture.har source-api
```

This generates an OpenAPI-shaped draft that can guide source adapter work.

## Patchright canaries

Patchright is opt-in.

```bash
SCRAPER_BROWSER_RUNTIME=playwright
SCRAPER_PATCHRIGHT_SOURCES=willhaben,immoscout24
```

Only listed sources use Patchright. All others stay on standard Playwright.
