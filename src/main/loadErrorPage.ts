/**
 * WHY this file exists:
 *   Writes Bow's "can't open this page" page into a tab whose page failed to load (rules and wording in
 *   loadErrors.ts). It fills Chromium's own error document instead of loading a page of ours, because that document
 *   *is* the failed address's history entry: Reload and Try Again load the real page again and Back goes to the page
 *   before (no bounce through a page of ours). A page of our own (like certificate.html) would be a second history
 *   entry, with a file:// address that Reload would only load again.
 *
 * Data source:
 *   Failed main-frame loads of tab pages (tabViews.ts → main.ts onLoadFailed).
 *
 * Data flow:
 *   did-fail-load → showLoadErrorPage() → describeLoadError / renderLoadErrorHtml → executeJavaScript in the error
 *   document, which writes the page only while it is still that empty error document
 */
import type { WebContents } from "electron";
import { describeLoadError, renderLoadErrorHtml } from "./loadErrors";

/**
 * Where Chromium's error document lives. A failure that did not replace the page (the old page is still on screen)
 * leaves another address here, and then nothing is written: the page that is there stays untouched.
 */
const CHROMIUM_ERROR_DOCUMENT_URL = "chrome-error://chromewebdata/";

/**
 * A tab's page failed to load: shows what went wrong in the tab, unless the failure is not one to show (a frame in
 * the page, a stopped load).
 */
export function showLoadErrorPage(contents: WebContents, errorCode: number, errorName: string, validatedUrl: string, isMainFrame: boolean): void {
  const page = describeLoadError(errorCode, errorName, validatedUrl, isMainFrame);
  if (page === null || contents.isDestroyed()) {
    return;
  }
  const html = renderLoadErrorHtml(page);
  // The HTML goes in as a JSON string literal, so nothing in it can end the script; the page has no scripts of its own.
  const script = `(() => {
    if (window.location.href !== ${JSON.stringify(CHROMIUM_ERROR_DOCUMENT_URL)}) {
      return false;
    }
    document.documentElement.innerHTML = ${JSON.stringify(html)};
    return true;
  })()`;
  contents.executeJavaScript(script).catch(() => undefined);
}
