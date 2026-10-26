// Shows the active tab's address: proves that chrome.tabs knows which tab is selected.
chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
  const url = tabs[0] === undefined ? "none" : tabs[0].url;
  document.getElementById("url").textContent = url;
  document.body.dataset.activeUrl = url;
});
