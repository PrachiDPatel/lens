/* Lens — toolbar popup.
 * A single on/off switch for the floating button, synced via chrome.storage
 * so the content script in every tab picks it up immediately.
 */
(() => {
  "use strict";

  const STORAGE_KEY = "lensEnabled";
  const box = document.getElementById("enabled");

  chrome.storage.sync.get({ [STORAGE_KEY]: true }, (v) => {
    box.checked = v[STORAGE_KEY] !== false;
  });

  box.addEventListener("change", () => {
    chrome.storage.sync.set({ [STORAGE_KEY]: box.checked });
  });
})();
