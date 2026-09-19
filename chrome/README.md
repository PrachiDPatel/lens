# Lens — show, don't screenshot

Lens is a tiny Chrome extension for the "what am I looking at?" moment. Instead
of taking screenshots and re-typing context, you open a small panel on any page,
type your question, and copy everything — the visible tab's screenshot, the
page title, URL, and text — to the clipboard in one click. Paste it straight
into any chat.

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (`chrome/`).
4. Pin Lens to the toolbar if you like (puzzle icon → pin).

No build step, no dependencies.

## Use

- A small circular button floats at the bottom-right of every page. Drag it
  anywhere; click it (or press **Alt+L** / **⌘⇧L** on Mac) to open the panel.
  Drag the panel by its header.
- The panel shows the page title + URL, what will be captured, and a box for
  your question.
- **With an API key saved** (see below), the primary button is **Send to
  Claude**: type your question and press **Enter** (or click the button). The
  panel automatically captures the screenshot, the page text, and the
  console errors + failed requests it has been collecting, sends everything
  straight to Claude, and renders the answer in the panel with a **Copy
  response** button. No copy-paste at any step.
- **Without a key**, the primary button is **Copy for AI** — the screenshot
  *and* a markdown bundle (your question first, then `Page: <title> (<url>)`,
  then the picked element, console errors, and page text) as a single
  clipboard item. **Copy text only** and **Screenshot only** are underneath.
- **Pick element** — click a broken element on the page (Esc cancels) to
  attach its HTML, bounding box, and key computed styles to the next send.
- **Save before shot** — saves the current screenshot; the next send includes
  both the before and after screenshots so Claude can compare.
- **Full page: off/on** — stitches the whole page (scroll + capture + stitch)
  instead of just the viewport. Falls back to the viewport automatically if
  the page is too tall or anything fails.
- Follow-up questions reuse the last capture — the panel shows **"Using
  capture from 2:14 PM · Re-capture"**. Hit Re-capture (or change pages) for
  a fresh one.
- The ⚙ gear in the panel header (or **API settings** in the toolbar popup)
  opens the API settings page.
- The toolbar popup has one switch: show/hide the floating button everywhere.
  It syncs across your signed-in Chrome instances.

Console errors, unhandled promise rejections, and failed `fetch`/`XHR`
requests are collected by a tiny page-context script from the moment the page
loads (top frame only). Only failures are recorded — successful requests are
never touched — and the collector is wrapped so it can never break the page.

## Direct-send to Claude (optional — bring your own key)

Copy-paste is the default and needs nothing. If you'd rather skip the
clipboard, you can send page context straight to Claude:

1. Open **API settings** (⚙ in the panel header).
2. Pick Anthropic, paste an API key, hit **Save**. The key is validated
   against the models endpoint; on success the model dropdown fills with the
   models on your account and you'll see "Key saved — N models available".
3. Pick a model. Back on any page, **Send to Claude** is now the panel's big
   primary button (the copy buttons stay underneath as fallback).
4. Type your question, press **Enter** or click **Send to Claude**. The panel
   captures the screenshot (+ console errors and any element you picked)
   automatically, then renders the answer in a scrollable area with a **Copy
   response** button. If the screenshot isn't available (the permission edge
   below), the request goes out text-only instead of failing.

### Privacy note

The key is stored in your browser profile's local storage. It is **not
encrypted at rest** — anyone with access to the profile could read it, so use
a key you can rotate. Requests go directly from your browser to
`api.anthropic.com`; there is no middleman. The key is only ever sent to
Anthropic, and only when you explicitly trigger it: validating/saving a key in
API settings, or sending from the panel (Send button or Enter). Validation and
direct-send run in the extension's service worker, so page scripts never see
the key.

### A note on screenshots

Chrome only lets an extension capture the tab right after you've invoked it
(toolbar click or the keyboard shortcut). If you open the panel by clicking the
floating button, the first screenshot attempt may fall back to text-only with a
note saying so — just press **Alt+L** once and retry; from then on screenshots
work from the button too.

## Permissions — why each one

| Permission | Why |
|---|---|
| `activeTab` | Lets the extension screenshot the tab you're looking at, and only after you invoke it. No access to tabs you haven't touched. |
| `scripting` | Fallback: if a page loaded before Lens was installed, the shortcut can inject the panel on demand instead of asking you to reload. |
| `storage` | Remembers the floating button's on/off toggle, plus your saved API key (local) and model choice (synced). |
| content script on `<all_urls>` | This is what puts the floating button on every page — the whole point of the tool. The script only reads the page's title, URL, and visible text when you click a copy/send button; it sends nothing anywhere on its own. A second tiny script runs in the page's own context (`collector.js`) to catch console errors and failed requests from page load onward; it reports failures to the panel via DOM events and can never modify the page. |

That's it. No host permissions beyond the content script itself, no analytics.
The only network calls Lens ever makes are the ones you trigger: key
validation and direct-send, both straight to `api.anthropic.com`.

## Files

- `manifest.json` — Manifest V3 declaration (permissions, shortcut, popup, options page).
- `background.js` — service worker: tab capture, keyboard-shortcut toggle, and the Anthropic calls (key validation + direct-send, including before/after screenshots).
- `content.js` — floating button + panel UI (shadow DOM), drag logic, page
  text extraction, the capture pipeline (viewport + full-page stitch), element
  picker, pinned captures, clipboard writes, Send to Claude flow.
- `collector.js` — page-context (MAIN world) collector for console errors,
  unhandled rejections, and failed fetch/XHR requests. Reports to the content
  script via DOM events; cannot break the host page.
- `options.html` / `options.js` — API settings page: provider, key save +
  validation, model picker, privacy note.
- `popup.html` / `popup.js` — toolbar popup with the global on/off toggle and a link to API settings.
