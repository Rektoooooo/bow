/**
 * WHY this file exists:
 *   HTTPS-Only Mode's main side (rules in httpsOnly.ts): page requests over plain http go to https instead, and when
 *   a page Bow upgraded fails because the site has no secure version, the sidebar offers to open it over http. A site
 *   opened that way stays allowed until Bow quits. Only loads Bow upgraded get the offer: a typed https:// address
 *   that fails is never downgraded.
 *
 * Data source:
 *   settings.isHttpsOnly; each page request (adBlock.ts's request handler, the one handler a session has); failed
 *   loads of tab pages (tabViews.ts).
 *
 * Data flow:
 *   main-frame request → decideMainFrameRequest() → redirect to https (remembered by page)
 *   that page's load fails → noticeLoadFailed() → isNoHttpsFailure → sidebar notice "Open with HTTP" → allowed, loaded
 */
import type { WebContents } from "electron";
import { HTTPS_FALLBACK_NOTICE_MS } from "../shared/settings";
import { getSiteKey } from "../shared/siteKey";
import { getState } from "./browserCore";
import { isNoHttpsFailure, toHttpsUrl } from "./httpsOnly";
import { offerSidebarNotice } from "./sidebarNotice";

/** The page loads Bow upgraded, by WebContents id: what was asked for, and where it went. */
const upgrades = new Map<number, { httpUrl: string; httpsUrl: string }>();

/** Sites the user opened over http after an upgrade failed; allowed until Bow quits. */
const allowedHttpSites = new Set<string>();

/**
 * A page's main-frame request: the https address to go to instead, or null to let it through. Keeps track of the
 * upgrade, and forgets it when the page asks for something else.
 */
export function decideMainFrameRequest(contentsId: number, url: string): string | null {
  const known = upgrades.get(contentsId);
  // The redirect's own request for the https address keeps the record.
  if (known !== undefined && known.httpsUrl === url) {
    return null;
  }
  upgrades.delete(contentsId);
  const site = getSiteKey(url);
  const isAllowedOverHttp = site !== null && allowedHttpSites.has(site);
  if (getState().settings.isHttpsOnly !== true || isAllowedOverHttp) {
    return null;
  }
  const httpsUrl = toHttpsUrl(url);
  if (httpsUrl !== null) {
    upgrades.set(contentsId, { httpUrl: url, httpsUrl: httpsUrl });
  }
  return httpsUrl;
}

/**
 * A tab's page failed to load: when it was Bow's upgrade and the site has no secure version, the sidebar offers the
 * http page.
 */
export function noticeLoadFailed(contents: WebContents, errorCode: number, validatedUrl: string, isMainFrame: boolean): void {
  const upgrade = upgrades.get(contents.id);
  if (!isMainFrame || upgrade === undefined || validatedUrl !== upgrade.httpsUrl || !isNoHttpsFailure(errorCode)) {
    return;
  }
  upgrades.delete(contents.id);
  const host = new URL(upgrade.httpUrl).host;
  offerSidebarNotice(
    `${host} has no secure version`,
    "Open with HTTP",
    () => {
      const site = getSiteKey(upgrade.httpUrl);
      if (site !== null) {
        allowedHttpSites.add(site);
      }
      contents.loadURL(upgrade.httpUrl).catch(() => undefined);
    },
    HTTPS_FALLBACK_NOTICE_MS,
  );
}
