// Lens — show, don't screenshot.
// Copies rich code context (file or selection, problems, open files) to the
// clipboard as a markdown bundle, ready to paste into any AI chat — or sends
// it straight to GitHub Copilot and streams the answer into the sidebar panel,
// or to Claude with your own API key (kept in the OS keychain).

const vscode = require('vscode');

// Caps so one copy never turns into a novel.
const MAX_LINES = 400;
const MAX_PROBLEMS = 30;
const MAX_OPEN_FILES = 20;

// Anthropic direct-send. The key lives ONLY in SecretStorage (the OS
// keychain) — never in settings files, never in logs, never in a URL.
// Requests go from the extension host straight to api.anthropic.com.
const ANTHROPIC_VERSION = '2023-06-01';
const SECRET_KEY = 'lens.anthropicApiKey';
const CLAUDE_SYSTEM =
  'You are helping a developer with their code. ' +
  'The relevant file context is attached. Answer their question.';

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
 * Build the markdown bundle: her question first, then the captured context.
 * @param {string} question what the user wants to ask about the code
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
 * the sidebar panel); otherwise the user is prompted for it.
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
      return; // the user cancelled — do nothing
    }
  }

  const bundle = buildBundle(question, captureContext(include));
  await vscode.env.clipboard.writeText(bundle);
  vscode.window.showInformationMessage('Lens context copied — paste into any AI chat.');
}

/**
 * Turn a sendRequest failure into a plain-language panel message.
 * Never surfaces a stack trace.
 * @param {*} err
 * @returns {string}
 */
function friendlyCopilotError(err) {
  const raw = err && err.message ? String(err.message) : String(err || '');
  const msg = raw.split('\n')[0];
  if (/quota|rate.?limit|429/i.test(msg)) {
    return 'Copilot is rate-limited right now — try again in a bit.';
  }
  if (/network|fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|offline/i.test(msg)) {
    return "Couldn't reach Copilot — check your connection and try again.";
  }
  if (/token|too long|context length|maximum context/i.test(msg)) {
    return 'That context is too long for the model — try selecting a smaller chunk of code.';
  }
  if (/consent|not enabled|not allowed|access/i.test(msg)) {
    return 'Copilot declined the request — check that language models are enabled in VS Code settings.';
  }
  const short = msg.length > 160 ? msg.slice(0, 160) + '…' : msg;
  return (
    "Copilot didn't respond" +
    (short ? ' — ' + short : '.') +
    ' Your context is intact; try again or copy it instead.'
  );
}

/**
 * Send the captured context straight to GitHub Copilot and stream the reply
 * into the Lens sidebar panel. Falls back to the clipboard when no Copilot
 * chat model is available (not installed, not signed in, API missing).
 * Model choice always comes from selectChatModels — never hardcoded.
 * @param {LensPanelProvider} provider the sidebar panel (response surface)
 * @param {{question?: string, include?: object}} [args]
 */
async function askCopilot(provider, args) {
  const include = (args && args.include) || { file: true, problems: true, openFiles: true };
  let question = args && args.question;

  if (question === undefined) {
    question = await vscode.window.showInputBox({
      prompt: 'Ask Copilot about this code…',
      placeHolder: 'e.g. Why is this throwing on line 42?',
    });
    if (question === undefined) {
      return; // the user cancelled — do nothing
    }
  }

  const ctx = captureContext(include);

  let models = [];
  try {
    if (vscode.lm && typeof vscode.lm.selectChatModels === 'function') {
      models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    }
  } catch (_e) {
    models = [];
  }
  if (!models || models.length === 0) {
    vscode.window.showInformationMessage(
      "Copilot chat isn't available (is the Copilot Chat extension installed and signed in?) — copied to the clipboard instead."
    );
    return copyContext({ question, include });
  }

  let model = models[0];
  if (models.length > 1) {
    const pick = await vscode.window.showQuickPick(
      models.map((m) => ({
        label: m.name || m.id,
        description: m.vendor,
        detail: [m.id, m.version].filter(Boolean).join(' · '),
        model: m,
      })),
      { placeHolder: 'Pick a Copilot model' }
    );
    if (!pick) {
      return; // the user cancelled — do nothing
    }
    model = pick.model;
  }

  // The panel is the response surface — open it, then make sure it's live.
  await vscode.commands.executeCommand('lens.panel.focus');
  for (let i = 0; i < 10 && !provider.hasView(); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!provider.hasView()) {
    vscode.window.showInformationMessage('Lens panel could not open — Copilot request cancelled.');
    return;
  }

  const prompt = buildBundle(question, ctx);
  provider.postMessage({ type: 'copilot-start' });
  const cancel = new vscode.CancellationTokenSource();
  try {
    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      {},
      cancel.token
    );
    let full = '';
    for await (const fragment of response.text) {
      full += fragment;
      provider.postMessage({ type: 'copilot-chunk', text: fragment });
    }
    provider.lastResponse = full;
    provider.postMessage({ type: 'copilot-done' });
  } catch (err) {
    provider.postMessage({ type: 'copilot-error', message: friendlyCopilotError(err) });
  } finally {
    cancel.dispose();
  }
}

