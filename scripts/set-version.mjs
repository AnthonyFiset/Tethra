#!/usr/bin/env node
// Stamp one version across every manifest so a release tag and the shipped
// binaries can never disagree.
//
//   node scripts/set-version.mjs 0.1.2
//   node scripts/set-version.mjs v0.1.2   (leading "v" is stripped)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const raw = process.argv[2];
if (!raw) {
  console.error("usage: set-version.mjs <version>");
  process.exit(1);
}

const version = raw.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`not a semver version: ${version}`);
  process.exit(1);
}

function edit(relPath, transform) {
  const path = join(root, relPath);
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (before === after) {
    console.error(`no version field replaced in ${relPath}`);
    process.exit(1);
  }
  writeFileSync(path, after);
  console.log(`${relPath} -> ${version}`);
}

// Only the first "version" key, which is the package's own.
const firstJsonVersion = (text) =>
  text.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`);

edit("apps/tauri/src-tauri/tauri.conf.json", firstJsonVersion);
edit("apps/ui/package.json", firstJsonVersion);
edit("apps/ui/package-lock.json", (text) =>
  text
    .replace(/"version":\s*"[^"]*"/, `"version": "${version}"`)
    .replace(
      /("packages":\s*\{\s*"":\s*\{[^}]*?"version":\s*)"[^"]*"/,
      `$1"${version}"`,
    ),
);

// Workspace [workspace.package] version, which every crate inherits.
edit("Cargo.toml", (text) =>
  text.replace(
    /(\[workspace\.package\][\s\S]*?\nversion\s*=\s*)"[^"]*"/,
    `$1"${version}"`,
  ),
);
