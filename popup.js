// Minimal popup to inject features on demand (MV3)

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function runScript(tabId, file) {
  return chrome.scripting.executeScript({ target: { tabId }, files: [file] });
}

async function runFirstAvailable(tabId, candidates) {
  for (const file of candidates) {
    try { await runScript(tabId, file); return true; } catch (_) {}
  }
  return false;
}

// Evaluate a function in the page and return its result
async function runInPage(tabId, func, args = []) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });
  return result;
}

// Is GX already injected?
async function isGxLoaded(tabId) {
  return await runInPage(tabId, () => {
    return !!document.getElementById('gx-overlay-root') ||
           !!document.getElementById('gx-open-button') ||
           !!window.__GX_BOOTSTRAPPED;
  });
}

// Toggle GX overlay (content listener in content.js listens for this)
async function toggleGx(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "GX_TOGGLE_UI" });
  } catch (_) {
    // no-op if content script not present
  }
}

document.addEventListener("DOMContentLoaded", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tabId = tabs?.[0]?.id;
    if (!tabId) return;

    // GX Parsables
    document.getElementById("enableGX").addEventListener("click", async () => {
      const loaded = await isGxLoaded(tabId);
      if (!loaded) {
        await runScript(tabId, "content.js");     // content.js dynamically imports deck.js itself
        await sleep(150);                          // let listeners attach
      }
      // open/bring up overlay
      await toggleGx(tabId);
      window.close();
    });

    // Journal
    document.getElementById("enableJournal").addEventListener("click", async () => {
      try {
        await runScript(tabId, "journal.js");
      } catch (e) {
        alert("Couldn't inject journal.js. Make sure it's in the root of the extension.");
      }
    });

    // Map (tries map.js then mapOverlay.js)
    document.getElementById("enableMap").addEventListener("click", async () => {
      const ok = await runFirstAvailable(tabId, ["map.js", "mapOverlay.js"]);
      if (!ok) alert("Couldn't inject map.js or mapOverlay.js.");
    });

    // Enable All (injects everything and opens GX)
    document.getElementById("enableAll").addEventListener("click", async () => {
      const loaded = await isGxLoaded(tabId);
      if (!loaded) await runScript(tabId, "content.js");
      await sleep(150);
      await toggleGx(tabId);

      try { await runScript(tabId, "journal.js"); } catch (_) {}
      await runFirstAvailable(tabId, ["map.js", "mapOverlay.js"]);
      window.close();
    });
  });
});