/**
 * List the model ids available to an Anthropic key. The /v1/models response
 * is the only source of model names — nothing is hardcoded.
 * @param {string} key
 * @returns {Promise<string[]>} sorted model ids
 * @throws {Error} with .status (HTTP) or .network (unreachable)
 */
async function anthropicModels(key) {
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
      },
    });
  } catch (_e) {
    const err = new Error('network');
    err.network = true;
    throw err;
  }
  if (!res.ok) {
    const err = new Error('Anthropic request failed');
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const list = data && Array.isArray(data.data) ? data.data : [];
  return list
    .map((m) => m && m.id)
    .filter(Boolean)
    .sort();
}

/**
 * Turn an Anthropic failure into a plain-language message.
 * Never includes the key.
 * @param {*} err
 * @returns {string}
 */
function friendlyAnthropicError(err) {
  const status = err && err.status;
  if (status === 401 || status === 403) {
    return 'Your Anthropic key was rejected — run "Lens: Set Anthropic API key" and check it.';
  }
  if (err && err.network) {
    return "Couldn't reach the Anthropic API — check your connection and try again.";
  }
  const raw = err && err.message ? String(err.message).split('\n')[0] : '';
  const short = raw.length > 160 ? raw.slice(0, 160) + '…' : raw;
  return (
    'The Anthropic request failed' +
    (short ? ' — ' + short + '.' : '.') +
    ' Your context is intact; try again or copy it instead.'
  );
}

/**
 * Save her Anthropic API key to the OS keychain, validate it, and let her
 * pick a model from her account's own list.
 * @param {vscode.ExtensionContext} context
 * @param {LensPanelProvider} provider
 */
async function setApiKey(context, provider) {
  const key = await vscode.window.showInputBox({
    prompt: 'Paste your Anthropic API key',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'sk-ant-…',
  });
  if (key === undefined) {
    return; // the user cancelled — do nothing
  }
  const trimmed = key.trim();
  if (!trimmed) {
    vscode.window.showWarningMessage('No key entered — nothing was saved.');
    return;
  }

  let models;
  try {
    models = await anthropicModels(trimmed);
  } catch (err) {
    const status = err && err.status;
    if (status === 401 || status === 403) {
      vscode.window.showErrorMessage('That key was rejected — check it and try again.');
    } else {
      vscode.window.showErrorMessage(friendlyAnthropicError(err));
    }
    return;
  }

  // Only store the key once it validates.
  await context.secrets.store(SECRET_KEY, trimmed);

  const config = vscode.workspace.getConfiguration('lens');
  let model = config.get('anthropicModel');
  if (!model || !models.includes(model)) {
    if (models.length === 1) {
      model = models[0];
    } else if (models.length > 1) {
      const pick = await vscode.window.showQuickPick(
        models.map((m) => ({ label: m })),
        { placeHolder: 'Pick a Claude model' }
      );
      if (!pick) {
        vscode.window.showInformationMessage(
          'Key saved. You can pick a model the next time you send.'
        );
        provider.refreshKeyState();
        return;
      }
      model = pick.label;
    } else {
      vscode.window.showInformationMessage(
        'Key saved, but no models came back for it — check the key and try again.'
      );
      provider.refreshKeyState();
      return;
    }
    await config.update('anthropicModel', model, vscode.ConfigurationTarget.Global);
  }

  provider.refreshKeyState();
  vscode.window.showInformationMessage('Anthropic key saved — Send to Claude is ready.');
}

/**
 * Remove her Anthropic API key from the OS keychain.
 * @param {vscode.ExtensionContext} context
 * @param {LensPanelProvider} provider
 */
async function deleteApiKey(context, provider) {
  await context.secrets.delete(SECRET_KEY);
  provider.refreshKeyState();
  vscode.window.showInformationMessage('Anthropic key deleted.');
}

/**
 * Send the captured context straight to Claude with her own API key and
 * render the reply into the Lens sidebar panel. Text context only — no
 * screenshot in VS Code.
 * @param {vscode.ExtensionContext} context
 * @param {LensPanelProvider} provider the sidebar panel (response surface)
 * @param {{question?: string, include?: object}} [args]
 */
