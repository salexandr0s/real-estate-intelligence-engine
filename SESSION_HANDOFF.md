# Security workflow patch, 23 October 2026

The isolated branch `fix/security-october-2026` starts at `48ba8a0982f2ae4be6dbfe66ec1faa2286282151`. The original ImmoRadar checkout is unchanged. This patch addresses the Trivy download chain in `.github/workflows/cd.yml`; application dependencies, containers, deployment and historical compromise remain open in the security audit ledger.

All six Trivy steps now pin action commit `ed142fd0673e97e23eac54620cfb913e5ce36c25` (v0.36.0) and explicitly select scanner v0.76.1. The prior action commit pinned its setup action but that setup checked out the Trivy installer from a floating default branch. The selected action uses a pinned setup revision and installer source; its release download verifies the published checksum. This is not independent release-signature authentication.

The three report steps still install the scanner; the three gate steps still reuse it with `skip-setup-trivy: true`. Cache settings, severity and unfixed filters, report/gate exit codes, conditions, artifact uploads and the final outcome gate are preserved. No ignore or suppression was added. Existing lower-severity and unfixed exclusions remain part of the policy, so a passing scan would not establish a finding-free image.

Validation: actionlint and exact source comparison passed. The source comparison permits only the six action-reference replacements and six version inputs. No image was built, pushed or scanned, and no deployment workflow was dispatched for this patch. The CD workflow runs on main pushes, so a draft PR does not execute these six steps. Application CI results must be assessed separately.

Historical workflow metadata and source receipts are retained under `/Users/nationalbank/security-audit-2026-10-23/batch-1-results/trivy-history/`. The current GitHub repository was created after the March 19 tag-poisoning window; that fact does not clear local use, later distribution channels, deleted runs or downloaded installer history. No credential change or whole-project security conclusion follows from this patch.
