/**
 * ========================================================================================
 * ANIMEVIETSUB (AVS) FINGERPRINT MODULE - v1.12.21
 * ========================================================================================
 *
 * RECONSTRUCTION & MODIFICATION NOTICE:
 * This source code is a readable reconstruction of the AVS fingerprint module recovered
 * from avs-fingerprint.min.js.
 * This is the canonical v1.12.21 build: readable and runtime-compatible; no separate
 * runtime-preserved duplicate is kept.
 *
 * Runtime export:
 *   window._avsProbe
 *
 * =====================================================================
 * CHANGELOG VS v1.3.7 LOADER LINEAGE
 * =====================================================================
 *
 * 1. Adds a standalone environment probe companion for the newer loader.
 * 2. Exposes fp, signals, loadTime, fc, and envHash.
 * 3. Captures browser/runtime APIs, automation hints, bridge/runtime hints, and viewport
 *    hardware components.
 * 4. envHash is compatible with the loader-side environment hardening path.
 *
 * =====================================================================
 * CONFIRMED SIGNAL GROUPS
 * =====================================================================
 *
 *  - Runtime APIs: WebAssembly, Symbol, Proxy, fetch, WebGL2, serviceWorker, CSS.supports.
 *  - Browser/env: Intl, connection, cores, DPR, touch, screen width/height.
 *  - Automation/bridge: webdriver, Phantom, Selenium, WebKit handlers, Android bridge,
 *    Electron.
 *  - Hashing: DJB2-style unsigned hex hash.
 *
 * ========================================================================================
 */

(function avsFingerprint(window) {
  "use strict";

  const signals = {};

  function capture(name, getter) {
    try {
      signals[name] = getter();
    } catch {
      signals[name] = "error";
    }
  }

  // DJB2-style unsigned hex hash used by the original fingerprint script.
  function hashString(value) {
    let hash = 5381;
    for (let i = 0; i < value.length; i++) {
      hash = (hash << 5) + hash + value.charCodeAt(i);
      hash &= hash;
    }
    return (hash >>> 0).toString(16);
  }

  capture("wasm", () => typeof WebAssembly !== "undefined");
  capture("symbol", () => typeof Symbol !== "undefined");
  capture("proxy", () => typeof Proxy !== "undefined");
  capture("fetch", () => typeof fetch === "function");
  capture("webgl2", () => !!window.WebGL2RenderingContext);
  capture("sw", () => "serviceWorker" in navigator);
  capture("cssSupp", () => typeof CSS !== "undefined" && !!CSS.supports);
  capture("intl", () => typeof Intl !== "undefined");
  capture("conn", () => !!navigator.connection);

  // Automation / embedded-runtime probes.
  capture("webdriver", () => !!navigator.webdriver);
  capture("phantom", () => !!window._phantom || !!window.phantom);
  capture("selenium", () => !!window.__selenium_unwrapped);
  capture("wkHandlers", () => !!window.webkit && !!window.webkit.messageHandlers);
  capture("androidBridge", () => !!window._nativeInterface);
  capture("electron", () => !!window.process && !!window.process.versions && !!window.process.versions.electron);

  // Hardware / viewport components.
  capture("cores", () => navigator.hardwareConcurrency || 0);
  capture("dpr", () => window.devicePixelRatio || 1);
  capture("touch", () => navigator.maxTouchPoints || 0);
  capture("w", () => screen.width);
  capture("h", () => screen.height);

  const keys = Object.keys(signals).sort();
  const signalString = keys.map(key => `${key}=${String(signals[key])}`).join("|");
  const fp = hashString(signalString);

  let frameContext = "";
  try {
    const host = window.parent === window ? window.location.hostname : window.parent.location.hostname;
    frameContext = window.btoa(host);
  } catch {
    frameContext = window.btoa("cross-origin");
  }

  let ua = "0";
  let host = "0";
  let cores = "0";
  let width = "0";
  let height = "0";
  let hasSubtle = "0";

  try { ua = navigator.userAgent || "0"; } catch {}
  try { host = window.location.hostname || "0"; } catch {}
  try { cores = String(navigator.hardwareConcurrency || "0"); } catch {}
  try { width = String(screen.width || "0"); } catch {}
  try { height = String(screen.height || "0"); } catch {}
  try { hasSubtle = String(!!window.crypto && !!window.crypto.subtle); } catch {}

  const envHash = hashString(`${ua}${host}${cores}${width}${height}${hasSubtle}`);

  window._avsProbe = {
    fp,
    signals,
    loadTime: Date.now(),
    fc: frameContext,
    envHash
  };
})(window);

