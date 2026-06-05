/**
 * ========================================================================================
 * ANIMEVIETSUB (AVS) HLS PLAYLIST DECRYPTION MODULE - v1.12.21
 * ========================================================================================
 *
 * RECONSTRUCTION & MODIFICATION NOTICE:
 * This source code is a DE-OBFUSCATED and RECONSTRUCTED version of the AVS loader.
 * It is written to be readable like the previous v1.3.7 reconstruction while preserving
 * the runtime surface recovered from the newer obfuscated build.
 *
 * Runtime exports:
 *   window.AvsPlaylistLoader
 *   window.AvsEncryptedLoader
 *   window._avsDecryptM3u8
 *   window._avsG6Diag
 *   window._avsBeaconCanary
 *
 * =====================================================================
 * DEOBFUSCATION METHODOLOGY (v1.12.21 Trace)
 * =====================================================================
 *
 * Obfuscator: javascript-obfuscator style string array + wrapper guard objects.
 *
 * -- Step 1: String Array Recovery -------------------------------------------------------
 *   The newer source used a larger rotated string table. webcrack resolved the table and
 *   exposed the important runtime constants:
 *     X-Envelope, X-Edge-Tag, X-Cache-Node, X-Request-Trace, X-Proxy-Digest,
 *     Retry-After, AVS_DECRYPT_PLAYLIST, AVS_RESOLVE_SEG.
 *
 * -- Step 2: Envelope Parser Recovery ----------------------------------------------------
 *   v1.12.21 uses X-Envelope as a compact binary container, not plain JSON:
 *     magic: "USDK"
 *     version: 1
 *     length: uint16 payload length
 *     payload: UTF-8 JSON with cn/sk/ts/uid
 *     trailer: CRC32(payload)
 *
 * -- Step 3: Playlist Decryption Flow ----------------------------------------------------
 *   Encrypted playlists are detected by _c=. The loader collects all _t= chunks,
 *   reverses the cache-node seeded shuffle, derives AES-GCM key material via HMAC,
 *   and decrypts the joined ciphertext.
 *
 * -- Step 4: Segment Loader / Placeholder Flow ------------------------------------------
 *   The segment loader strips the AVS binary prefix and can resolve placeholder
 *   /hls/<24hex>.ts URLs using AES-CTR when a session key is available.
 *
 * =====================================================================
 * CHANGELOG VS v1.3.7
 * =====================================================================
 *
 * 1. Header source changed:
 *    v1.3.7 primarily used individual headers directly.
 *    v1.12.21 prefers X-Envelope and falls back to X-Edge-Tag/X-Cache-Node/
 *    X-Request-Trace/X-Proxy-Digest.
 *
 * 2. Crypto sign input changed:
 *    v1.3.7 documented proxyDigest/requestTrace/cacheNode ordering.
 *    v1.12.21 recovered uid/trace/cacheNode ordering, with optional
 *    _avsCryptoHarden env snapshot suffix.
 *
 * 3. Playlist token handling changed:
 *    v1.12.21 keeps the _t= chunk collection plus cache-node seeded unshuffle before
 *    AES-GCM decrypt.
 *
 * 4. Service worker bridge changed:
 *    v1.12.21 exposes AVS_DECRYPT_PLAYLIST and AVS_RESOLVE_SEG message handling.
 *
 * 5. Segment URL handling expanded:
 *    v1.12.21 adds placeholder segment URL resolution and diagnostics through
 *    window._avsG6Diag().
 *
 * =====================================================================
 * CONFIRMED CRYPTO CHAIN
 * =====================================================================
 *
 *  Step 1  keyBytes = base64url_decode(edgeTag / envelope.cn)
 *  Step 2  HMAC-SHA-256 key = keyBytes
 *  Step 3  sign(uid:trace:cacheNode[:envSnapshot]) -> AES key material
 *  Step 4  AES-GCM decrypt, iv = keyBytes[0..11]
 *  Step 5  plaintext is the rebuilt segment playlist block
 *
 * ========================================================================================
 */

