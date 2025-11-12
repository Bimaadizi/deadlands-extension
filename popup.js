// popup.js (MV3) — better diagnostics for injection

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function runScript(tabId, file) {
  return chrome.scripting.executeScript({ target: { tabId }, files: [file] });
}

// Quick smoke test to see if *any* code can run on this tab
async function canInject(tabId) {
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({ href: location.href, ok: true })
    });
    return result?.ok === true;
  } catch (e) {
    return false;
  }
}

async function explainWhyCantInject(tab) {
  const url = tab?.url || "";
  const restrictedHosts = [
    "chrome://", "edge://", "vivaldi://", "brave://",
    "chrome-extension://", // includes PDF Viewer too
    "https://chromewebstore.google.com", "https://chrome.google.com/webstore/"
  ];
  if (restrictedHosts.some(p => url.startsWith(p))) {
    alert(`Chrome blocks injection on this page:\n\n${url}\n\nTry again on a regular http(s) site (e.g. chat.openai.com).`);
    return true;
  }
  if (url.startsWith("file://")) {
    alert(`This is a file:// URL:\n\n${url}\n\nOpen chrome://extensions → your extension → enable "Allow access to file URLs", then try again.`);
    return true;
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
    const tab = tabs?.[0];
    const tabId = tab?.id;
    if (!tabId) return;

    const showRealError = (prefix, e) => {
      const msg = e && (e.message || e.toString());
      console.error(prefix, e);
      alert(`${prefix}\n\n${msg || "(no message)"}`);
    };

    // GX Parsables (unchanged)
    const gxBtn = document.getElementById("enableGX");
    if (gxBtn) {
      gxBtn.addEventListener("click", async () => {
        const loaded = await isGxLoaded(tabId);
        if (!loaded) {
          await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
          await sleep(150);
        }
        await toggleGx(tabId);
        window.close();
      });
    }

    // Inventory
    const invBtn = document.getElementById("enableInventory");
    if (invBtn) {
      invBtn.addEventListener("click", async () => {
        // 1) Explain obvious blocked contexts
        if (await explainWhyCantInject(tab)) return;

        // 2) Can we inject *anything*?
        const ok = await canInject(tabId);
        if (!ok) {
          alert("Chrome blocked script injection on this page. Try another site (http/https), or check host permissions.");
          return;
        }

        // 3) Try inventory.js and surface the real error if any
        try {
          await runScript(tabId, "inventory.js");
          window.close();
        } catch (e) {
          // Show a precise reason (e.g., “Cannot access contents of url …”)
          showRealError("Couldn't inject inventory.js:", e);
        }
      });
    }
  });
});
