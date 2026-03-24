# Rename macOS App: RealEstateIntel → ImmoRadar

## Context

The macOS SwiftUI client is currently named "RealEstateIntel" everywhere — directories, Xcode project, bundle identifier, display name, keychain service, cache paths, User-Agent strings, and documentation. The user wants to rebrand the app to **ImmoRadar**. The backend/infrastructure names (`real_estate_intel` database, S3 bucket, monorepo package name) are **out of scope** — those refer to the platform, not the app.

**Total scope:** ~50 references across 16 files + 2 directory renames. The app now has 187 Swift files (all covered implicitly by the directory rename). XcodeGen (v2.45.2, installed) will regenerate the `.pbxproj` from the updated `project.yml`.

---

## Naming Convention

| Context | Old | New |
|---|---|---|
| Directory / target name | `RealEstateIntel` | `ImmoRadar` |
| Bundle identifier | `com.realestateIntel.app` | `com.immoradar.app` |
| Display name (menu bar, Dock) | `Real Estate Intel` | `ImmoRadar` |
| Keychain service | `com.realestateIntel.api` | `com.immoradar.api` |
| Logger subsystem | `com.rei.app` | `com.immoradar.app` |
| Cache directory (App Support) | `RealEstateIntel/Cache` | `ImmoRadar/Cache` |
| User-Agent strings | `RealEstateIntel/0.1` | `ImmoRadar/0.1` |

---

## Execution Steps

### Step 1 — Rename directories (git mv)

```bash
cd apps/macos
git mv RealEstateIntel ImmoRadar
git mv RealEstateIntel.xcodeproj ImmoRadar.xcodeproj
```

This renames both the source folder and the Xcode project folder, preserving git history.

### Step 2 — Rename files inside the new directories

```bash
git mv ImmoRadar/App/RealEstateIntelApp.swift ImmoRadar/App/ImmoRadarApp.swift
git mv ImmoRadar/RealEstateIntel.entitlements ImmoRadar/ImmoRadar.entitlements
```

### Step 3 — Update `project.yml` (source of truth)

**File:** `apps/macos/project.yml`

| Line | Old | New |
|------|-----|-----|
| 1 | `name: RealEstateIntel` | `name: ImmoRadar` |
| 3 | `bundleIdPrefix: com.realestateIntel` | `bundleIdPrefix: com.immoradar` |
| 12 | `PRODUCT_BUNDLE_IDENTIFIER: com.realestateIntel.app` | `PRODUCT_BUNDLE_IDENTIFIER: com.immoradar.app` |
| 20 | `RealEstateIntel:` (target) | `ImmoRadar:` |
| 24 | `- path: RealEstateIntel` | `- path: ImmoRadar` |
| 31 | `INFOPLIST_KEY_CFBundleDisplayName: "Real Estate Intel"` | `INFOPLIST_KEY_CFBundleDisplayName: "ImmoRadar"` |
| 33 | `PRODUCT_NAME: "Real Estate Intel"` | `PRODUCT_NAME: "ImmoRadar"` |
| 37 | `path: RealEstateIntel/RealEstateIntel.entitlements` | `path: ImmoRadar/ImmoRadar.entitlements` |

### Step 4 — Regenerate `.pbxproj` from project.yml

```bash
cd apps/macos && xcodegen generate
```

This replaces the entire `.pbxproj` with correct references, eliminating the need to manually edit ~22 references in that file.

### Step 5 — Update Swift source files

| File (new path) | Change |
|---|---|
| `ImmoRadar/App/ImmoRadarApp.swift:4` | `struct RealEstateIntelApp: App` → `struct ImmoRadarApp: App` |
| `ImmoRadar/App/MenuBarContent.swift:41` | `"Quit Real Estate Intel"` → `"Quit ImmoRadar"` |
| `ImmoRadar/App/Logging.swift:4-7` | `"com.rei.app"` → `"com.immoradar.app"` (4 occurrences, use replace_all) |
| `ImmoRadar/Networking/KeychainHelper.swift:7` | `"com.realestateIntel.api"` → `"com.immoradar.api"` |
| `ImmoRadar/Services/CacheManager.swift:18` | `"RealEstateIntel"` → `"ImmoRadar"` |
| `ImmoRadar/DesignSystem/Theme.swift:3` | Comment: `Real Estate Intel app` → `ImmoRadar app` |
| `ImmoRadar/Networking/APIClient.swift:4` | Comment: `Real Estate Intel backend` → `ImmoRadar backend` |

