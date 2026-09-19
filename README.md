# Lens — show, don't screenshot

One idea, three tools: stop taking manual screenshots to ask an AI about what's
on your screen. Capture rich context in one click and paste it into any AI chat
(Muse, Claude, anything else). No backend, no API keys, no accounts — the
clipboard is the transport.

## The three pieces

| Tool | Where it lives | What it does |
|---|---|---|
| `chrome/` | Chrome toolbar + any page | Floating draggable button on every page. Opens a small panel: type your question, hit **Copy for AI**, and the tab's screenshot + page text + your question land on the clipboard together. |
| `vscode/` | VS Code | Command palette / right-click / sidebar panel: **Lens: Copy code context for AI**. Copies your question + the file or selection + errors/warnings + open files as markdown. |
| `action/` | GitHub Actions | On push, screenshots a deployed URL at desktop + mobile sizes with Playwright and uploads the PNGs as artifacts — so the UI review loop never needs a manual screenshot again. |

## Try it

- **Chrome:** `chrome://extensions` → Developer mode → Load unpacked → select `chrome/`. Press `Alt+L` (Mac: `Cmd+Shift+L`) on any page. Note: open the panel with the shortcut or a toolbar click first — that's what grants the one-time permission screenshots need.
- **VS Code:** open `vscode/` in VS Code, press `F5` for a dev host. Or `npx vsce package` and install the `.vsix`.
- **Action:** copy `action/` into a repo (e.g. `PrachiDPatel/lens/action@main`), add the example workflow with your deployed URL.

Each folder has its own README with details.
