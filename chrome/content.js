/* Lens — content script.
 *
 * Renders a floating button + panel inside a shadow DOM so page CSS can
 * never break it. The panel bundles the page's screenshot, title, URL and
 * text into one clipboard write, so a prompt about "this page" no longer
 * needs manual screenshots.
 */
(() => {
  "use strict";

  // Guard against double-injection (e.g. SPA navigations re-running us).
  if (window.__lensInjected) return;
  window.__lensInjected = true;

  const MAX_TEXT_CHARS = 8000; // how much page text goes into the bundle
  const STORAGE_KEY = "lensEnabled";

  /* ---------- styles (live inside the shadow root) ---------- */
  const CSS = `
    #lens-fab {
      position: fixed; right: 20px; bottom: 20px;
      width: 48px; height: 48px; border-radius: 50%;
      background: #1c1f26; color: #fff;
      border: 1px solid rgba(255,255,255,.16);
      box-shadow: 0 4px 16px rgba(0,0,0,.35);
      cursor: grab; display: flex; align-items: center; justify-content: center;
      padding: 0; margin: 0; z-index: 1;
      font-family: system-ui, -apple-system, sans-serif;
    }
    #lens-fab:active { cursor: grabbing; }
    #lens-fab:focus-visible { outline: 2px solid #7aa2ff; outline-offset: 2px; }
    #lens-panel {
      position: fixed; right: 20px; bottom: 80px;
      width: 340px; max-width: calc(100vw - 40px);
      background: #1c1f26; color: #e8eaf0;
      border: 1px solid rgba(255,255,255,.12); border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0,0,0,.45);
      font-family: system-ui, -apple-system, sans-serif; font-size: 13px;
      line-height: 1.45; overflow: hidden; z-index: 2;
    }
    #lens-panel[hidden] { display: none; }
    #lens-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 8px 10px 14px; cursor: grab; user-select: none;
      -webkit-user-select: none; border-bottom: 1px solid rgba(255,255,255,.08);
      font-weight: 650; font-size: 14px; touch-action: none;
    }
    #lens-header:active { cursor: grabbing; }
    #lens-header .lens-controls { display: flex; gap: 2px; }
    #lens-header .lens-controls button {
      background: transparent; border: 0; color: #9aa0ae; cursor: pointer;
      font-size: 16px; line-height: 1; padding: 6px 8px; border-radius: 8px;
      font-family: inherit;
    }
    #lens-header .lens-controls button:hover { background: rgba(255,255,255,.08); color: #fff; }
    #lens-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
    #lens-body.lens-min { display: none; }
    #lens-pageinfo .lens-title {
      font-weight: 600; white-space: nowrap; overflow: hidden;
      text-overflow: ellipsis;
    }
    #lens-pageinfo .lens-url {
      color: #9aa0ae; font-size: 11.5px; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
    }
    #lens-note {
      color: #9aa0ae; font-size: 11.5px; background: rgba(255,255,255,.04);
      border: 1px solid rgba(255,255,255,.07); border-radius: 8px;
      padding: 7px 9px;
    }
    #lens-q {
      width: 100%; box-sizing: border-box; min-height: 64px; resize: vertical;
      background: #12151c; color: #e8eaf0; border: 1px solid rgba(255,255,255,.12);
      border-radius: 8px; padding: 8px 10px; font: inherit;
    }
    #lens-q:focus { outline: 2px solid #7aa2ff; outline-offset: 1px; border-color: transparent; }
    #lens-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    #lens-actions button {
      flex: 1 1 auto; font: inherit; font-weight: 600; cursor: pointer;
      border-radius: 9px; padding: 9px 10px; border: 1px solid rgba(255,255,255,.14);
      background: #2a2f3a; color: #e8eaf0;
    }
    #lens-actions button:hover:not(:disabled) { background: #343b48; }
    #lens-actions button:disabled { opacity: .5; cursor: default; }
    #lens-actions button.lens-primary { background: #3b6fe0; border-color: #3b6fe0; color: #fff; }
    #lens-actions button.lens-primary:hover:not(:disabled) { background: #4a7ef0; }
    #lens-toast {
      background: #0f5132; color: #d8f3e3; border-radius: 8px;
      padding: 8px 10px; font-size: 12.5px; text-align: center;
    }
    #lens-toast[hidden] { display: none; }
    #lens-toast.lens-err { background: #5c1a1a; color: #f6d9d9; }
  `;

  /* ---------- shadow host (single top-level stacking context) ---------- */
  const host = document.createElement("div");
  host.setAttribute("id", "lens-host");
  host.setAttribute(
    "style",
    "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;"
  );
  (document.documentElement || document).appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  styleEl.textContent = CSS;
  shadow.appendChild(styleEl);

  /* ---------- floating button ---------- */
  const fab = document.createElement("button");
  fab.id = "lens-fab";
  fab.title = "Lens — ask about this page (Alt+L)";
  fab.setAttribute("aria-label", "Open Lens panel");
  fab.style.pointerEvents = "auto";
  fab.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" ' +
    'stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' +
    '<circle cx="11" cy="11" r="7"/>' +
    '<line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>';
  shadow.appendChild(fab);

  /* ---------- panel ---------- */
  const panel = document.createElement("div");
  panel.id = "lens-panel";
  panel.hidden = true;
  panel.style.pointerEvents = "auto";
  panel.innerHTML = `
    <div id="lens-header">
      <span>Lens</span>
      <span class="lens-controls">
        <button id="lens-min" title="Minimize" aria-label="Minimize panel">–</button>
        <button id="lens-close" title="Close" aria-label="Close panel">×</button>
      </span>
    </div>
    <div id="lens-body">
      <div id="lens-pageinfo">
        <div class="lens-title"></div>
        <div class="lens-url"></div>
      </div>
      <div id="lens-note"></div>
      <textarea id="lens-q" placeholder="Ask about this page…"></textarea>
      <div id="lens-actions">
        <button id="lens-copy-ai" class="lens-primary">Copy for AI</button>
        <button id="lens-copy-text">Copy text only</button>
        <button id="lens-copy-shot">Screenshot only</button>
      </div>
      <div id="lens-toast" hidden></div>
    </div>`;
  shadow.appendChild(panel);

  const $ = (id) => shadow.getElementById(id);
  const header = $("lens-header");
  const body = $("lens-body");
  const titleEl = panel.querySelector(".lens-title");
  const urlEl = panel.querySelector(".lens-url");
  const noteEl = $("lens-note");
  const questionEl = $("lens-q");
  const toastEl = $("lens-toast");
  const actionButtons = [...panel.querySelectorAll("#lens-actions button")];

  /* ---------- drag helper (pointer-based; click still works) ---------- */
  function makeDraggable(handle, target, onTap) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = target.getBoundingClientRect();
      const origLeft = rect.left;
      const origTop = rect.top;
      let moved = false;

      // Pin to explicit left/top so dragging works from any start position.
      target.style.left = origLeft + "px";
      target.style.top = origTop + "px";
      target.style.right = "auto";
      target.style.bottom = "auto";
      handle.setPointerCapture(e.pointerId);

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        const w = target.offsetWidth || 48;
        const h = target.offsetHeight || 48;
        target.style.left =
          Math.max(0, Math.min(window.innerWidth - w, origLeft + dx)) + "px";
        target.style.top =
          Math.max(0, Math.min(window.innerHeight - h, origTop + dy)) + "px";
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        if (!moved && onTap) onTap();
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }

  /* ---------- panel open/close/minimize ---------- */
  function refreshPageInfo() {
    titleEl.textContent = document.title || "(no title)";
    titleEl.title = titleEl.textContent;
    urlEl.textContent = location.href;
    urlEl.title = location.href;
    noteEl.textContent =
      "Will capture: this tab's visible area + page text " +
      `(first ${MAX_TEXT_CHARS.toLocaleString()} chars).`;
  }

  function setPanel(open) {
    panel.hidden = !open;
    if (open) {
      body.classList.remove("lens-min");
      refreshPageInfo();
    }
  }

  makeDraggable(fab, fab, () => setPanel(panel.hidden)); // tap toggles
  makeDraggable(header, panel, null); // drag by header only
  $("lens-close").addEventListener("click", () => setPanel(false));
  $("lens-min").addEventListener("click", () => body.classList.toggle("lens-min"));

  // Toggle from the keyboard shortcut (relayed by the service worker).
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "lens-toggle-panel") setPanel(panel.hidden);
  });

  /* ---------- page text + markdown bundle ---------- */
  function pageText() {
    const el = document.body || document.documentElement;
    const raw = el && el.innerText ? el.innerText : "";
    const cleaned = raw.replace(/\n{3,}/g, "\n\n").trim();
    if (cleaned.length > MAX_TEXT_CHARS) {
      return cleaned.slice(0, MAX_TEXT_CHARS) + "\n…[text truncated]";
    }
    return cleaned;
  }

  function buildBundle() {
    const question = questionEl.value.trim();
    const parts = [];
    if (question) parts.push(question, "");
    parts.push(`Page: ${document.title || "(no title)"} (${location.href})`, "");
    parts.push(pageText());
    return parts.join("\n");
  }

  /* ---------- toast ---------- */
  let toastTimer = null;
  function toast(message, isError) {
    toastEl.textContent = message;
    toastEl.classList.toggle("lens-err", !!isError);
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 2800);
  }

  /* ---------- screenshot via the service worker ---------- */
  function requestScreenshot() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "lens-capture" }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp || resp.error || !resp.dataUrl) {
          reject(new Error((resp && resp.error) || "capture failed"));
          return;
        }
        resolve(resp.dataUrl);
      });
    });
  }

  function dataUrlToBlob(dataUrl) {
    return fetch(dataUrl).then((r) => r.blob());
  }

  function setBusy(busy) {
    actionButtons.forEach((b) => {
      b.disabled = busy;
    });
  }

  /* ---------- the three copy actions ---------- */

  // Screenshot + markdown bundle, written together in ONE ClipboardItem so a
  // single paste carries both the image and the text.
  async function copyForAI() {
    setBusy(true);
    try {
      const bundle = buildBundle();
      let item;
      try {
        const png = await dataUrlToBlob(await requestScreenshot());
        item = new ClipboardItem({
          "image/png": png,
          "text/plain": new Blob([bundle], { type: "text/plain" }),
        });
      } catch (_shotErr) {
        // No screenshot (e.g. the tab wasn't opened via the shortcut or the
        // toolbar yet, so there's no temporary tab access). Fall back to text
        // rather than failing outright.
        item = new ClipboardItem({
          "text/plain": new Blob(
            [bundle + "\n\n[Note: screenshot unavailable — open the panel with Alt+L and retry.]"],
            { type: "text/plain" }
          ),
        });
      }
      await navigator.clipboard.write([item]);
      toast("Copied — paste into any AI chat");
    } catch (err) {
      toast("Copy failed: " + (err && err.message ? err.message : err), true);
    } finally {
      setBusy(false);
    }
  }

  async function copyTextOnly() {
    setBusy(true);
    try {
      await navigator.clipboard.writeText(buildBundle());
      toast("Copied — paste into any AI chat");
    } catch (err) {
      toast("Copy failed: " + (err && err.message ? err.message : err), true);
    } finally {
      setBusy(false);
    }
  }

  async function copyScreenshotOnly() {
    setBusy(true);
    try {
      const png = await dataUrlToBlob(await requestScreenshot());
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      toast("Screenshot copied — paste into any AI chat");
    } catch (_err) {
      toast("Screenshot failed — press Alt+L, then try again.", true);
    } finally {
      setBusy(false);
    }
  }

  $("lens-copy-ai").addEventListener("click", copyForAI);
  $("lens-copy-text").addEventListener("click", copyTextOnly);
  $("lens-copy-shot").addEventListener("click", copyScreenshotOnly);

  /* ---------- global on/off (toolbar popup toggle) ---------- */
  function applyEnabled(enabled) {
    host.style.display = enabled ? "" : "none";
  }

  chrome.storage.sync.get({ [STORAGE_KEY]: true }, (v) => {
    applyEnabled(v[STORAGE_KEY] !== false);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[STORAGE_KEY]) {
      applyEnabled(changes[STORAGE_KEY].newValue !== false);
    }
  });
})();
