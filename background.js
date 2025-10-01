// Robust injector that ensures content.js is present in the MAIN world, then toggles UI.

async function ensureInjected(tabId) {
  // Try to ping the content script; if it fails, inject
  try {
    await chrome.tabs.sendMessage(tabId, { type: "GX_PING" });
    return;
  } catch (e) {
    // Not injected yet; proceed to inject in MAIN world
  }

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content.js"],
    world: "MAIN" // <-- critical: run in the page's main world
  });

  // Give the script a moment to attach listeners (usually unnecessary but safe)
  try {
    await chrome.tabs.sendMessage(tabId, { type: "GX_PING" });
  } catch (e) {
    // ignore
  }
}

// If you also want the toolbar toggle when clicking the action icon directly:
// Note: onClicked won't fire if you have a popup open. Your popup is kept, so rely on it.
// Keeping this so you can call it from the popup too.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  await ensureInjected(tab.id);
  await chrome.tabs.sendMessage(tab.id, { type: "GX_TOGGLE_UI" });
});

// Listen for popup -> background requests to toggle the UI
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "GX_TOGGLE_FROM_POPUP") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return;
      await ensureInjected(tab.id);
      await chrome.tabs.sendMessage(tab.id, { type: "GX_TOGGLE_UI" });
    });
  }
});
