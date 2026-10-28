/**
 * WHY this file exists:
 *   Air Traffic Control can send links by the app they came from ("links from Slack → Work"). macOS does not tell an
 *   app who sent it a link, but the sender is the app in front at that moment: Bow reads it with /usr/bin/lsappinfo
 *   (part of macOS, no permission needed) before it comes forward itself. The Library's rule form lists the apps that
 *   are running (and those that sent links), read the same way.
 *
 * Data source:
 *   `lsappinfo front` + `lsappinfo info` (the front app), `lsappinfo list` (running apps). In e2e runs, the variable
 *   BOW_E2E_LINK_SOURCE_APP ("com.example.chat|Example Chat") stands for the front app: tests cannot pick which app
 *   is in front on a Mac someone is using.
 *
 * Data flow:
 *   open-url / second launch → readFrontApp() → handleExternalUrl(url, app) → rememberSourceApp(); routing.ts
 *   Library opens → refreshRunningApps() → listKnownSourceApps() → the rule form's app list
 */
import { execFile } from "node:child_process";
import type { LinkSourceApp } from "../shared/routingRules";

const LSAPPINFO_PATH = "/usr/bin/lsappinfo";

/** How long one lsappinfo call may take. Our choice: it answers in milliseconds; a link must not wait long. */
const LSAPPINFO_TIMEOUT_MS = 1500;

/** Most apps remembered as link senders in this run. Our choice. */
const REMEMBERED_SENDERS_LIMIT = 12;

/** A bundle id: reverse-DNS letters, digits, dots and dashes. */
export const BUNDLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,154}$/;

/** The test stand-in for the front app (see the header). */
const TEST_SOURCE_APP_VARIABLE = "BOW_E2E_LINK_SOURCE_APP";

/** Apps that sent links in this run, newest first. */
let rememberedSenders: LinkSourceApp[] = [];

/** The apps running when the Library last asked. */
let runningApps: LinkSourceApp[] = [];

/**
 * The front app in `lsappinfo info` output: the quoted name on the first line and the bundleID line. Null when
 * either is missing.
 * Example: '"Slack" ASN:0x0-0x1234: (in front)\n    bundleID="com.tinyspeck.slackmacgap"' → Slack
 */
export function parseAppInfo(text: string): LinkSourceApp | null {
  const nameMatch = /^"([^"]+)"/.exec(text.trim());
  const bundleMatch = /bundleID="([^"]+)"/.exec(text);
  const bundleId = bundleMatch?.[1] ?? "";
  if (nameMatch === null || !BUNDLE_ID_PATTERN.test(bundleId)) {
    return null;
  }
  return { bundleId: bundleId, name: nameMatch[1] as string };
}

/**
 * The regular apps (those with a Dock icon) in `lsappinfo list` output, except the process with `ownPid`, sorted by
 * name, each bundle id once.
 */
export function parseRunningApps(text: string, ownPid: number): LinkSourceApp[] {
  const apps: LinkSourceApp[] = [];
  // Each app's record starts with " 12) "Name" ASN:…".
  const records = text.split(/\n\s*\d+\) /);
  for (const record of records) {
    const nameMatch = /^"([^"]+)"/.exec(record.trim());
    const bundleMatch = /bundleID="([^"]+)"/.exec(record);
    const pidMatch = /pid = (\d+)/.exec(record);
    const isRegularApp = record.includes('type="Foreground"');
    const bundleId = bundleMatch?.[1] ?? "";
    const isOwnProcess = pidMatch !== null && Number(pidMatch[1]) === ownPid;
    if (nameMatch === null || !isRegularApp || isOwnProcess || !BUNDLE_ID_PATTERN.test(bundleId) || apps.some((app) => app.bundleId === bundleId)) {
      continue;
    }
    apps.push({ bundleId: bundleId, name: nameMatch[1] as string });
  }
  apps.sort((first, second) => first.name.localeCompare(second.name));
  return apps;
}

/**
 * The test stand-in for the front app, or null outside e2e runs.
 */
function readTestSourceApp(): LinkSourceApp | null {
  const value = process.env[TEST_SOURCE_APP_VARIABLE];
  if (value === undefined) {
    return null;
  }
  const [bundleId, name] = value.split("|");
  return bundleId !== undefined && name !== undefined && BUNDLE_ID_PATTERN.test(bundleId) ? { bundleId: bundleId, name: name } : null;
}

/**
 * Runs lsappinfo with some arguments; its output, or "" on any failure (not macOS, too slow).
 */
function runLsappinfo(argumentList: string[]): Promise<string> {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve("");
      return;
    }
    execFile(LSAPPINFO_PATH, argumentList, { timeout: LSAPPINFO_TIMEOUT_MS }, (error, output) => resolve(error === null ? String(output) : ""));
  });
}

/**
 * The app in front now (the sender of a link that just arrived), or null when unknown or when it is Bow itself.
 */
export async function readFrontApp(): Promise<LinkSourceApp | null> {
  const testApp = readTestSourceApp();
  if (testApp !== null) {
    return testApp;
  }
  const frontAsn = (await runLsappinfo(["front"])).trim();
  if (!frontAsn.startsWith("ASN:")) {
    return null;
  }
  const info = await runLsappinfo(["info", "-only", "bundleID", "-only", "name", "-only", "pid", frontAsn]);
  const pidMatch = /pid = (\d+)/.exec(info);
  if (pidMatch !== null && Number(pidMatch[1]) === process.pid) {
    return null;
  }
  return parseAppInfo(info);
}

/**
 * Remembers an app that sent a link, so the Library offers it even after it quit.
 */
export function rememberSourceApp(app: LinkSourceApp | null): void {
  if (app === null) {
    return;
  }
  const others = rememberedSenders.filter((sender) => sender.bundleId !== app.bundleId);
  rememberedSenders = [app, ...others].slice(0, REMEMBERED_SENDERS_LIMIT);
}

/**
 * Reads the running apps again (the Library's rule form lists them); calls back when done.
 */
export function refreshRunningApps(onRead: () => void): void {
  runLsappinfo(["list"])
    .then((output) => {
      runningApps = parseRunningApps(output, process.pid);
      onRead();
    })
    .catch(() => undefined);
}

/**
 * The apps the rule form offers: those that sent links, then the running ones, each once, sorted by name; the test
 * stand-in too in e2e runs.
 */
export function listKnownSourceApps(): LinkSourceApp[] {
  const testApp = readTestSourceApp();
  const candidates = testApp === null ? [...rememberedSenders, ...runningApps] : [testApp, ...rememberedSenders, ...runningApps];
  const known: LinkSourceApp[] = [];
  for (const app of candidates) {
    if (!known.some((kept) => kept.bundleId === app.bundleId)) {
      known.push(app);
    }
  }
  known.sort((first, second) => first.name.localeCompare(second.name));
  return known;
}
