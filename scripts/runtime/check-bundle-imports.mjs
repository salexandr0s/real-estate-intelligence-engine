// Fails when compiled code in the runtime bundle imports a package the bundle doesn't contain.
// build-runtime-bundle.sh runs it after leaving out the packages only devDependencies need, so a
// runtime import that is declared only as a devDependency fails the build instead of the app.
//
//   node scripts/runtime/check-bundle-imports.mjs <bundle folder>

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const builtins = new Set(builtinModules);
// Static imports and re-exports, side-effect imports, import() and require(). The static forms
// must start a line, so text in comments and strings doesn't count.
const importPatterns = [
  /^\s*(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"'\s]+)["']/gm,
  /^\s*import\s*["']([^"'\s]+)["']/gm,
  /\bimport\s*\(\s*["']([^"'\s]+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"'\s]+)["']\s*\)/g,
];

function* scriptsIn(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') yield* scriptsIn(full);
    } else if (/\.[cm]?js$/.test(entry.name)) {
      yield full;
    }
  }
}

function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function isBareImport(specifier) {
  return !/^[./#]/.test(specifier) && !specifier.startsWith('node:');
}

// Node looks in node_modules next to the importing file, then in each folder above it.
function isInstalled(name, fromDir) {
  for (
    let dir = fromDir;
    dir === root || dir.startsWith(root + path.sep);
    dir = path.dirname(dir)
  ) {
    if (existsSync(path.join(dir, 'node_modules', name))) return true;
  }
  return false;
}

const distFolders = ['apps', 'packages'].flatMap((group) =>
  readdirSync(path.join(root, group))
    .map((name) => path.join(root, group, name, 'dist'))
    .filter((dir) => existsSync(dir)),
);

const missing = new Set();
for (const folder of distFolders) {
  for (const file of scriptsIn(folder)) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of importPatterns) {
      for (const [, specifier] of source.matchAll(pattern)) {
        if (!isBareImport(specifier)) continue;
        const name = packageName(specifier);
        // Only the exact name is a built-in: `punycode/` and `string_decoder/` load the npm packages.
        if (builtins.has(specifier)) continue;
        if (!isInstalled(name, path.dirname(file))) {
          missing.add(`${path.relative(root, file)} imports ${name}`);
        }
      }
    }
  }
}

if (missing.size > 0) {
  console.error(`The bundle lacks packages its code imports:\n${[...missing].join('\n')}`);
  process.exit(1);
}
console.log(
  `[runtime-bundle] every package that ${distFolders.length} dist folders import is in the bundle`,
);
