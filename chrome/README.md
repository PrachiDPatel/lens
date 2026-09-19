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
- The toolbar popup has one switch: show/hide the floating button everywhere.
  It syncs across your signed-in Chrome instances.

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
| `storage` | Remembers the floating button's on/off toggle. |

That's it. No host permissions beyond the content script itself, no external
network calls, no analytics, nothing leaves your machine except what you
explicitly copy.

## Files

- `manifest.json` — Manifest V3 declaration (permissions, shortcut, popup).
- `background.js` — service worker: tab capture + keyboard-shortcut toggle.
- `content.js` — floating button + panel UI (shadow DOM), drag logic, page
  text extraction, clipboard writes.
- `popup.html` / `popup.js` — toolbar popup with the global on/off toggle.
