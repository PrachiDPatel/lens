/* Lens — options page (API settings).
 *
 * Lets the user bring their own Anthropic key. Saving validates the key
 * against the models endpoint through the service worker, then stores the
 * key in chrome.storage.local and the chosen model id in chrome.storage.sync.
 * The key is never logged and never leaves the extension except in requests
 * to api.anthropic.com that the user explicitly triggers.
 */
(() => {
  "use strict";

  const KEY_STORE = "lensApiKey";   // chrome.storage.local
  const MODEL_STORE = "lensModel";  // chrome.storage.sync

  const keyInput = document.getElementById("api-key");
  const saveBtn = document.getElementById("save");
  const removeBtn = document.getElementById("remove");
  const keySavedNote = document.getElementById("key-saved");
  const modelSelect = document.getElementById("model");
  const statusEl = document.getElementById("status");

  function setStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.classList.toggle("err", !!isError);
  }

  // The service worker makes the actual network calls, so this page never
  // touches CORS and the key stays in one place.
  function callWorker(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(resp);
        }
      });
    });
  }

  function populateModels(ids, selectedId) {
    modelSelect.innerHTML = "";
    if (!ids.length) {
      modelSelect.innerHTML = "<option>No models returned</option>";
      modelSelect.disabled = true;
      return;
    }
    ids.forEach((id) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      modelSelect.appendChild(opt);
    });
    modelSelect.disabled = false;
    if (selectedId && ids.includes(selectedId)) modelSelect.value = selectedId;
  }

  function validationError(resp) {
    if (!resp) return "Couldn't reach the extension — reload this page and try again.";
    if (resp.network) return "Couldn't reach api.anthropic.com — check your connection and try again.";
    if (resp.status === 401 || resp.status === 403) {
      return "That key was rejected. Double-check it in the Anthropic console.";
    }
    if (resp.status) return `Validation failed (HTTP ${resp.status}). Try again.`;
    return "Validation failed. Try again.";
  }

  function showKeyPresent(present) {
    keySavedNote.hidden = !present;
    removeBtn.hidden = !present;
  }

  async function load() {
    const { [KEY_STORE]: savedKey } = await chrome.storage.local.get(KEY_STORE);
    if (!savedKey) {
      showKeyPresent(false);
      return;
    }
    showKeyPresent(true);
    setStatus("Checking saved key…");
    try {
      const resp = await callWorker({ type: "lens-validate-key", key: savedKey });
      if (!resp || !resp.ok) {
        setStatus(validationError(resp), true);
        return;
      }
      const { [MODEL_STORE]: savedModel } = await chrome.storage.sync.get(MODEL_STORE);
      populateModels(resp.models, savedModel);
      // Re-pin the stored model if the account's list changed.
      if (!savedModel || !resp.models.includes(savedModel)) {
        await chrome.storage.sync.set({ [MODEL_STORE]: modelSelect.value });
      }
      setStatus(`Saved key is valid — ${resp.models.length} models available.`);
    } catch (_err) {
      setStatus("Couldn't reach the extension — reload this page and try again.", true);
    }
  }

  saveBtn.addEventListener("click", async () => {
    const key = keyInput.value.trim();
    if (!key) {
      setStatus("Paste an API key first.", true);
      return;
    }
    saveBtn.disabled = true;
    setStatus("Checking key…");
    try {
      const resp = await callWorker({ type: "lens-validate-key", key });
      if (!resp || !resp.ok) {
        setStatus(validationError(resp), true);
        return;
      }
      await chrome.storage.local.set({ [KEY_STORE]: key });
      const { [MODEL_STORE]: savedModel } = await chrome.storage.sync.get(MODEL_STORE);
      populateModels(resp.models, savedModel);
      await chrome.storage.sync.set({ [MODEL_STORE]: modelSelect.value });
      keyInput.value = "";
      showKeyPresent(true);
      setStatus(`Key saved — ${resp.models.length} models available.`);
    } catch (_err) {
      setStatus("Couldn't reach the extension — reload this page and try again.", true);
    } finally {
      saveBtn.disabled = false;
    }
  });

  keyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveBtn.click();
  });

  modelSelect.addEventListener("change", async () => {
    await chrome.storage.sync.set({ [MODEL_STORE]: modelSelect.value });
    setStatus("Model updated.");
  });

  removeBtn.addEventListener("click", async () => {
    await chrome.storage.local.remove(KEY_STORE);
    await chrome.storage.sync.remove(MODEL_STORE);
    keyInput.value = "";
    showKeyPresent(false);
    modelSelect.innerHTML = "<option>Save a key first</option>";
    modelSelect.disabled = true;
    setStatus("Key removed.");
  });

  load();
})();