async function sendToClaude(context, provider, args) {
  const include = (args && args.include) || { file: true, problems: true, openFiles: true };
  let question = args && args.question;

  if (question === undefined) {
    question = await vscode.window.showInputBox({
      prompt: 'Ask Claude about this code…',
      placeHolder: 'e.g. Why is this throwing on line 42?',
    });
    if (question === undefined) {
      return; // the user cancelled — do nothing
    }
  }

  let key = await context.secrets.get(SECRET_KEY).catch(() => undefined);
  if (!key) {
    const choice = await vscode.window.showInformationMessage(
      'No Anthropic API key saved yet.',
      'Set Anthropic API key'
    );
    if (choice === 'Set Anthropic API key') {
      await setApiKey(context, provider);
      key = await context.secrets.get(SECRET_KEY).catch(() => undefined);
    }
    if (!key) {
      return;
    }
  }

  // The panel is the response surface — open it, then make sure it's live.
  await vscode.commands.executeCommand('lens.panel.focus');
  for (let i = 0; i < 10 && !provider.hasView(); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!provider.hasView()) {
    vscode.window.showInformationMessage('Lens panel could not open — Send to Claude cancelled.');
    return;
  }

  const config = vscode.workspace.getConfiguration('lens');
  let model = config.get('anthropicModel');
  if (!model) {
    let models;
    try {
      models = await anthropicModels(key);
    } catch (err) {
      provider.postMessage({ type: 'claude-error', message: friendlyAnthropicError(err) });
      return;
    }
    if (models.length === 0) {
      provider.postMessage({
        type: 'claude-error',
        message: 'No Claude models came back for that key — check it and try again.',
      });
      return;
    }
    if (models.length === 1) {
      model = models[0];
    } else {
      const pick = await vscode.window.showQuickPick(
        models.map((m) => ({ label: m })),
        { placeHolder: 'Pick a Claude model' }
      );
      if (!pick) {
        return; // the user cancelled — do nothing
      }
      model = pick.label;
    }
    await config.update('anthropicModel', model, vscode.ConfigurationTarget.Global);
  }

  provider.postMessage({ type: 'claude-start' });
  const text = buildBundle(question, captureContext(include));
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: CLAUDE_SYSTEM,
        messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      }),
    });
    if (!res.ok) {
      const err = new Error('Anthropic request failed');
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const blocks = data && Array.isArray(data.content) ? data.content : [];
    const answer = blocks
      .filter((b) => b && b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n\n');
    provider.lastResponse = answer;
    provider.postMessage({ type: 'claude-done', text: answer });
  } catch (err) {
    provider.postMessage({ type: 'claude-error', message: friendlyAnthropicError(err) });
  }
}

/**
 * Webview provider for the Lens sidebar panel. Also the response surface for
 * Copilot and Claude answers.
 */
class LensPanelProvider {
  /** @param {vscode.Uri} extensionUri @param {vscode.ExtensionContext} context */
  constructor(extensionUri, context) {
    this._extensionUri = extensionUri;
    this._context = context;
    this._view = undefined;
    this.lastResponse = '';
  }

  hasView() {
    return !!this._view;
  }

  /** Post to the panel if it's open; silently drops otherwise. */
  postMessage(msg) {
    if (this._view) {
      this._view.webview.postMessage(msg);
    }
  }

  /** Tell the panel whether a Claude key is stored (controls the button). */
  async refreshKeyState() {
    if (!this._view) {
      return;
    }
    const key = await this._context.secrets.get(SECRET_KEY).catch(() => undefined);
    this.postMessage({ type: 'claude-key', has: !!key });
  }

