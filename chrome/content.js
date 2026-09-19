/* Lens — content script.
 *
 * Renders a floating button + panel inside a shadow DOM so page CSS can
 * never break it. Primary flow: type a question, press Enter (or Send to
 * Claude) — the panel automatically captures the screenshot, page text,
 * console errors, and failed requests, then sends everything straight to
 * Claude with your saved API key. Copy buttons remain as the no-key
 * fallback.
 */
(() => {
  "use strict";

  // Guard against double-injection (e.g. SPA navigations re-running us).
  if (window.__lensInjected) return;
  window.__lensInjected = true;

  const MAX_TEXT_CHARS = 8000; // how much page text goes into the bundle
  const MAX_DIAG_CHARS = 4000; // cap on the console/request diagnostics
  const MAX_LOG = 50; // console/request entries kept per tab
  const FULLPAGE_MAX_SEGMENTS = 10; // stitch cap; taller pages fall back
  const STORAGE_KEY = "lensEnabled";
  const API_KEY_STORE = "lensApiKey"; // chrome.storage.local — presence enables direct-send

  /* Console errors + failed requests, forwarded by collector.js (which runs
   * in the page's MAIN world and reports via "lens-collect" DOM events). */
  const errorLog = [];
  window.addEventListener("lens-collect", (e) => {
    try {
      if (!e || !e.detail) return;
      errorLog.push(e.detail);
      if (errorLog.length > MAX_LOG) errorLog.splice(0, errorLog.length - MAX_LOG);
    } catch (_err) {}
  });

  /* ---------- state ---------- */
  let lensEnabled = true;
  let pinned = null; // last send capture, reused for follow-up questions
  let beforeShot = null; // saved "before" screenshot, sent with the next send
  let selectedElement = null; // describeElement() result from the picker
  let fullPageMode = false;
  let picking = false;

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
    #lens-meta { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: #9aa0ae; }
    #lens-meta [hidden] { display: none; }
    #lens-meta code { font-family: ui-monospace, monospace; color: #c9cedb; font-size: 11px; }
    #lens-meta button.lens-link {
      background: none; border: 0; color: #7aa2ff; cursor: pointer;
      font: inherit; font-size: inherit; padding: 0;
    }
    #lens-meta button.lens-link:hover { text-decoration: underline; }
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
    #lens-actions button.lens-primary { background: #3b6fe0; border-color: #3b6fe0; color: #fff; }
    #lens-actions button.lens-primary:hover:not(:disabled) { background: #4a7ef0; }
    #lens-tools, #lens-fallback { display: flex; flex-wrap: wrap; gap: 8px; }
    #lens-tools button, #lens-fallback button {
      flex: 1 1 auto; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
      border-radius: 8px; padding: 7px 8px; border: 1px solid rgba(255,255,255,.14);
      background: #242932; color: #c9cedb;
    }
    #lens-tools button:hover:not(:disabled), #lens-fallback button:hover:not(:disabled) { background: #2e3440; }
    #lens-fullpage[aria-pressed="true"] { background: #274b8f; border-color: #3b6fe0; color: #fff; }
    #lens-body button:disabled { opacity: .5; cursor: default; }
    #lens-toast {
      background: #0f5132; color: #d8f3e3; border-radius: 8px;
      padding: 8px 10px; font-size: 12.5px; text-align: center;
    }
    #lens-toast[hidden] { display: none; }
    #lens-toast.lens-err { background: #5c1a1a; color: #f6d9d9; }
    #lens-response {
      max-height: 220px; overflow-y: auto; white-space: pre-wrap; word-break: break-word;
      background: #12151c; border: 1px solid rgba(255,255,255,.12);
      border-radius: 8px; padding: 8px 10px; font-size: 12.5px;
    }
    #lens-response[hidden] { display: none; }
    #lens-copy-response {
      font: inherit; font-weight: 600; cursor: pointer; border-radius: 9px;
      padding: 8px 10px; border: 1px solid rgba(255,255,255,.14);
      background: #2a2f3a; color: #e8eaf0; width: 100%;
    }
    #lens-copy-response:hover { background: #343b48; }
    #lens-copy-response[hidden] { display: none; }
    #lens-pick-overlay {
      position: fixed; inset: 0; cursor: crosshair; z-index: 3;
      background: transparent; pointer-events: auto;
    }
    #lens-pick-highlight {
      position: fixed; z-index: 4; border: 2px solid #3b6fe0;
      background: rgba(59,111,224,.12); pointer-events: none;
    }
    #lens-pick-hint {
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
      z-index: 4; background: #1c1f26; color: #e8eaf0;
      border: 1px solid rgba(255,255,255,.14); border-radius: 8px;
      padding: 8px 12px; font-size: 12.5px; pointer-events: none; white-space: nowrap;
    }
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
        <button id="lens-settings" title="API settings" aria-label="API settings">⚙</button>
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
      <div id="lens-meta">
        <div id="lens-pin-line" hidden>Using capture from <span id="lens-pin-time"></span> · <button class="lens-link" id="lens-recapture">Re-capture</button></div>
        <div id="lens-el-line" hidden>Picked <code id="lens-el-name"></code> · <button class="lens-link" id="lens-el-clear">Clear</button></div>
        <div id="lens-before-line" hidden>Before shot saved · <button class="lens-link" id="lens-before-clear">Clear</button></div>
      </div>
      <textarea id="lens-q" placeholder="Ask about this page… (Enter to send)"></textarea>
      <div id="lens-actions">
        <button id="lens-send" class="lens-primary" hidden>Send to Claude</button>
        <button id="lens-copy-ai" class="lens-primary">Copy for AI</button>
      </div>
      <div id="lens-tools">
        <button id="lens-pick" title="Click an element on the page to attach its HTML and styles">Pick element</button>
        <button id="lens-before" title="Save the current screenshot to send alongside the next one">Save before shot</button>
        <button id="lens-fullpage" aria-pressed="false" title="Stitch the full page instead of just the viewport">Full page: off</button>
      </div>
      <div id="lens-fallback">
        <button id="lens-copy-text">Copy text only</button>
        <button id="lens-copy-shot">Screenshot only</button>
      </div>
      <div id="lens-response" hidden></div>
      <button id="lens-copy-response" hidden>Copy response</button>
      <div id="lens-toast" hidden></div>
    </div>`;
  shadow.appendChild(panel);

  const $ = (id) => shadow.getElementById(id);
  const header = $("lens-header");
  const body = $("lens-body");
  const titleEl = panel.querySelector(".lens-title");
  const urlEl = panel.querySelector(".lens-url");
  const noteEl = $("lens-note");
  const pinLine = $("lens-pin-line");
  const pinTime = $("lens-pin-time");
  const elLine = $("lens-el-line");
  const elName = $("lens-el-name");
  const beforeLine = $("lens-before-line");
  const questionEl = $("lens-q");
  const toastEl = $("lens-toast");
  const responseEl = $("lens-response");
  const copyResponseBtn = $("lens-copy-response");
  const sendBtn = $("lens-send");
  const copyAiBtn = $("lens-copy-ai");
  const fullpageBtn = $("lens-fullpage");

  function setHostVisible(v) {
    host.style.display = v ? "" : "none";
  }

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
  function setPanel(open) {
    panel.hidden = !open;
    if (open) {
      body.classList.remove("lens-min");
      refreshPageInfo();
      renderMeta();
      refreshPrimary();
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

  function refreshPageInfo() {
    titleEl.textContent = document.title || "(no title)";
    titleEl.title = titleEl.textContent;
    urlEl.textContent = location.href;
    urlEl.title = location.href;
    noteEl.textContent =
      "Captures on send: screenshot" +
      (fullPageMode ? " (full page)" : "") +
      " + page text + console errors & failed requests.";
  }

  /* ---------- pinned / picked / before meta lines ---------- */
  function fmtTime(t) {
    try {
      return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (_e) {
      return "";
    }
  }

  function renderMeta() {
    const showPin = pinned && pinned.url === location.href;
    pinLine.hidden = !showPin;
    if (showPin) pinTime.textContent = fmtTime(pinned.time);
    elLine.hidden = !selectedElement;
    if (selectedElement) {
      const s = selectedElement;
      elName.textContent =
        "<" + s.tag + (s.id ? "#" + s.id : "") +
        (s.classes.length ? "." + s.classes.slice(0, 3).join(".") : "") + ">";
    }
    beforeLine.hidden = !beforeShot;
  }

  $("lens-recapture").addEventListener("click", () => {
    pinned = null;
    renderMeta();
    sendToClaude(true);
  });
  $("lens-el-clear").addEventListener("click", () => {
    selectedElement = null;
    renderMeta();
  });
  $("lens-before-clear").addEventListener("click", () => {
    beforeShot = null;
    renderMeta();
  });

  /* ---------- page text + diagnostics ---------- */
  function pageText() {
    const el = document.body || document.documentElement;
    const raw = el && el.innerText ? el.innerText : "";
    const cleaned = raw.replace(/\n{3,}/g, "\n\n").trim();
    if (cleaned.length > MAX_TEXT_CHARS) {
      return cleaned.slice(0, MAX_TEXT_CHARS) + "\n…[text truncated]";
    }
    return cleaned;
  }

  function diagnosticsText() {
    if (!errorLog.length) return "";
    const lines = [];
    for (const e of errorLog) {
      try {
        if (e.kind === "request") {
          const status = e.status ? "HTTP " + e.status : "network error";
          lines.push(
            "- [" + (e.method || "?") + "] " + (e.url || "") + " → " + status +
            (e.error ? " (" + e.error + ")" : "")
          );
        } else {
          const where = e.source ? " (" + e.source + (e.line ? ":" + e.line : "") + ")" : "";
          lines.push("- " + (e.kind || "error") + ": " + (e.message || "") + where);
        }
      } catch (_err) {}
    }
    let out = "Console errors & failed requests (oldest first):\n" + lines.join("\n");
    if (out.length > MAX_DIAG_CHARS) {
      out = out.slice(0, MAX_DIAG_CHARS) + "\n…[diagnostics truncated]";
    }
    return out;
  }

  function elementText() {
    if (!selectedElement) return "";
    const s = selectedElement;
    const ident =
      s.tag + (s.id ? "#" + s.id : "") +
      (s.classes.length ? "." + s.classes.slice(0, 8).join(".") : "");
    return (
      "Selected element: <" + ident + "> at (" + s.rect.x + ", " + s.rect.y + "), " +
      s.rect.width + "×" + s.rect.height + "\nComputed styles: " + s.styles +
      "\nHTML (truncated):\n" + s.html
    );
  }

  // Markdown bundle for the copy flows.
  function buildBundle() {
    const question = questionEl.value.trim();
    const parts = [];
    if (question) parts.push(question, "");
    parts.push(`Page: ${document.title || "(no title)"} (${location.href})`, "");
    const el = elementText();
    if (el) parts.push(el, "");
    const diag = diagnosticsText();
    if (diag) parts.push(diag, "");
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

  /* ---------- screenshots ---------- */
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

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed"));
      img.src = dataUrl;
    });
  }

  // Best-effort full-page capture: scroll through the page, capture each
  // viewport, stitch on a canvas. Returns {dataUrl, segments}, or null when
  // the page isn't scrollable, is too tall, or anything fails.
  async function captureFullPage() {
    let scrollY = 0;
    try {
      scrollY = window.scrollY || 0;
      const viewportH = window.innerHeight || 0;
      if (!viewportH) return null;
      const doc = document.documentElement;
      const bd = document.body;
      const totalH = Math.max(
        bd ? bd.scrollHeight : 0,
        doc ? doc.scrollHeight : 0,
        viewportH
      );
      const count = Math.ceil(totalH / viewportH);
      if (count < 2 || count > FULLPAGE_MAX_SEGMENTS) return null;

      const shots = [];
      for (let i = 0; i < count; i++) {
        window.scrollTo(0, i * viewportH);
        await sleep(200);
        shots.push(await requestScreenshot());
      }
      const imgs = await Promise.all(shots.map(loadImage));
      const w = imgs[0].naturalWidth;
      const totalPx = imgs.reduce((a, im) => a + im.naturalHeight, 0);
      if (!w || totalPx > 16000) return null;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = totalPx;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      let y = 0;
      for (const im of imgs) {
        ctx.drawImage(im, 0, y, w, im.naturalHeight);
        y += im.naturalHeight;
      }
      return { dataUrl: canvas.toDataURL("image/png"), segments: count };
    } catch (_err) {
      return null;
    } finally {
      try {
        window.scrollTo(0, scrollY);
      } catch (_e) {}
    }
  }

  // Capture for a send or a before-shot: hide the panel first so it never
  // appears in the screenshots.
  async function captureForSend() {
    setHostVisible(false);
    try {
      if (fullPageMode) {
        const full = await captureFullPage();
        if (full) {
          return {
            dataUrl: full.dataUrl,
            label: `full page, stitched from ${full.segments} captures`,
          };
        }
      }
      const dataUrl = await requestScreenshot();
      return {
        dataUrl,
        label: fullPageMode ? "viewport (full-page stitch failed)" : "viewport",
      };
    } finally {
      setHostVisible(lensEnabled);
    }
  }

  function dataUrlToBlob(dataUrl) {
    return fetch(dataUrl).then((r) => r.blob());
  }

  function dataUrlToBase64(dataUrl) {
    const prefix = "data:image/png;base64,";
    return dataUrl.startsWith(prefix) ? dataUrl.slice(prefix.length) : null;
  }

  function setBusy(busy) {
    panel.querySelectorAll("button").forEach((b) => {
      b.disabled = busy;
    });
  }

  /* ---------- the three copy actions (no-key fallback) ---------- */

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
  $("lens-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  copyResponseBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(responseEl.textContent);
      toast("Response copied");
    } catch (_err) {
      toast("Copy failed", true);
    }
  });

  /* ---------- element picker ---------- */

  function describeElement(el) {
    const rect = el.getBoundingClientRect();
    let styles = "";
    try {
      const cs = getComputedStyle(el);
      styles = ["display", "position", "color", "background-color", "font-size",
        "width", "height", "margin", "padding"]
        .map((p) => p + ": " + cs.getPropertyValue(p))
        .join("; ");
    } catch (_e) {}
    let html = "";
    try {
      html = (el.outerHTML || "").slice(0, 2000);
    } catch (_e) {}
    let classes = [];
    try {
      if (typeof el.className === "string") {
        classes = el.className.trim().split(/\s+/).filter(Boolean);
      }
    } catch (_e) {}
    return {
      tag: (el.tagName || "?").toLowerCase(),
      id: el.id || "",
      classes,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      styles,
      html,
    };
  }

  function startPicking() {
    if (picking) return;
    picking = true;
    setPanel(false);

    const overlay = document.createElement("div");
    overlay.id = "lens-pick-overlay";
    const highlight = document.createElement("div");
    highlight.id = "lens-pick-highlight";
    highlight.hidden = true;
    const hint = document.createElement("div");
    hint.id = "lens-pick-hint";
    hint.textContent = "Click an element to attach it · Esc to cancel";
    shadow.appendChild(overlay);
    shadow.appendChild(highlight);
    shadow.appendChild(hint);

    let current = null;

    const move = (e) => {
      try {
        // The overlay covers everything, so hide it for one synchronous
        // lookup, then show it again before the next paint.
        overlay.style.display = "none";
        current = document.elementFromPoint(e.clientX, e.clientY) || null;
        overlay.style.display = "";
        if (current) {
          const r = current.getBoundingClientRect();
          highlight.hidden = false;
          highlight.style.left = r.left + "px";
          highlight.style.top = r.top + "px";
          highlight.style.width = r.width + "px";
          highlight.style.height = r.height + "px";
        } else {
          highlight.hidden = true;
        }
      } catch (_err) {}
    };

    const stop = () => {
      picking = false;
      overlay.removeEventListener("mousemove", move);
      overlay.removeEventListener("click", click);
      window.removeEventListener("keydown", key, true);
      overlay.remove();
      highlight.remove();
      hint.remove();
    };

    const click = (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (current) {
          selectedElement = describeElement(current);
          renderMeta();
          toast("Element attached — it goes out with your next send");
        }
      } catch (_err) {}
      stop();
    };

    const key = (e) => {
      if (e.key === "Escape") stop();
    };

    overlay.addEventListener("mousemove", move);
    overlay.addEventListener("click", click);
    window.addEventListener("keydown", key, true);
  }

  $("lens-pick").addEventListener("click", startPicking);

  /* ---------- before shot ---------- */

  $("lens-before").addEventListener("click", async () => {
    setBusy(true);
    try {
      const shot = await captureForSend();
      beforeShot = { dataUrl: shot.dataUrl, time: Date.now() };
      renderMeta();
      toast("Before shot saved — send to compare");
    } catch (_err) {
      toast("Before shot failed", true);
    } finally {
      setBusy(false);
    }
  });

  /* ---------- full-page toggle ---------- */

  fullpageBtn.addEventListener("click", () => {
    fullPageMode = !fullPageMode;
    fullpageBtn.setAttribute("aria-pressed", String(fullPageMode));
    fullpageBtn.textContent = fullPageMode ? "Full page: on" : "Full page: off";
    refreshPageInfo();
  });

  /* ---------- direct-send to Claude (bring your own key) ---------- */

  // The Send button is the primary action once a key is saved; otherwise
  // Copy for AI stays primary and the copy buttons are the fallback.
  function refreshPrimary() {
    chrome.storage.local.get({ [API_KEY_STORE]: null }, (v) => {
      const keyed = !!v[API_KEY_STORE];
      sendBtn.hidden = !keyed;
      copyAiBtn.classList.toggle("lens-primary", !keyed);
    });
  }

  function showResponse(text) {
    responseEl.textContent = text;
    responseEl.hidden = false;
    copyResponseBtn.hidden = false;
  }

  function hideResponse() {
    responseEl.hidden = true;
    copyResponseBtn.hidden = true;
  }

  function sendMessageAsync(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(resp);
        }
      });
    });
  }

  function hasApiKey() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ [API_KEY_STORE]: null }, (v) => {
          resolve(!!v[API_KEY_STORE]);
        });
      } catch (_e) {
        resolve(false);
      }
    });
  }

  // The main submit: Enter in the question box, or the primary button.
  async function primarySubmit() {
    if (await hasApiKey()) sendToClaude(false);
    else copyForAI();
  }

  questionEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      primarySubmit();
    }
  });

  $("lens-send").addEventListener("click", () => sendToClaude(false));

  async function sendToClaude(forceFresh) {
    hideResponse();
    setBusy(true);
    try {
      // A pinned capture belongs to the page it was taken on.
      if (pinned && pinned.url !== location.href) pinned = null;

      const question = questionEl.value.trim();
      const elText = elementText(); // the picked element is always current

      let shotDataUrl = null;
      let shotLabel = "unavailable";
      let text = null;
      let diag = null;
      let reused = false;

      if (pinned && !forceFresh) {
        shotDataUrl = pinned.dataUrl;
        shotLabel = pinned.label;
        text = pinned.pageText;
        diag = pinned.diag;
        reused = true;
      } else {
        toast("Capturing…");
        try {
          const shot = await captureForSend();
          shotDataUrl = shot.dataUrl;
          shotLabel = shot.label;
          text = pageText();
          diag = diagnosticsText();
          pinned = {
            dataUrl: shotDataUrl,
            label: shotLabel,
            pageText: text,
            diag,
            title: document.title,
            url: location.href,
            time: Date.now(),
          };
        } catch (_capErr) {
          if (pinned) {
            // Re-capture failed (e.g. the permission edge) — fall back to
            // the saved capture rather than failing the send.
            shotDataUrl = pinned.dataUrl;
            shotLabel = pinned.label;
            text = pinned.pageText;
            diag = pinned.diag;
            reused = true;
            toast("Capture failed — using last saved capture");
          }
        }
        if (!shotDataUrl && !reused) {
          text = pageText();
          diag = diagnosticsText();
        }
      }

      toast("Sending…");
      const resp = await sendMessageAsync({
        type: "lens-send",
        question,
        title: document.title || "(no title)",
        url: location.href,
        shotLabel: reused ? shotLabel + " (saved capture)" : shotLabel,
        elementText: elText,
        diagText: diag,
        pageText: text || "",
        imageBase64: shotDataUrl ? dataUrlToBase64(shotDataUrl) : null,
        beforeBase64: beforeShot && beforeShot.dataUrl
          ? dataUrlToBase64(beforeShot.dataUrl)
          : null,
      });
      const err = resp ? resp.error : null;
      const status = resp ? resp.status : 0;
      if (!resp || !resp.ok) {
        if (err === "auth" || status === 401 || status === 403) {
          toast("Check your API key in Settings.", true);
        } else if (err === "no-key") {
          toast("Add an API key in Settings first.", true);
        } else if (err === "no-model") {
          toast("Pick a model in Settings first.", true);
        } else {
          toast("Send failed — try again.", true);
        }
        refreshPrimary(); // key may have been removed while the panel was open
        return;
      }
      showResponse(resp.text || "(empty response)");
      toast("Answer received");
      beforeShot = null; // the "before" state has now been answered
      renderMeta();
    } catch (err) {
      toast("Send failed: " + (err && err.message ? err.message : err), true);
    } finally {
      setBusy(false);
    }
  }

  /* ---------- global on/off (toolbar popup toggle) ---------- */
  function applyEnabled(enabled) {
    lensEnabled = enabled;
    setHostVisible(enabled);
  }

  chrome.storage.sync.get({ [STORAGE_KEY]: true }, (v) => {
    applyEnabled(v[STORAGE_KEY] !== false);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[STORAGE_KEY]) {
      applyEnabled(changes[STORAGE_KEY].newValue !== false);
    }
    if (area === "local" && changes[API_KEY_STORE] && !panel.hidden) {
      refreshPrimary();
    }
  });
})();
