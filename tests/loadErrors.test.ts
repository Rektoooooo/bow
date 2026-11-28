/**
 * WHY this file exists:
 *   A tab whose page cannot be loaded shows why instead of a white page. These tests pin down which failures get the
 *   page, the reason and tip for each, and that nothing from the address or Chromium can put markup into it.
 */
import { describe, expect, it } from "vitest";
import { describeLoadError, renderLoadErrorHtml } from "../src/main/loadErrors";

describe("the page for a failed load", () => {
  it("is not shown for a frame inside the page or a load that was only stopped", () => {
    expect(describeLoadError(-102, "ERR_CONNECTION_REFUSED", "http://localhost:3000/", false)).toBeNull();
    expect(describeLoadError(-3, "ERR_ABORTED", "https://example.com/", true)).toBeNull();
  });

  it("says a development server refused to connect, with the host and port", () => {
    const page = describeLoadError(-102, "ERR_CONNECTION_REFUSED", "http://localhost:3000/#/home", true);
    expect(page).toEqual({
      host: "localhost:3000",
      retryUrl: "http://localhost:3000/#/home",
      reason: "The site refused to connect.",
      errorName: "ERR_CONNECTION_REFUSED",
      tip: "If this is a development server, check that it is running.",
    });
  });

  it("points at macOS's Local Network setting when a device on the network can't be reached", () => {
    const page = describeLoadError(-109, "ERR_ADDRESS_UNREACHABLE", "http://192.168.0.7:3000/", true);
    expect(page?.host).toBe("192.168.0.7:3000");
    expect(page?.reason).toBe("This Mac can't reach the site.");
    expect(page?.tip).toContain("System Settings › Privacy & Security › Local Network");
    expect(describeLoadError(-109, "ERR_ADDRESS_UNREACHABLE", "http://printer.local/", true)?.tip).toContain("Local Network");
  });

  it("points at the Local Network setting for names it can't tell are local, too", () => {
    expect(describeLoadError(-109, "ERR_ADDRESS_UNREACHABLE", "http://nas.lan:5000/", true)?.tip).toContain("Local Network");
  });

  it("gives public sites no development-server tip", () => {
    expect(describeLoadError(-102, "ERR_CONNECTION_REFUSED", "https://example.com/", true)?.tip).toBeNull();
    expect(describeLoadError(-105, "ERR_NAME_NOT_RESOLVED", "https://no-such-site.example/", true)?.reason).toBe("The site's address couldn't be found.");
  });

  it("falls back to a general reason for other errors", () => {
    expect(describeLoadError(-20, "ERR_BLOCKED_BY_CLIENT", "https://example.com/", true)?.reason).toBe("The page couldn't be loaded.");
  });

  it("offers Try Again only for web addresses", () => {
    const page = describeLoadError(-6, "ERR_FILE_NOT_FOUND", "file:///missing.html", true);
    expect(page?.retryUrl).toBeNull();
    expect(page?.host).toBe("file:///missing.html");
    expect(renderLoadErrorHtml(page!)).not.toContain("Try Again");
    const webPage = describeLoadError(-102, "ERR_CONNECTION_REFUSED", "http://localhost:3000/", true);
    expect(renderLoadErrorHtml(webPage!)).toContain('<a class="load-error-retry" href="http://localhost:3000/">Try Again</a>');
  });

  it("writes everything as text, so an address cannot add markup", () => {
    const page = describeLoadError(-102, 'ERR_<b>"x"</b>', 'http://localhost:3000/"><script>alert(1)</script>', true);
    const html = renderLoadErrorHtml(page!);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("ERR_&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
    // The address is parsed first, so the quote and brackets reach the link already percent-encoded or escaped.
    expect(html).not.toMatch(/href="[^"]*"[^>]*><script/);
  });
});
