# Lens — VS Code extension

Show, don't screenshot.

Lens copies rich code context to your clipboard as a markdown bundle: the file
you're looking at (or just your selection), its problems, and the other files
you have open — plus your question. Paste it into any AI chat instead of
sending screenshots.

## What it does

- **Lens: Copy code context for AI** (`lens.copyContext`) — prompts for your
  question, captures the active editor (selection if you have one, otherwise
  the whole file, truncated at 400 lines), diagnostics for that file, and the
  list of other open files. Copies a markdown bundle and confirms with
  "Lens context copied — paste into any AI chat."
- **Lens: Ask Copilot about this code** (`lens.askCopilot`) — same capture as
  above, but sends your question plus the context straight to GitHub Copilot
  (picked from the models your Copilot Chat extension offers — nothing
  hardcoded) and streams the answer into the Lens sidebar, with a
  **Copy response** button. If Copilot isn't available, it falls back to the
  clipboard copy.
- **Lens: Set Anthropic API key** (`lens.setApiKey`) — prompts for your key
  (typed blind), validates it against the Anthropic API, then lets you pick a
  model from your account's own model list. The key is stored in VS Code's
  SecretStorage — your OS keychain — never in a settings file.
- **Lens: Delete Anthropic API key** (`lens.deleteApiKey`) — removes the key
  from the OS keychain.
- **Lens: Send to Claude** (`lens.sendToClaude`) — same capture as above, but
  sends your question plus the context straight to the Anthropic API with your
  key and renders the reply in the Lens sidebar, with a **Copy response**
  button. Text context only — no screenshot in VS Code. If no key is saved,
  Lens offers to set one.
- **Lens: Open Lens panel** (`lens.openPanel`) — opens the Lens sidebar, with a
  question box, include-checkboxes (file/selection, problems, open files), a
  **Copy context** button, an **Ask Copilot** button, a **Run & attach**
  button, and a **Send to Claude** button (the last one appears only once a
  key is saved).
- **Lens: Run command and attach output** (`lens.runAndAttach`) — prompts for
  a shell command, runs it in the workspace root (60-second timeout), and
  attaches stdout + stderr (capped at 4,000 characters) to the bundle as a
  "Terminal output ($ <cmd>)" section with the exit code, so it flows into
  Copy context, Ask Copilot, and Send to Claude automatically. The panel's
  **Run & attach** button does the same and shows the attached command with
  a **Clear** button to drop it.
- Also available from the editor right-click menu when text is focused.

### GitHub Copilot direct-send

Requires the **GitHub Copilot** and **Copilot Chat** extensions installed and
signed in. When several Copilot chat models are available you'll get a picker;
otherwise the first one is used. If no Copilot chat model is reachable, Lens
shows a note and copies the context to the clipboard instead — the
clipboard flow always works, Copilot or not.

### Anthropic direct-send (bring your own key)

Run **Lens: Set Anthropic API key** from the command palette. Your key goes
straight into VS Code's SecretStorage — the OS keychain (Keychain on macOS,
Credential Manager on Windows, Secret Service on Linux) — and never touches a
settings file, a log, or a URL. Requests go directly from the extension host
to `api.anthropic.com` and nowhere else. The model dropdown comes from your
account's own `/v1/models` list; nothing is hardcoded.

When you hit **Send to Claude**, the captured context plus your question is
POSTed to the Messages API and the reply renders in the Lens sidebar with a
**Copy response** button. Invalid key → a plain "key was rejected" note;
network failure → a plain "couldn't reach" note. The key is never logged or
echoed anywhere.

The bundle looks like:

```markdown
Why is this throwing on line 42?

## File: src/server.js (javascript, selection)
```javascript
...
```

## Problems
- 42:5 [error] Cannot read properties of undefined

## Open files
- src/routes.js
```

With a terminal run attached, the bundle also ends with:

```markdown
## Terminal output ($ npm test) — exit 1
```text
…
[stderr]
…
```
```

## Run in dev

1. Open this folder (`~/workspace/lens/vscode`) in VS Code.
2. Press **F5** — a new Extension Development Host window opens with Lens
   loaded.
3. Open a file, run **Lens: Copy code context for AI** from the command
   palette (or right-click in the editor), or open the Lens sidebar and use
   the panel.

No dependencies to install — the extension uses only the VS Code API.

## Package

Install `vsce` once:

```sh
npm install -g @vscode/vsce
```

Then from this folder:

```sh
vsce package
```

That produces `lens-0.1.0.vsix`, which you can install via
**Extensions → … → Install from VSIX**, or share with others directly.

## Files

- `package.json` — extension manifest: commands, sidebar view, menus.
- `extension.js` — all logic: capture, bundle building, clipboard, Copilot
  direct-send, webview.
- `media/lens.svg` — activity-bar icon.
