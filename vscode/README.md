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
- **Lens: Open Lens panel** (`lens.openPanel`) — opens the Lens sidebar, with a
  question box, include-checkboxes (file/selection, problems, open files), and
  a Copy button that runs the same capture using your typed question.
- Also available from the editor right-click menu when text is focused.

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
- `extension.js` — all logic: capture, bundle building, clipboard, webview.
- `media/lens.svg` — activity-bar icon.
