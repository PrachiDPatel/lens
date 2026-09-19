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
  your question: **"Ask about this page…"**.
- **Copy for AI** — copies the screenshot *and* a markdown bundle (your
  question first, then `Page: <title> (<url>)`, then the page text, truncated
  to ~8,000 chars) as a single clipboard item. One paste carries both.
- **Copy text only** — the markdown bundle without the screenshot.
- **Screenshot only** — just the PNG.
- The ⚙ gear in the panel header (or **API settings** in the toolbar popup)
  opens the API settings page.
- The toolbar popup has one switch: show/hide the floating button everywhere.
  It syncs across your signed-in Chrome instances.

## Direct-send to Claude (optional — bring your own key)

Copy-paste is the default and needs nothing. If you'd rather skip the
clipboard, you can send page context straight to Claude:

1. Open **API settings** (⚙ in the panel header).
2. Pick Anthropic, paste an API key, hit **Save**. The key is validated
   against the models endpoint; on success the model dropdown fills with the
   models on your account and you'll see "Key saved — N models available".
3. Pick a model. Back on any page, the panel now has a **Send to Claude**
   button next to **Copy for AI**.
4. Type your question, hit **Send to Claude**. The panel shows "Sending…",
   then renders the answer in a scrollable area with a **Copy response**
   button. If the screenshot isn't available (the permission edge below), the
   request goes out text-only instead of failing.

### Privacy note

The key is stored in your browser profile's local storage. It is **not
encrypted at rest** — anyone with access to the profile could read it, so use
a key you can rotate. Requests go directly from your browser to
`api.anthropic.com`; there is no middleman. The key is only ever sent to
Anthropic, and only when you explicitly trigger it: validating/saving a key in
API settings, or clicking **Send to Claude**. Validation and
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
| content script on `<all_urls>` | This is what puts the floating button on every page — the whole point of the tool. The script only reads the page's title, URL, and visible text when you click a copy/send button; it sends nothing anywhere on its own. |

That's it. No host permissions beyond the content script itself, no analytics.
The only network calls Lens ever makes are the ones you trigger: key
validation and direct-send, both straight to `api.anthropic.com`.

## Files

- `manifest.json` — Manifest V3 declaration (permissions, shortcut, popup, options page).
- `background.js` — service worker: tab capture, keyboard-shortcut toggle, and the Anthropic calls (key validation + direct-send).
- `content.js` — floating button + panel UI (shadow DOM), drag logic, page
  text extraction, clipboard writes, Send to Claude flow.
- `options.html` / `options.js` — API settings page: provider, key save +
  validation, model picker, privacy note.
- `popup.html` / `popup.js` — toolbar popup with the global on/off toggle and a link to API settings.