### Step 6 — Update scripts and packages (outside macOS app)

| File | Line(s) | Change |
|---|---|---|
| `scripts/fetch-vienna-pois.ts:10` | Comment path → `ImmoRadar/Resources/...` |
| `scripts/fetch-vienna-pois.ts:92` | `'RealEstateIntel'` → `'ImmoRadar'` (path segment) |
| `scripts/fetch-vienna-pois.ts:102` | `'RealEstateIntel/0.1 (poi-fetch)'` → `'ImmoRadar/0.1 (poi-fetch)'` |
| `scripts/compute-vienna-boundary.py:5-6` | Docstring paths → `ImmoRadar/Resources/...` |
| `scripts/compute-vienna-boundary.py:21,25` | `"RealEstateIntel"` → `"ImmoRadar"` (2 path segments) |
| `packages/geocoding/src/nominatim-client.ts:10` | `'RealEstateIntel/0.1 (geocoding)'` → `'ImmoRadar/0.1 (geocoding)'` |
| `.github/workflows/ci.yml:110` | `-project apps/macos/RealEstateIntel.xcodeproj` → `-project apps/macos/ImmoRadar.xcodeproj` |
| `.github/workflows/ci.yml:111` | `-scheme RealEstateIntel` → `-scheme ImmoRadar` |

### Step 7 — Update documentation

| File | Change |
|---|---|
| `docs/folder_structure.md:42` | `RealEstateIntel.xcodeproj` → `ImmoRadar.xcodeproj` |
| `docs/folder_structure.md:43` | `RealEstateIntel/` → `ImmoRadar/` |
| `docs/internal/vienna_rei_agent_pack/06_AGENT_PROMPT.md:439-443` | `apps/macos/RealEstateIntel/...` → `apps/macos/ImmoRadar/...` (5 path references) |

### Step 8 — Clean compiled output

```bash
rm -rf packages/geocoding/dist/
```

The `nominatim-client.js` in `dist/` has the old User-Agent baked in. It will be regenerated on next `npm run build`.

---

## Out of Scope

These use `real_estate_intel` / `real-estate-intel` to name the **platform**, not the app — no change needed:

- `package.json` → `"name": "real-estate-intelligence-engine"` (monorepo)
- `.github/workflows/ci.yml` → `POSTGRES_DB: real_estate_intel` (CI database name — the Xcode build lines in this file **are** in scope, see Step 6)
- `infrastructure/` → Docker Compose, S3 bucket, env files
- `example.env` → DATABASE_URL, S3_BUCKET
- `.gitignore` / `.dockerignore` → `real-estate-intel` directory exclusion

---

## Breaking Changes to Note

1. **Keychain:** Changing `com.realestateIntel.api` → `com.immoradar.api` means any previously stored API key won't be found. The app will prompt to re-enter it. This is acceptable for a dev/pre-release app.
2. **Cache directory:** Changing from `~/Library/Application Support/RealEstateIntel/` to `~/Library/Application Support/ImmoRadar/`. Old cached data will be orphaned. No user impact (cache rebuilds on next fetch).

---

## Verification

1. `xcodegen generate` succeeds without errors
2. `xcodebuild -project apps/macos/ImmoRadar.xcodeproj -scheme ImmoRadar build` compiles
3. Grep confirms no remaining references: `rg "RealEstateIntel" apps/macos/` and `rg "realestateIntel" .` return nothing (except `.git/` history)
4. Grep for "Real Estate Intel" (display name) in Swift files returns nothing
5. Grep for old logger subsystem: `rg "com\.rei\.app" apps/macos/` returns nothing
6. Grep for CI references: `rg "RealEstateIntel" .github/` returns nothing
7. The app launches and shows "ImmoRadar" in the menu bar and Dock