(function avsLoader(window) {
  "use strict";

  const TEXT = new TextEncoder();
  const UTF8 = new TextDecoder();
  const HEADER = {
    envelope: "X-Envelope",
    edgeTag: "X-Edge-Tag",
    cacheNode: "X-Cache-Node",
    requestTrace: "X-Request-Trace",
    proxyDigest: "X-Proxy-Digest",
    retryAfter: "Retry-After"
  };

  const PLACEHOLDER_RE = /\/hls\/([0-9a-f]{24})\.ts(?:$|\?)/i;
  const keyCache = new Map();
  const segmentUrlById = {};

  const diag = {
    sessionKey: "MISSING",
    hasCrypto: !!(window.crypto && window.crypto.subtle),
    placeholderSeen: 0,
    decryptOK: 0,
    decryptFail: 0,
    rewroteToCdn: 0,
    fallthroughPlaceholder: 0,
    lastError: "",
    keyCacheSize: 0
  };

  function callRateLimit(retryAfterSeconds) {
    if (typeof window._avsOnRateLimit === "function") {
      window._avsOnRateLimit(retryAfterSeconds || 15);
    }
  }

  function beacon(name, payload) {
    try {
      const body = JSON.stringify({
        name,
        payload,
        t: Date.now()
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/avs/canary", body);
      } else if (typeof fetch === "function") {
        fetch("/avs/canary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true
        }).catch(() => {});
      }
    } catch {}
  }

  function getHeader(headers, name) {
    if (!headers) return "";
    if (typeof headers.get === "function") return headers.get(name) || "";
    const lower = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lower) return headers[key] || "";
    }
    return "";
  }

  function base64UrlToBytes(input) {
    let text = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
    while (text.length % 4) text += "=";
    const raw = atob(text);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function hexToBytes(hex) {
    if (typeof hex !== "string" || hex.length === 0 || hex.length % 2 !== 0) return null;
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      if (!Number.isFinite(byte)) return null;
      out[i] = byte;
    }
    return out;
  }

  function lcg(seed) {
    return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  }

  // Reverses the shuffle applied to joined _t= ciphertext chunks.
  function unshuffleString(value, seedText) {
    try {
      const chars = String(value).split("");
      let seed = parseInt(String(seedText || "").slice(0, 8), 16) >>> 0;
      const swaps = [];
      for (let i = chars.length - 1; i > 0; i--) {
        seed = lcg(seed);
        swaps.push([i, seed % (i + 1)]);
      }
      for (let i = swaps.length - 1; i >= 0; i--) {
        const [a, b] = swaps[i];
        const tmp = chars[a];
        chars[a] = chars[b];
        chars[b] = tmp;
      }
      return chars.join("");
    } catch {
      return value;
    }
  }

  function parseJwtSessionKey(token) {
    if (!token || typeof token !== "string") return "";
    const parts = token.split(".");
    if (parts.length !== 3) return "";
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4) payload += "=";
    try {
      const data = JSON.parse(atob(payload));
      const jti = data && data.jti;
      if (typeof jti !== "string") return "";
      let session = "";
      for (let i = 0; i < jti.length; i++) {
        if (i % 2 === 1) session += jti[i];
      }
      return session;
    } catch {
      return "";
    }
  }

  function findSessionKeyFromPage() {
    try {
      if (typeof window._avsSk === "string" && window._avsSk) {
        return parseJwtSessionKey(window._avsSk);
      }
    } catch {}

    try {
      const params = new URLSearchParams(window.location.search);
      const token = params.get("token");
      if (token) return parseJwtSessionKey(token);
    } catch {}

    return "";
  }

  let crcTable = null;

  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
          c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        crcTable[n] = c >>> 0;
      }
    }

    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = (crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8)) >>> 0;
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function parseEnvelope(value) {
    if (!value) return null;
    try {
      const bytes = base64UrlToBytes(value);
      if (bytes.length < 11) throw new Error("Envelope too short");
      if (bytes[0] !== 85 || bytes[1] !== 83 || bytes[2] !== 68 || bytes[3] !== 75) {
        throw new Error("Bad envelope magic");
      }
      if (bytes[4] !== 1) throw new Error("Unsupported envelope version: " + bytes[4]);

      const payloadLength = (bytes[5] << 8) | bytes[6];
      if (bytes.length !== 7 + payloadLength + 4) throw new Error("Bad envelope length");

      const payload = bytes.subarray(7, 7 + payloadLength);
      const expectedCrc = (
        ((bytes[7 + payloadLength] << 24) |
          (bytes[7 + payloadLength + 1] << 16) |
          (bytes[7 + payloadLength + 2] << 8) |
          bytes[7 + payloadLength + 3]) >>> 0
      );
      if (expectedCrc !== crc32(payload)) throw new Error("CRC mismatch");

      let payloadText = "";
      for (let i = 0; i < payload.length; i++) payloadText += String.fromCharCode(payload[i]);
      const json = JSON.parse(decodeURIComponent(escape(payloadText)));
      return {
        cn: json.cn || "",
        sk: json.sk || "",
        ts: json.ts || "0",
        uid: json.uid || "anon"
      };
    } catch (err) {
      beacon("envelope_fallback", err.message);
      return null;
    }
  }

  function envSnapshotValue() {
    try {
      if (typeof window._avsEnvSnapshot !== "function") return 0;
      return (0 + window._avsEnvSnapshot()) >>> 0;
    } catch {
      return 0;
    }
  }

  async function decryptAesGcm(ciphertextB64Url, edgeTagB64Url, cacheNode, uid, trace) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("WebCrypto unavailable");
    }

    const keyBytes = base64UrlToBytes(edgeTagB64Url);
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const harden = window._avsCryptoHarden === true;
    const shadow = window._avsCryptoHardenShadow === true;
    const envValue = harden ? envSnapshotValue() : 0;
    const signInput = harden
      ? `${uid}:${trace}:${cacheNode}:${envValue}`
      : `${uid}:${trace}:${cacheNode}`;

    if (harden && shadow && (envValue !== 0 || Math.random() < 0.05)) {
      beacon("envSnap", {
        value: envValue,
        ua: (navigator.userAgent || "").slice(0, 100),
        sampled: envValue === 0
      });
    }

    const aesMaterial = await crypto.subtle.sign("HMAC", hmacKey, TEXT.encode(signInput));
    const aesKey = await crypto.subtle.importKey(
      "raw",
      aesMaterial,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    if (harden && typeof window._avsMarkKey === "function") {
      window._avsMarkKey(aesKey, {
        enable: true,
        permKey: cacheNode,
        permSalt: String(trace)
      });
    }

    const iv = keyBytes.slice(0, 12);
    const ciphertext = base64UrlToBytes(ciphertextB64Url);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ciphertext);
    return UTF8.decode(plaintext);
  }

  async function decryptM3u8(text, headers) {
    const envelope = parseEnvelope(getHeader(headers, HEADER.envelope));
    const edgeTag = envelope ? envelope.cn : getHeader(headers, HEADER.edgeTag);
    const cacheNode = envelope ? envelope.sk : getHeader(headers, HEADER.cacheNode);
    const trace = envelope ? envelope.ts : getHeader(headers, HEADER.requestTrace) || "0";
    const uid = envelope ? envelope.uid : decodeURIComponent(getHeader(headers, HEADER.proxyDigest) || "anon");

    const lines = String(text || "").split("\n");
    let encrypted = false;
    for (const line of lines) {
      if (!line.startsWith("#") && line.trim() !== "") {
        encrypted = /[?&]_c=[0-9]+/.test(line);
        break;
      }
    }
    if (!encrypted || !edgeTag || !cacheNode) return text;

    const tokenChunks = [];
    const headerLines = [];
    for (const line of lines) {
      if (line.startsWith("#") || line.trim() === "") {
        if (!/^#EXTINF:/.test(line) && !/^#EXT-X-ENDLIST/.test(line) && !/^#EXT-X-KEY/.test(line)) {
          headerLines.push(line);
        }
        continue;
      }
      const match = line.match(/[?&]_t=([^&\s]+)/);
      if (match) tokenChunks.push(match[1]);
    }

    if (!tokenChunks.length) return text;

    const shuffledCiphertext = tokenChunks.join("");
    const ciphertext = unshuffleString(shuffledCiphertext, cacheNode);
    const segmentBlock = await decryptAesGcm(ciphertext, edgeTag, cacheNode, uid, trace);
    const origin = window.location.origin;
    const fixedSegments = segmentBlock
      .split("\n")
      .map(line => {
        if (line.startsWith("#") || line.trim() === "") return line;
        if (line.startsWith("/")) return origin + line;
        return line;
      })
      .join("\n");

    return `${headerLines.join("\n")}\n${fixedSegments}`;
  }

  function stripSegmentPrefix(bytes) {
    try {
      const host = new Function("try{return globalThis.location&&globalThis.location.hostname?globalThis.location.hostname:\"\"}catch(e){return \"\"}")();
      const domains = window._avsDomains || [];
      let knownHost = false;
      for (const rawDomain of domains) {
        const domain = String.fromCharCode(...rawDomain);
        if (host === domain || host.endsWith("." + domain)) {
          knownHost = true;
          break;
        }
      }
      if (knownHost) return bytes.slice(127);

      let extra = 0;
      for (let i = 0; i < Math.min(host.length, 8); i++) extra += host.charCodeAt(i);
      return bytes.slice(127 + extra);
    } catch {
      return bytes.slice(127);
    }
  }

  async function getPlaceholderKey(sessionKey, fileId) {
    const cached = keyCache.get(fileId);
    if (cached) return cached;

    const hmacKey = await crypto.subtle.importKey(
      "raw",
      TEXT.encode(sessionKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const material = await crypto.subtle.sign("HMAC", hmacKey, TEXT.encode(`decrypt${fileId}`));
    const aesKey = await crypto.subtle.importKey(
      "raw",
      material,
      { name: "AES-CTR" },
      false,
      ["decrypt"]
    );
    keyCache.set(fileId, aesKey);
    diag.keyCacheSize = keyCache.size;
    return aesKey;
  }

  async function decryptPlaceholderUrl(sessionKey, fileId, index, encryptedUrlB64Url) {
    let data = String(encryptedUrlB64Url).replace(/-/g, "+").replace(/_/g, "/");
    while (data.length % 4) data += "=";
    const raw = atob(data);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    const counter = new Uint8Array(16);
    counter[12] = (index >>> 24) & 255;
    counter[13] = (index >>> 16) & 255;
    counter[14] = (index >>> 8) & 255;
    counter[15] = index & 255;

    const key = await getPlaceholderKey(sessionKey, fileId);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-CTR", counter, length: 64 }, key, bytes);
    return UTF8.decode(new Uint8Array(plaintext));
  }

  function createHeaderProxy(headers) {
    const normalized = {};
    for (const key of Object.keys(headers || {})) {
      normalized[key.toLowerCase()] = headers[key];
    }
    return {
      get(name) {
        const value = normalized[String(name).toLowerCase()];
        return value === undefined ? null : value;
      }
    };
  }

  function wrapRateLimitError(callbacks) {
    return function onError(error, context, xhr, stats) {
      if ((xhr && xhr.status) !== 429) {
        callbacks.onError(error, context, xhr, stats);
        return;
      }
      let retryAfter = 0;
      try { retryAfter = parseInt(xhr.getResponseHeader(HEADER.retryAfter) || "0", 10) || 0; } catch {}
      callRateLimit(retryAfter || 15);
    };
  }

  window.AvsPlaylistLoader = function AvsPlaylistLoader(config) {
    const inner = new (0, config.loader)(config);

    Object.defineProperties(this, {
      stats: { get: () => inner.stats },
      context: { get: () => inner.context }
    });

    this.abort = () => inner.abort();
    this.destroy = () => inner.destroy();
    this.load = (context, config2, callbacks) => {
      const wrapped = Object.assign({}, callbacks, {
        onError: wrapRateLimitError(callbacks),
        onSuccess(response, stats, requestContext, xhr) {
          const data = response.data;
          function header(name) {
            if (xhr && xhr.getResponseHeader) return xhr.getResponseHeader(name) || "";
            if (xhr && xhr.headers && xhr.headers.get) return xhr.headers.get(name) || "";
            return "";
          }

          const headers = {
            [HEADER.envelope]: header(HEADER.envelope),
            [HEADER.edgeTag]: header(HEADER.edgeTag),
            [HEADER.cacheNode]: header(HEADER.cacheNode),
            [HEADER.requestTrace]: header(HEADER.requestTrace) || "0",
            [HEADER.proxyDigest]: header(HEADER.proxyDigest) || "anon"
          };

          decryptM3u8(data, createHeaderProxy(headers))
            .then(plaintext => {
              response.data = plaintext;
              callbacks.onSuccess(response, stats, requestContext, xhr);
            })
            .catch(err => {
              callbacks.onError({ code: 0, text: "AVS decrypt failed: " + err.message }, requestContext, null, stats);
            });
        }
      });
      inner.load(context, config2, wrapped);
    };
  };

  window.AvsEncryptedLoader = function AvsEncryptedLoader(config) {
    const inner = new (0, config.loader)(config);
    const sessionKey = findSessionKeyFromPage();
    diag.sessionKey = sessionKey ? `present(${sessionKey.length})` : "MISSING";

    Object.defineProperties(this, {
      stats: { get: () => inner.stats },
      context: { get: () => inner.context }
    });

    this.abort = () => inner.abort();
    this.destroy = () => inner.destroy();
    this.load = (context, config2, callbacks) => {
      const wrapped = Object.assign({}, callbacks, {
        onSuccess(response, stats, requestContext, xhr) {
          try {
            if (response && response.data) {
              if (response.data instanceof ArrayBuffer) {
                const stripped = stripSegmentPrefix(new Uint8Array(response.data));
                response.data = stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength);
              } else if (response.data.byteLength != null) {
                response.data = stripSegmentPrefix(response.data);
              }
            }
          } catch {}
          callbacks.onSuccess(response, stats, requestContext, xhr);
        },
        onError: wrapRateLimitError(callbacks)
      });

      try {
        const url = new URL(context.url, window.location && window.location.href);
        const match = PLACEHOLDER_RE.exec(url.pathname);
        if (match) {
          diag.placeholderSeen++;
          const fileId = match[1];
          const encrypted = url.searchParams.get("e");
          const index = parseInt(url.searchParams.get("i"), 10);
          if (sessionKey && encrypted && Number.isFinite(index) && index >= 0) {
            decryptPlaceholderUrl(sessionKey, fileId, index, encrypted)
              .then(realUrl => {
                if (typeof realUrl === "string" && realUrl.length > 8 && realUrl.indexOf("http") === 0) {
                  context.url = realUrl;
                  segmentUrlById[fileId] = realUrl;
                  diag.decryptOK++;
                  diag.rewroteToCdn++;
                } else {
                  diag.decryptFail++;
                  diag.fallthroughPlaceholder++;
                  diag.lastError = `plaintext_not_url(${realUrl ? realUrl.slice(0, 20) : "empty"})`;
                }
                inner.load(context, config2, wrapped);
              })
              .catch(err => {
                diag.decryptFail++;
                diag.fallthroughPlaceholder++;
                diag.lastError = "decrypt_threw:" + (err && err.message || "?");
                inner.load(context, config2, wrapped);
              });
            return;
          }
          diag.fallthroughPlaceholder++;
          diag.lastError = !sessionKey ? "no_session_key" : !encrypted ? "no_e_param" : "bad_index";
        }
      } catch (err) {
        diag.lastError = "parse_err:" + (err && err.message || "?");
      }

      inner.load(context, config2, wrapped);
    };
  };

  if (window.navigator && window.navigator.serviceWorker && window.navigator.serviceWorker.addEventListener) {
    window.navigator.serviceWorker.addEventListener("message", event => {
      const data = event.data;
      const port = event.ports && event.ports[0];
      if (!data || !port) return;

      if (data.type === "AVS_RESOLVE_SEG") {
        const url = segmentUrlById[data.id];
        port.postMessage(typeof url === "string" && url ? { ok: true, url } : { ok: false, error: "unknown seg id: " + data.id });
        return;
      }

      if (data.type === "AVS_DECRYPT_PLAYLIST") {
        decryptM3u8(String(data.text || ""), createHeaderProxy(data.headers || {}))
          .then(text => port.postMessage({ ok: true, text }))
          .catch(err => port.postMessage({ ok: false, error: err && err.message || String(err) }));
      }
    });
  }

  window._avsBeaconCanary = beacon;
  window._avsG6Diag = () => Object.assign({}, diag, { keyCacheSize: keyCache.size });
  window._avsDecryptM3u8 = (text, headers) => decryptM3u8(String(text || ""), createHeaderProxy(headers || {}));
})(window);

