/* Lens — page-context collector (runs in the page's MAIN world).
 *
 * Records console errors, unhandled promise rejections, and failed network
 * requests (non-2xx or network errors), then forwards each entry to the
 * extension via a "lens-collect" DOM event, which the isolated content
 * script listens for. Only failures are recorded — successful requests and
 * page data are never touched. Everything is wrapped in try/catch so this
 * can never break the host page.
 */
(() => {
  "use strict";
  try {
    const trunc = (s, n) => {
      if (typeof s !== "string") s = String(s);
      return s.length > n ? s.slice(0, n) + "…" : s;
    };

    const dispatch = (entry) => {
      try {
        window.dispatchEvent(new CustomEvent("lens-collect", { detail: entry }));
      } catch (_e) {
        /* page is going away or events are blocked — not our problem */
      }
    };

    window.addEventListener(
      "error",
      (e) => {
        try {
          dispatch({
            kind: "error",
            message: trunc(e && e.message ? e.message : "error", 500),
            source: trunc(e && e.filename ? e.filename : "", 300),
            line: (e && e.lineno) || 0,
            time: Date.now(),
          });
        } catch (_e) {}
      },
      true
    );

    window.addEventListener("unhandledrejection", (e) => {
      try {
        const r = e && e.reason;
        dispatch({
          kind: "unhandledrejection",
          message: trunc(r && r.message ? r.message : String(r), 500),
          time: Date.now(),
        });
      } catch (_e) {}
    });

    const origFetch = window.fetch;
    if (typeof origFetch === "function") {
      window.fetch = function (input, init) {
        let method = "GET";
        let url = "";
        try {
          method =
            (init && init.method) ||
            (input && typeof input !== "string" && input.method) ||
            "GET";
          url = typeof input === "string" ? input : (input && input.url) || "";
        } catch (_e) {}
        let promise;
        try {
          promise = origFetch.apply(this, arguments);
        } catch (err) {
          try {
            dispatch({
              kind: "request",
              method: String(method).toUpperCase(),
              url: trunc(url, 500),
              status: 0,
              error: trunc((err && err.message) || String(err), 300),
              time: Date.now(),
            });
          } catch (_e) {}
          throw err;
        }
        return promise.then(
          (res) => {
            try {
              if (res && !res.ok) {
                dispatch({
                  kind: "request",
                  method: String(method).toUpperCase(),
                  url: trunc(url, 500),
                  status: res.status,
                  time: Date.now(),
                });
              }
            } catch (_e) {}
            return res;
          },
          (err) => {
            try {
              dispatch({
                kind: "request",
                method: String(method).toUpperCase(),
                url: trunc(url, 500),
                status: 0,
                error: trunc((err && err.message) || String(err), 300),
                time: Date.now(),
              });
            } catch (_e) {}
            throw err;
          }
        );
      };
    }

    const OrigXHR = window.XMLHttpRequest;
    if (typeof OrigXHR === "function") {
      const WrappedXHR = function () {
        const xhr = new OrigXHR();
        let method = "GET";
        let url = "";
        const origOpen = xhr.open;
        xhr.open = function (m, u) {
          try {
            method = m;
            url = u;
          } catch (_e) {}
          return origOpen.apply(this, arguments);
        };
        xhr.addEventListener("load", () => {
          try {
            if (xhr.status < 200 || xhr.status >= 300) {
              dispatch({
                kind: "request",
                method: String(method).toUpperCase(),
                url: trunc(url, 500),
                status: xhr.status,
                time: Date.now(),
              });
            }
          } catch (_e) {}
        });
        xhr.addEventListener("error", () => {
          try {
            dispatch({
              kind: "request",
              method: String(method).toUpperCase(),
              url: trunc(url, 500),
              status: 0,
              error: "network error",
              time: Date.now(),
            });
          } catch (_e) {}
        });
        return xhr;
      };
      WrappedXHR.prototype = OrigXHR.prototype;
      window.XMLHttpRequest = WrappedXHR;
    }
  } catch (_e) {
    /* never break the host page */
  }
})();
