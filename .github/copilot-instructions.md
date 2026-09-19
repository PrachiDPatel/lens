# Lens — repo instructions

Lens ("show, don't screenshot") is a small developer tool with three parts:

- `chrome/` — Manifest V3 Chrome extension. A floating draggable button on any
  page opens a panel: type a question, and the tab's screenshot plus page text
  are copied to the clipboard together as one paste-ready bundle — or, if the
  user saves their own Anthropic API key in the options page, sent straight to
  Claude with the Send to Claude button.
- `vscode/` — VS Code extension. Captures the active file or selection,
  problems, and open files as markdown; copies it to the clipboard, or sends
  it directly to GitHub Copilot chat models through the `vscode.lm` API and
  streams the answer into the sidebar panel.
- `action/` — Composite GitHub Action. Screenshots a deployed URL at desktop
  and mobile sizes with Playwright and uploads the PNGs as artifacts.

Design principles: the clipboard is the default transport — no backend, no
account, works with any AI chat. API keys are strictly bring-your-own and
optional (Chrome direct-send, VS Code Copilot via the user's own Copilot
subscription). Keep permissions minimal, keep the UI small,
and don't add AI-vendor branding.
