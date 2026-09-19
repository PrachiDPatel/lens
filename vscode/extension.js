// Lens — show, don't screenshot.
// Copies rich code context (file or selection, problems, open files) to the
// clipboard as a markdown bundle, ready to paste into any AI chat.

const vscode = require('vscode');

// Caps so one copy never turns into a novel.
const MAX_LINES = 400;
const MAX_PROBLEMS = 30;
const MAX_OPEN_FILES = 20;

/**
 * Gather context about what the user is looking at.
 * @param {{file: boolean, problems: boolean, openFiles: boolean}} include
 * @returns context object describing the current editor state
 */
function captureContext(include) {
  const editor = vscode.window.activeTextEditor;

  // No editor open — the bundle will just carry the question plus a note.
  if (!editor) {
    return { noEditor: true };
  }

  const doc = editor.document;
  const relPath = vscode.workspace.asRelativePath(doc.uri);
  const language = doc.languageId;
  const ctx = { noEditor: false, relPath, language };

  // --- File / selection ---
  if (include.file) {
    const sel = editor.selection;
    const hasSelection = !sel.isEmpty;
    let text = hasSelection ? doc.getText(sel) : doc.getText();
    let lines = text.split('\n');
    ctx.selectionOnly = hasSelection;
    if (lines.length > MAX_LINES) {
      ctx.truncated = { shown: MAX_LINES, total: lines.length };
      lines = lines.slice(0, MAX_LINES);
    }
    ctx.code = lines.join('\n');
  }

  // --- Problems (errors + warnings) for this file ---
  if (include.problems) {
    const diags = vscode.languages.getDiagnostics(doc.uri);
    const items = diags
      .filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning)
      .map((d) => ({
        line: d.range.start.line + 1, // 1-based for humans
        col: d.range.start.character + 1,
        kind: d.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning',
        message: d.message.split('\n')[0], // first line keeps the bundle tight
      }));
    ctx.problems = items.slice(0, MAX_PROBLEMS);
    ctx.problemsTruncated = items.length > MAX_PROBLEMS ? items.length : 0;
  }

  // --- Other open files ---
  if (include.openFiles) {
    const seen = new Set();
    const names = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        // Only plain text editors (skips settings pages, diffs, etc.)
        if (input instanceof vscode.TabInputText) {
          const name = vscode.workspace.asRelativePath(input.uri);
          if (name !== relPath && !seen.has(name)) {
            seen.add(name);
            names.push(name);
          }
        }
      }
    }
    ctx.openFiles = names.slice(0, MAX_OPEN_FILES);
  }

  return ctx;
}

/**
 * Build the markdown bundle that gets copied to the clipboard.
 * @param {string} question what she wants to ask about the code
 * @param {object} ctx from captureContext
 * @returns {string} markdown text
 */
function buildBundle(question, ctx) {
  const parts = [];

  if (question && question.trim()) {
    parts.push(question.trim());
  }

  // No editor — say so plainly instead of faking context.
  if (ctx.noEditor) {
    parts.push('_No editor open — no code context captured._');
    return parts.join('\n\n');
  }

  // --- File / selection ---
  if (ctx.code !== undefined) {
    const scope = ctx.selectionOnly ? 'selection' : 'file';
    parts.push(`## File: ${ctx.relPath} (${ctx.language}, ${scope})`);
    let code = ctx.code;
    if (ctx.truncated) {
      code += `\n…truncated (showing first ${ctx.truncated.shown} of ${ctx.truncated.total} lines)`;
    }
    parts.push('```' + ctx.language + '\n' + code + '\n```');
  }

  // --- Problems ---
  if (ctx.problems !== undefined) {
    if (ctx.problems.length === 0) {
      parts.push('## Problems\nNo problems.');
    } else {
      const lines = ctx.problems.map(
        (p) => `- ${p.line}:${p.col} [${p.kind}] ${p.message}`
      );
      if (ctx.problemsTruncated) {
        lines.push(`…and ${ctx.problemsTruncated - ctx.problems.length} more`);
      }
      parts.push('## Problems\n' + lines.join('\n'));
    }
  }

  // --- Open files ---
  if (ctx.openFiles !== undefined && ctx.openFiles.length > 0) {
    parts.push('## Open files\n' + ctx.openFiles.map((f) => `- ${f}`).join('\n'));
  }

  return parts.join('\n\n');
}

