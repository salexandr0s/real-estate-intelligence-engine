# Runtime token Keychain migration

The macOS secret-storage layer owns this change. The local API token remains in Keychain and its value is preserved. There are no database, API-contract, normalization, score, or index changes.

## Repeated prompt diagnosis

An early ad-hoc ImmoRadar build created the `com.immoradar.local-runtime` / `localRuntimeApiToken` item in the file-based login Keychain. On the affected Mac, its partition list contained a single obsolete `cdhash:` entry. The trusted-application ACL already named `/Applications/ImmoRadar.app`, but neither architecture of the installed Developer ID build matched the old partition. Repeated Always Allow approvals did not repair that partition.

The released app is signed with a stable Developer ID requirement. A disposable item created by a signed test program on the same Mac received a `teamid:` partition and was readable without interaction. This is the supported default item-creation behavior used by the fix. Apple describes file-based access control in [Access Control Lists](https://developer.apple.com/documentation/security/access-control-lists) and the two Keychain implementations in [TN3137](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains).

## Migration and rollback

`LocalRuntimeAuth` now uses `com.immoradar.local-runtime.v2`. `MigratingSecretStore` first reads that current item. Only a confirmed missing item allows a legacy lookup. During an interactive engine start, a non-empty legacy token is copied to the new item, then read back with interaction disabled before the engine accepts it. The signed installed app creates the item, so its normal app-scoped access and stable team partition apply.

The first migration may require one final macOS password approval to read the legacy item. Subsequent launches use the new item directly; engine restarts also retain the launch token in memory. A quiet read performs no migration writes. A failed current read cannot select an older rollback token, and a failed legacy read or migration write cannot generate a replacement token. Failures surface through the existing Keychain/startup error reporting, without recording credentials.

The legacy item remains available to an older build on rollback. An explicit Reset Local Engine clears both service items, preventing the old token from being imported again after a reset. A locked login Keychain can still require normal system authentication.

Debug builds use `com.immoradar.local-runtime.debug` without importing a Release token. Their ad-hoc signatures cannot create or update the Release migration target. The normal release script requires a Developer ID signature before installation.

## Validation

Unit tests cover a single successful copy across store instances, current-token precedence, quiet reads, denied current/legacy reads, write/readback failures, fresh installation, and explicit reset of both items. Existing secret-preservation and API/cache tests continue to run in the Swift suite.

For installed-app verification, use a Developer ID Release build with no token environment override. Verify that the new item has a team partition using metadata-only inspection; do not print secret data. Exercise at least three separate launches and the in-app Restart Engine action, confirm the local API and workers recover, and verify all owned processes stop when the app quits. Preserve the monitoring setting through the test.
