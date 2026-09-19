/* Lens — background service worker.
 *
 * Three jobs:
 *  1. Capture the visible tab as a PNG data URL when the content script
 *     asks (chrome.tabs.captureVisibleTab can only run here, not in the
 *     content script).
 *  2. Talk to the Anthropic API for key validation and direct-send. Doing it
 *     here keeps the key out of page contexts and sidesteps CORS. The key is
 *     read from chrome.storage.local at call time and is never logged or
 *     included in any response.
 *  3. Toggle the panel when the keyboard shortcut fires. Invoking the
 *     extension through the shortcut also grants the temporary tab access
 *     that screenshots need under the activeTab permission.
 */

const ANTHROPIC_VERSION = "2023-06-01";
const KEY_STORE = "lensApiKey";   // chrome.storage.local
const MODEL_STORE = "lensModel";  // chrome.storage.sync

function anthropicHeaders(key) {
  return {
    "x-api-key": key,
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
    "content-type": "application/json",
  };
}

/* Validate a key against the models endpoint.
 * Returns {ok:true, models:[ids]} or {ok:false, status?|network?}. */
async function validateKey(key) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: anthropicHeaders(key),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    const list = data && Array.isArray(data.data) ? data.data : [];
    const models = list
      .map((m) => m && m.id)
      .filter(Boolean)
      .sort();
    return { ok: true, models };
  } catch (_err) {
    return { ok: false, network: true };
  }
}

/* Send page context to Claude.
 * msg: {question, title, url, pageText, imageBase64|null}.
 * Returns {ok:true, text} or {ok:false, error|status}. */
async function sendToClaude(msg) {
  const { [KEY_STORE]: key } = await chrome.storage.local.get(KEY_STORE);
  if (!key) return { ok: false, error: "no-key" };
  const { [MODEL_STORE]: model } = await chrome.storage.sync.get(MODEL_STORE);
  if (!model) return { ok: false, error: "no-model" };

  const parts = [];
  if (msg.question) parts.push(msg.question, "");
  parts.push(`Page: ${msg.title || "(no title)"} (${msg.url})`, "");
  parts.push(msg.pageText || "");

  const content = [];
  if (msg.imageBase64) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: msg.imageBase64 },
    });
  }
  content.push({ type: "text", text: parts.join("\n") });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: anthropicHeaders(key),
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system:
          "You are helping a developer who is looking at a webpage. " +
          "A screenshot and the page text are attached. Answer their question about the page.",
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) {
      const auth = res.status === 401 || res.status === 403;
      return { ok: false, status: res.status, error: auth ? "auth" : "http" };
    }
    const data = await res.json();
    const blocks = data && Array.isArray(data.content) ? data.content : [];
    const text = blocks
      .filter((b) => b && b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n\n");
    return { ok: true, text };
  } catch (_err) {
    return { ok: false, error: "network" };
  }
}

function captureTab(sender) {
  return chrome.tabs
    .captureVisibleTab(sender.tab ? sender.tab.windowId : undefined, {
      format: "png",
    })
    .then((dataUrl) => ({ dataUrl }))
    .catch((err) => ({ error: (err && err.message) || String(err) }));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;

  if (msg.type === "lens-capture") {
    captureTab(sender).then(sendResponse);
    return true; // keep the channel open for the async response
  }
  if (msg.type === "lens-validate-key") {
    validateKey(msg.key).then(sendResponse);
    return true;
  }
  if (msg.type === "lens-send") {
    sendToClaude(msg).then(sendResponse);
    return true;
  }
  return false;
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