/**
 * Run the full capture → copy flow. The question can be passed in (e.g. from
 * the sidebar panel); otherwise she is prompted for it.
 * @param {{question?: string, include?: object}} [args]
 */
async function copyContext(args) {
  const include = (args && args.include) || { file: true, problems: true, openFiles: true };
  let question = args && args.question;

  // Ask for the question unless the caller already supplied one.
  if (question === undefined) {
    question = await vscode.window.showInputBox({
      prompt: 'Ask about this code…',
      placeHolder: 'e.g. Why is this throwing on line 42?',
    });
    if (question === undefined) {
      return; // she cancelled — do nothing
    }
  }

  const bundle = buildBundle(question, captureContext(include));
  await vscode.env.clipboard.writeText(bundle);
  vscode.window.showInformationMessage('Lens context copied — paste into any AI chat.');
}

/**
 * Webview provider for the Lens sidebar panel.
 */
class LensPanelProvider {
  /** @param {vscode.Uri} extensionUri */
  constructor(extensionUri) {
    this._extensionUri = extensionUri;
  }

  /** @param {vscode.WebviewView} webviewView */
  resolveWebviewView(webviewView) {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getPanelHtml(webviewView.webview);

    // The panel just forwards her question + checkbox state; the host does
    // the capture and copy, then confirms back so the panel can show status.
    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg && msg.type === 'copy') {
        vscode.commands
          .executeCommand('lens.copyContext', {
            question: msg.question || '',
            include: msg.include,
          })
          .then(() => webviewView.webview.postMessage({ type: 'copied' }));
      }
    });
  }
}

/**
 * Sidebar panel HTML. All CSS/JS inline, no external requests.
 * @param {vscode.Webview} webview
 */
function getPanelHtml(webview) {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    padding: 12px;
    margin: 0;
  }
  h2 { font-size: 13px; margin: 0 0 8px; font-weight: 600; }
  p.hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 0 0 10px; }
  textarea {
    width: 100%;
    box-sizing: border-box;
    min-height: 84px;
    resize: vertical;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
    padding: 8px;
    font-family: inherit;
    font-size: inherit;
  }
  textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
  fieldset { border: none; padding: 10px 0 0; margin: 0; }
  legend { font-size: 12px; color: var(--vscode-descriptionForeground); padding: 0; margin-bottom: 4px; }
  label { display: flex; align-items: center; gap: 8px; font-size: 12.5px; padding: 3px 0; cursor: pointer; }
  button {
    width: 100%;
    margin-top: 12px;
    padding: 8px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  #status { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 8px; min-height: 16px; }
</style>
</head>
<body>
  <h2>Lens</h2>
  <p class="hint">Show, don't screenshot. Type your question, pick what to include, copy.</p>
  <textarea id="question" placeholder="Ask about this code…"></textarea>
  <fieldset>
    <legend>Include</legend>
    <label><input type="checkbox" id="inc-file" checked> File or selection</label>
    <label><input type="checkbox" id="inc-problems" checked> Problems</label>
    <label><input type="checkbox" id="inc-open" checked> Open files</label>
  </fieldset>
  <button id="copy">Copy context</button>
  <div id="status"></div>
  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const $ = (id) => document.getElementById(id);
      $('copy').addEventListener('click', () => {
        $('status').textContent = 'Copying…';
        vscode.postMessage({
          type: 'copy',
          question: $('question').value,
          include: {
            file: $('inc-file').checked,
            problems: $('inc-problems').checked,
            openFiles: $('inc-open').checked,
          },
        });
      });
      window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'copied') {
          $('status').textContent = 'Copied — paste into any AI chat.';
        }
      });
    })();
  </script>
</body>
</html>`;
}

/** Random nonce for the webview content security policy. */
function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('lens.copyContext', copyContext),
    vscode.commands.registerCommand('lens.openPanel', () =>
      vscode.commands.executeCommand('lens.panel.focus')
    ),
    vscode.window.registerWebviewViewProvider(
      'lens.panel',
      new LensPanelProvider(context.extensionUri)
    )
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
