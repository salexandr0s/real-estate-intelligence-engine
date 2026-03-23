# Vienna Real Estate Intelligence Engine — Agent Pack

This pack converts the audit into implementation-grade markdown documents for a coding agent.

## Intended use

Feed these files to the agent in this order:

1. `01_REPO_TRUTH_AND_PRODUCT_DIRECTION.md`
2. `02_BUILDPLAN.md`
3. `03_FEATURE_SPECS.md`
4. `04_DATA_SOURCES.md`
5. `05_CHECKLIST.md`
6. `06_AGENT_PROMPT.md`

## Product stance

- Vienna-only.
- Extend the existing architecture.
- No parallel system unless explicitly justified.
- No protected-trait or proxy-demographic features.
- No fake precision.
- Market-rent and legal-rent must remain separate.
- Prefer official/public Vienna and Austria sources first.

## What the agent should do

The agent should:

- inspect the repo again before making changes,
- verify the current code state against these docs,
- correct any drift it finds,
- implement in phases,
- keep changes incremental and testable,
- avoid over-expanding scope into Austria-wide or multi-country abstractions.

## Deliverables expected from the agent

At minimum:

- updated schema and migrations,
- worker changes,
- API route changes,
- macOS UI additions,
- tests,
- data-quality and observability additions,
- updated internal docs where needed.

## Recommended implementation order

1. Search/filter/alert truth unification
2. Parser resilience and source health
3. Geocode and baseline provenance
4. Vienna context parity and neutral wording cleanup
5. Listing Analysis page v1
6. Building facts enrichment
7. Legal-rent assessment v1
8. Document ingestion and viewer v1

## Non-goals for this phase

- Austria-wide rollout
- conversational copilot polish
- property scoring based on ethnicity/nationality/religion/name-origin or similar proxies
- fake neighborhood safety score built on weak or coarse crime data
- heavy new infra without repo-specific need
