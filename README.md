# Lens — show, don't screenshot

Stop taking manual screenshots to ask an AI about your screen. Lens captures
rich context in one click — screenshot, page text, console errors — and either
copies it as a bundle or sends it straight to Claude with your own API key.

No backend, no accounts, no telemetry. The clipboard is the default transport;
direct-send is optional, bring-your-own-key.

## The five core interactions

1. **Ask (Chrome)** — `Alt+L` (Mac: `⌘⇧L`) or click the floating button. Type
   your question, press Enter. Lens captures the tab's screenshot, structured
   page text, and console errors + failed requests, shows each as a **context
   chip** (click one to drop it from this send), and streams Claude's answer
   into the panel with a **Stop** button.
2. **Error badge (Chrome)** — a console error or failed request while the panel
   is closed puts a pulsing red dot on the floating button. Click it and the
   panel opens with the error attached, input focused. Detection is automatic;
   nothing is ever sent without your click.
3. **Pick (Chrome)** — click a broken element on the page (Esc cancels) to
   attach its HTML, bounding box, and key computed styles.
4. **Follow-ups (Chrome)** — follow-up questions reuse the pinned capture — no
   re-capture. Each follow-up sends only the new question, errors since the
   last send, and the session transcript tail (last ~6 turns). Changing pages
   resets the session.
5. **Ask about this code (VS Code)** — command palette, right-click, or the
   Lens sidebar: **Send to Claude** captures your file or selection + problems
   + open files (+ attached terminal output), streams the answer into the
   sidebar, and keeps the conversation transcript per workspace (**Clear chat**
   wipes it). **Copy code context for AI** and **Ask Copilot about this code**
   work without any key.

## First run

- **Chrome:** open the panel with `Alt+L` / `⌘⇧L`. With no key saved, the
  panel itself walks you through it: paste your Anthropic API key → it
  validates against `/v1/models` → pick a model from your account's own list →
  the question box appears. No settings page needed; the options page stays for
  key rotation and deletion.
- **VS Code:** run **Lens: Set Anthropic API key** from the command palette,
  paste the key, pick a model — the sidebar's **Send to Claude** button
  appears.

## What gets captured

- **Automatically on a send:** the visible tab's screenshot (the panel hides
  itself during capture), structured page text (headings → interactive elements
  with accessible names → form fields → body text, ~8k characters), console
  errors + failed requests, and the picked element if any. VS Code sends text
  only — no screenshots.
- **On demand:** full-page screenshot stitch, before/after screenshot pair,
  re-capture, terminal command output (VS Code).
- **Never:** password field values are never included in page text; URL params
  named `token`, `key`, `secret`, `auth`, `session`, or `password` are redacted
  to `[redacted]`; nothing is captured or sent without an explicit user action
  (pressing Enter, clicking Send, clicking a copy button).

## Keys — honestly stored

- **Chrome:** your key lives in the browser's local storage. It is **not
  encrypted at rest** — anyone with access to the browser profile could read
  it, so use a dedicated key you can rotate. It is read at send time and sent
  only to `api.anthropic.com` — key validation and sends, both triggered by
  you.
- **VS Code:** your key lives in VS Code's SecretStorage — the OS keychain
  (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux).
  Never in a settings file.

Everything goes from your machine straight to `api.anthropic.com`. No
middleman, no analytics, nothing phones home.

## The three pieces

| Tool | Where it lives | What it does |
|---|---|---|
| `chrome/` | Chrome toolbar + any page | Floating button + panel: Ask, error badge, Pick, follow-ups — direct-send or copy. |
| `vscode/` | VS Code | Sidebar + commands: capture code context, Send to Claude (streaming + session transcript), Ask Copilot, or copy for any AI chat. |
| `action/` | GitHub Actions | On push, screenshots a deployed URL at desktop + mobile sizes with Playwright and uploads the PNGs as artifacts — with optional `base-url` visual diffs. |

## Try it

- **Chrome:** `chrome://extensions` → Developer mode → Load unpacked → select `chrome/`. Press `Alt+L` (Mac: `⌘⇧L`) on any page. Note: open the panel with the shortcut or a toolbar click first — that's what grants the one-time permission screenshots need.
- **VS Code:** open `vscode/` in VS Code, press `F5` for a dev host. Or `npx vsce package` and install the `.vsix`.
- **Action:** copy `action/` into a repo (e.g. `PrachiDPatel/lens/action@main`), add the example workflow with your deployed URL.

Each folder has its own README with details.

## Links

- Repo: https://github.com/PrachiDPatel/lens
- Landing page: https://prachidpatel.github.io/lens/
- Releases: https://github.com/PrachiDPatel/lens/releases
