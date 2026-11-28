// WHY this file exists:
//   tools/package-mac.sh used to run the packager from its command line, which takes no hooks. Bow needs one: right
//   after the packager unpacks Electron, its executables get build UUIDs of their own (tools/build-uuids.mjs: macOS's
//   Local Network privacy tracks programs by that UUID). These are the same options the command line had.
//
// Data source:
//   Command-line flags from tools/package-mac.sh; BOW_SIGN_IDENTITY (set by tools/release-mac.sh) for a signed build;
//   package.json for the version.
//
// Data flow:
//   package-mac.sh → this → @electron/packager: unpack Electron → afterExtract: makeBuildUuidsOwn → copy the app,
//   rename, sign (when an identity is given) → release/Bow-darwin-<arch>/Bow.app
//
// usage: node tools/package-mac.mjs --arch=arm64 --extend-info=<plist> --tmpdir=<folder> [--electron-zip-dir=<folder>]
import { packager } from "@electron/packager";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { makeBuildUuidsOwn } from "./build-uuids.mjs";

const BUNDLE_ID = "io.github.rektoooooo.sidebar-browser";
const appDir = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));

const { values: flags } = parseArgs({
  options: {
    arch: { type: "string" },
    "extend-info": { type: "string" },
    tmpdir: { type: "string" },
    "electron-zip-dir": { type: "string" },
  },
});

/** A Developer ID release (BOW_SIGN_IDENTITY set by tools/release-mac.sh) or an ad-hoc package for this Mac. */
const buildKind = process.env.BOW_SIGN_IDENTITY ? "release" : "local";

/** The unpacked Electron's executables get UUIDs of their own before anything is renamed or signed. */
function giveExecutablesOwnUuids(hookArgs) {
  const changes = makeBuildUuidsOwn(hookArgs.buildPath, BUNDLE_ID, packageJson.version, hookArgs.electronVersion, hookArgs.arch, buildKind);
  for (const change of changes) {
    console.log(`Build UUID ${change}`);
  }
}

const options = {
  dir: appDir,
  name: "Bow",
  platform: "darwin",
  arch: flags.arch,
  out: path.join(appDir, "release"),
  overwrite: true,
  tmpdir: flags.tmpdir,
  icon: path.join(appDir, "build", "icon.icns"),
  appBundleId: BUNDLE_ID,
  extendInfo: flags["extend-info"],
  // The command line's defaults, kept: the app's code in app.asar, dev dependencies pruned, junk files left out.
  asar: true,
  prune: true,
  junk: true,
  afterExtract: [giveExecutablesOwnUuids],
  ignore: [
    /^\/(src|tests|e2e|docs|reference|tools|tasks|build|release|\.handoffs|\.claude|\.github)(\/|$)/,
    /^\/node_modules\/(?!(electron-chrome-extensions|debug|ms)(\/|$))/,
    /^\/(tsconfig[^/]*\.json|vitest\.config\.ts|README\.md|CLAUDE\.md|\.nvmrc|\.gitignore)$/,
  ],
};
if (flags["electron-zip-dir"] !== undefined) {
  options.electronZipDir = flags["electron-zip-dir"];
}
if (process.env.BOW_SIGN_IDENTITY) {
  options.osxSign = { identity: process.env.BOW_SIGN_IDENTITY };
}
await packager(options);
