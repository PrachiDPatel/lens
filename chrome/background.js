/* Lens — background service worker.
 *
 * Two jobs:
 *  1. Capture the visible tab as a PNG data URL when the content script
 *     asks (chrome.tabs.captureVisibleTab can only run here, not in the
 *     content script).
 *  2. Toggle the panel when the keyboard shortcut fires. Invoking the
 *     extension through the shortcut also grants the temporary tab access
 *     that screenshots need under the activeTab permission.
 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "lens-capture") return false;

  (async () => {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(
        sender.tab ? sender.tab.windowId : undefined,
        { format: "png" }
      );
      sendResponse({ dataUrl });
    } catch (err) {
      sendResponse({ error: (err && err.message) || String(err) });
    }
  })();

  return true; // keep the message channel open for the async response
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-panel") return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) return;

    try {
      await chrome.tabs.sendMessage(tab.id, { type: "lens-toggle-panel" });
    } catch (_e) {
      // Content script isn't in this tab (e.g. the page loaded before the
      // extension was installed). Inject it, then toggle.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await chrome.tabs.sendMessage(tab.id, { type: "lens-toggle-panel" });
    }
  } catch (_e) {
    // Tab isn't scriptable (chrome:// pages, the web store, …) — nothing to do.
  }
});