  /** @param {vscode.WebviewView} webviewView */
  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.onDidDispose(() => {
      if (this._view === webviewView) {
        this._view = undefined;
      }
    });
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getPanelHtml(webviewView.webview);
    this.refreshKeyState();

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (!msg) {
        return;
      }
      if (msg.type === 'copy') {
        // The panel just forwards her question + checkbox state; the host
        // does the capture and copy, then confirms back for status display.
        vscode.commands
          .executeCommand('lens.copyContext', {
            question: msg.question || '',
            include: msg.include,
          })
          .then(() => webviewView.webview.postMessage({ type: 'copied' }));
      } else if (msg.type === 'ask') {
        askCopilot(this, { question: msg.question || '', include: msg.include });
      } else if (msg.type === 'send-claude') {
        sendToClaude(this._context, this, {
          question: msg.question || '',
          include: msg.include,
        });
      } else if (msg.type === 'copilot-copy') {
        vscode.env.clipboard
          .writeText(this.lastResponse || '')
          .then(() => webviewView.webview.postMessage({ type: 'copilot-copied' }));
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
  .row { display: flex; gap: 8px; margin-top: 12px; }
  .row button { margin-top: 0; flex: 1; }
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
  button:disabled { opacity: 0.5; cursor: default; }
  #status { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 8px; min-height: 16px; }
  #response {
    white-space: pre-wrap;
    font-size: 12.5px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
    padding: 8px;
    margin-top: 12px;
    max-height: 320px;
    overflow-y: auto;
  }
</style>
</head>
<body>
  <h2>Lens</h2>
  <p class="hint">Show, don't screenshot. Type your question, pick what to include — copy it, or send it straight to Copilot or Claude.</p>
  <textarea id="question" placeholder="Ask about this code…"></textarea>
  <fieldset>
    <legend>Include</legend>
    <label><input type="checkbox" id="inc-file" checked> File or selection</label>
    <label><input type="checkbox" id="inc-problems" checked> Problems</label>
    <label><input type="checkbox" id="inc-open" checked> Open files</label>
  </fieldset>
  <div class="row">
    <button id="copy">Copy context</button>
    <button id="ask">Ask Copilot</button>
    <button id="send-claude" hidden>Send to Claude</button>
  </div>
  <div id="status"></div>
  <div id="response-wrap" hidden>
    <div id="response"></div>
    <div class="row">
      <button id="copy-response" disabled>Copy response</button>
    </div>
  </div>
  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const $ = (id) => document.getElementById(id);
      const includeState = () => ({
        file: $('inc-file').checked,
        problems: $('inc-problems').checked,
        openFiles: $('inc-open').checked,
      });
      $('copy').addEventListener('click', () => {
        $('status').textContent = 'Copying…';
        vscode.postMessage({
          type: 'copy',
          question: $('question').value,
          include: includeState(),
        });
      });
      $('ask').addEventListener('click', () => {
        $('response').textContent = '';
        $('response-wrap').hidden = false;
        $('copy-response').disabled = true;
        $('status').textContent = 'Asking Copilot…';
        vscode.postMessage({
          type: 'ask',
          question: $('question').value,
          include: includeState(),
        });
      });
      $('copy-response').addEventListener('click', () => {
        vscode.postMessage({ type: 'copilot-copy' });
      });
      $('send-claude').addEventListener('click', () => {
        $('response').textContent = '';
        $('response-wrap').hidden = false;
        $('copy-response').disabled = true;
        $('status').textContent = 'Asking Claude…';
        vscode.postMessage({
          type: 'send-claude',
          question: $('question').value,
          include: includeState(),
        });
      });
      window.addEventListener('message', (event) => {
        const d = event.data || {};
        if (d.type === 'copied') {
          $('status').textContent = 'Copied — paste into any AI chat.';
        } else if (d.type === 'copilot-start') {
          $('status').textContent = 'Copilot is thinking…';
        } else if (d.type === 'copilot-chunk') {
          $('response').textContent += d.text || '';
          $('response').scrollTop = $('response').scrollHeight;
        } else if (d.type === 'copilot-done') {
          $('status').textContent = 'Done.';
          $('copy-response').disabled = false;
        } else if (d.type === 'copilot-error') {
          $('status').textContent = d.message || 'Copilot hit an error.';
        } else if (d.type === 'copilot-copied') {
          $('status').textContent = 'Response copied.';
        } else if (d.type === 'claude-key') {
          $('send-claude').hidden = !d.has;
        } else if (d.type === 'claude-start') {
          $('status').textContent = 'Claude is thinking…';
        } else if (d.type === 'claude-done') {
          $('response').textContent = d.text || '';
          $('response').scrollTop = 0;
          $('status').textContent = 'Done.';
          $('copy-response').disabled = false;
        } else if (d.type === 'claude-error') {
          $('status').textContent = d.message || 'Claude hit an error.';
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
  const provider = new LensPanelProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.commands.registerCommand('lens.copyContext', copyContext),
    vscode.commands.registerCommand('lens.askCopilot', (args) =>
      askCopilot(provider, args)
    ),
    vscode.commands.registerCommand('lens.setApiKey', () =>
      setApiKey(context, provider)
    ),
    vscode.commands.registerCommand('lens.deleteApiKey', () =>
      deleteApiKey(context, provider)
    ),
    vscode.commands.registerCommand('lens.sendToClaude', (args) =>
      sendToClaude(context, provider, args)
    ),
    vscode.commands.registerCommand('lens.openPanel', () =>
      vscode.commands.executeCommand('lens.panel.focus')
    ),
    vscode.window.registerWebviewViewProvider(
      'lens.panel',
      provider
    )
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
