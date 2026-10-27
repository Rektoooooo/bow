// Sends a ping to the echo host, then sends back what it answered, so the host's log shows the whole round trip.
const HOST_NAME = "com.sidebar_browser.test_echo";

async function talkToHost() {
  const reply = await chrome.runtime.sendNativeMessage(HOST_NAME, { ping: "hello from the extension" });
  await chrome.runtime.sendNativeMessage(HOST_NAME, { got: reply });
}

talkToHost().catch((error) => console.error("Native messaging failed:", error));
