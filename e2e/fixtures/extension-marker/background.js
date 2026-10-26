// A service worker that answers a ping, so the extension has a running background like real MV3 extensions.
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message === "ping") {
    reply("pong");
  }
});
