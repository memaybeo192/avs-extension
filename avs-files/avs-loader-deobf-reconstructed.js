/**
 * AVS HLS Playlist Decryption Module
 * Fully verified via dynamic crypto.subtle trace
 *
 * Deobf - reconstructed from avs-loader.min.js (4/5/2026) by Lam
 *
 * ═══════════════════════════════════════════════════════════
 * DEOBFUSCATION METHODOLOGY
 * ═══════════════════════════════════════════════════════════
 *
 * Obfuscator: javascript-obfuscator (standard config)
 * Techniques used:
 *   1. String array          — all literals moved to a central array a0_0x193d[]
 *   2. String array rotation — IIFE shuffles array until a checksum equals target
 *   3. Custom base64 decoder — strings encoded with modified base64 alphabet
 *   4. Control flow flattening — _0x1a6264 object bundles helper functions
 *   5. Hex identifiers        — all variable/property names replaced with _0xNNNN
 *
 * ── Step 1: Identify the string decoder ───────────────────
 *
 *   a0_0x5d26(index) is the lookup function.
 *   It subtracts a base offset from the index:
 *     base = -0x1784 + 3*0x3bd + 0xdba = 365 (0x16d)
 *   Then decodes arr[index - base] with a custom base64 variant:
 *     alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/="
 *     output   = decodeURIComponent(percent_encoded_bytes)
 *   Example: "zAavz" → "HMAC", "CriOU" → "raw"
 *
 * ── Step 2: Find the rotation offset ─────────────────────
 *
 *   The rotation IIFE runs push/shift on the array until this formula holds:
 *
 *     -parseInt(arr[0x1af]) / 1
 *     * parseInt(arr[0x1b9]) / 2
 *     + parseInt(arr[0x1bd]) / 3
 *     + -parseInt(arr[0x1d6]) / 4 * -parseInt(arr[0x1a2]) / 5
 *     + parseInt(arr[0x20f]) / 6
 *     + parseInt(arr[0x17e]) / 7
 *     + -parseInt(arr[0x1e1]) / 8 * -parseInt(arr[0x177]) / 9
 *     + -parseInt(arr[0x1ea]) / 10
 *     === 451851   (target = -0x49bd8 + 0x41cfa + 0x763e9)
 *
 *   Those indices decode to pure-number strings like "218zcAwAP", "6074ZEuXXV"
 *   which parseInt() extracts the leading number from.
 *
 *   Brute-force all 194 rotation values (array length), decode the relevant
 *   entries, eval the formula → rotation = 140.
 *
 * ── Step 3: Dump all decoded strings ─────────────────────
 *
 *   After rotating 140 times, decode every entry:
 *     0x16d → "load"      0x1e3 → "HMAC"      0x220 → "raw"
 *     0x16e → "cryp"      0x1f6 → "AES-"      0x1dd → "SHA-"
 *     0x1d9 → "GCM"       0x1ab → "256"        0x17c → "sign"
 *     0x19f → "decr"      0x18a → "ypt"         0x1e8 → "impo"
 *     0x1d2 → "rtKe"      ... (194 entries total)
 *
 *   Multi-part strings are concatenated inline in the source:
 *     _0x42c779(0x1f6) + _0x42c779(0x1d9)  →  "AES-" + "GCM"  →  "AES-GCM"
 *     _0x42c779(0x1dd) + _0x42c779(0x1ab)  →  "SHA-" + "256"  →  "SHA-256"
 *
 * ── Step 4: Substitute and reconstruct ───────────────────
 *
 *   Replace every _0x42c779(0xNNN) call with its decoded string, then
 *   rename obfuscated identifiers by context:
 *     _0x8a54c3  →  avsDecrypt
 *     _0x10abc0  →  base64urlToBytes
 *     _0x3c458e  →  dataToString (unused in final version)
 *     _0x495230  →  toUint8Array
 *
 *   Export names decoded:
 *     _avsCryptoSupported  =  s(0x217)+"Crypto"+s(0x1f2)+s(0x171)+s(0x207)
 *     AvsPlaylistLoader    =  s(0x1d3)+s(0x1e9)+"istL"+s(0x216)+"r"
 *     AvsEncryptedLoader   =  s(0x21f)+s(0x209)+...
 *     AvsDecryptPlaylist   =  s(0x1fa)+s(0x1b7)+s(0x173)+s(0x1ce)+"st"
 *
 * ── Step 5: Verify via dynamic trace ─────────────────────
 *
 *   Patched crypto.subtle.importKey / sign / decrypt in-browser to log all
 *   inputs/outputs, confirming:
 *   - X-Edge-Tag "Z1TbTorQDBvlg6tZP6q8XQ" → keyBytes hex 6754db4e8ad00c1be583ab593faabc5d
 *   - signInput = "98a645a...e68eb:1775275088:BH1P9u...RknIQ"
 *   - aesKeyMaterial (32 bytes) = 5180b7397c2ed6ca...c9b6ca71
 *   - iv = keyBytes[0..11] = 6754db4e8ad00c1be583ab59
 *   - ciphertext comes from responseType="text" → latin1 charCodeAt() → ArrayBuffer
 *     (NOT token-based parsing; entire response body is the ciphertext)
 *
 * ═══════════════════════════════════════════════════════════
 * CONFIRMED CRYPTO CHAIN
 * ═══════════════════════════════════════════════════════════
 *
 *  XHR responseType: "text"  ← ciphertext sent as text (NOT arraybuffer)
 *  content-length: 510531    ← ciphertext size ≈ plaintext size (AES-GCM, no expansion)
 *
 *  Headers (all in access-control-expose-headers, CORS-safe):
 *    X-Edge-Tag      base64url  → decode → 16-byte raw HMAC key + IV source
 *    X-Proxy-Digest  hex        → sign input part 1
 *    X-Request-Trace number     → sign input part 2
 *    X-Cache-Node    base64     → sign input part 3
 *
 *  Step 1  importKey(HMAC-SHA-256, raw, base64url_decode(X-Edge-Tag))
 *  Step 2  sign("{X-Proxy-Digest}:{X-Request-Trace}:{X-Cache-Node}")
 *           → 32-byte HMAC output = AES-GCM key material
 *  Step 3  importKey(AES-GCM, raw, hmac_output_32_bytes)
 *  Step 4  decrypt(AES-GCM, iv=X-Edge-Tag_raw[0..11], ciphertext)
 *           → plaintext = M3U8 body with real segment URLs
 *
 *  NOTE: responseType="text" means avs-loader.min.js converts the text
 *  response back to bytes before calling decrypt. For AvsDecryptPlaylist
 *  (standalone fetch), use resp.arrayBuffer() directly — same raw bytes.
 *
 *  Segment URL format (confirmed):
 *    https://storage.googleapiscdn.com/chunks/{id}/original/{obfuscated}/video{N}.html
 *      ?st={per-segment-token}&si={N}&seq={N}&token={shared-JWT}
 *    - Extension .html is fake; content is raw MPEG-TS
 *    - token JWT: exp = iat + 7200s (2-hour TTL)
 *    - has_EXT_X_KEY: false → no segment-level encryption, fetch directly
 *
 * ═══════════════════════════════════════════════════════════
 *
 * Exports (on window):
 *   _avsCryptoSupported      Boolean
 *   AvsPlaylistLoader(Cls)   HLS.js pLoader (transparently decrypts M3U8)
 *   AvsEncryptedLoader(Cls)  HLS.js fLoader (segment passthrough + validation)
 *   AvsDecryptPlaylist(url)  Standalone async: fetch + decrypt playlist URL
 */
(function (window) {
  'use strict';

  const isSupported = !!(
    window.crypto && window.crypto.subtle && window.crypto.subtle.importKey
  );

  // ─── base64url → Uint8Array ───────────────────────────────────────────────
  // Verified: "Z1TbTorQDBvlg6tZP6q8XQ" → 6754db4e8ad00c1be583ab593faabc5d
  function base64urlToBytes(str) {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    s += '=='.slice(0, (2 - (s.length % 4)) % 4);
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ─── Core decrypt ─────────────────────────────────────────────────────────
  /**
   * @param {ArrayBuffer} ciphertext   Raw M3U8 body bytes
   * @param {string} edgeTag           X-Edge-Tag  (base64url, 16 bytes)
   * @param {string} proxyDigest       X-Proxy-Digest (hex)
   * @param {string} requestTrace      X-Request-Trace (numeric string)
   * @param {string} cacheNode         X-Cache-Node (base64)
   * @returns {Promise<string>}        Decrypted M3U8 text with real segment URLs
   */
  async function avsDecrypt(ciphertext, edgeTag, proxyDigest, requestTrace, cacheNode) {
    if (!isSupported) throw new Error('Web Crypto not supported');

    // Step 1: X-Edge-Tag → raw bytes → HMAC-SHA256 key
    const keyBytes = base64urlToBytes(edgeTag);

    const hmacKey = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );

    // Step 2: sign "{X-Proxy-Digest}:{X-Request-Trace}:{X-Cache-Node}"
    // Verified: "98a645a...e68eb:1775275088:BH1P9u...RknIQ"
    const signInput = new TextEncoder().encode(`${proxyDigest}:${requestTrace}:${cacheNode}`);
    const aesKeyMaterial = await crypto.subtle.sign('HMAC', hmacKey, signInput);
    // → 32-byte output (e.g. 5180b7397c2ed6ca...c9b6ca71)

    // Step 3: HMAC output → AES-GCM key
    const aesKey = await crypto.subtle.importKey(
      'raw', aesKeyMaterial, { name: 'AES-GCM' }, false, ['decrypt']
    );

    // Step 4: IV = first 12 bytes of X-Edge-Tag raw bytes
    // Verified: iv_hex = 6754db4e8ad00c1be583ab59 (keyBytes[0..11])
    const iv = keyBytes.slice(0, 12);

    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext);
    return new TextDecoder().decode(plaintext);
  }

  // ─── Response coercion ────────────────────────────────────────────────────

  /**
   * Convert XHR/fetch response data to ArrayBuffer.
   * HLS.js uses responseType="text" for playlist XHR — avs-loader converts
   * the text back to bytes internally before calling decrypt.
   * For fetch-based usage (AvsDecryptPlaylist), use resp.arrayBuffer().
   */
  function toArrayBuffer(data) {
    if (!data) return null;
    if (data instanceof ArrayBuffer) return data;
    if (ArrayBuffer.isView(data))
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    if (typeof data === 'string') {
      // avs-loader converts text response → bytes this way (latin1 preserve)
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;
      return bytes.buffer;
    }
    if (data.data) return toArrayBuffer(data.data);
    return null;
  }

  function toUint8Array(data) {
    if (!data) return null;
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data))
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data.data) return toUint8Array(data.data);
    return null;
  }

  function makeGetHeader(nd) {
    return (name) => {
      if (nd?.getResponseHeader) return nd.getResponseHeader(name) || '';
      if (nd?.headers?.get)      return nd.headers.get(name) || '';
      return '';
    };
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  window._avsCryptoSupported = isSupported;

  /**
   * AvsPlaylistLoader — HLS.js pLoader
   * Intercepts onSuccess, decrypts M3U8 body, returns plaintext to hls.js.
   *
   * Usage: new Hls({ pLoader: window.AvsPlaylistLoader })
   */
  window.AvsPlaylistLoader = function (LoaderClass) {
    const loader = new LoaderClass(LoaderClass);
    Object.defineProperties(this, {
      stats:   { get: () => loader.stats },
      context: { get: () => loader.context },
    });
    this.abort   = () => loader.abort();
    this.destroy = () => loader.destroy();

    this.load = function (ctx, config, callbacks) {
      loader.load(ctx, config, Object.assign({}, callbacks, {
        onSuccess(response, stats, context, nd) {
          const getH = makeGetHeader(nd);
          const edgeTag      = getH('X-Edge-Tag');
          const cacheNode    = getH('X-Cache-Node');
          const requestTrace = getH('X-Request-Trace') || '0';
          const proxyDigest  = getH('X-Proxy-Digest')  || '';

          if (!edgeTag || !cacheNode)
            return callbacks.onSuccess(response, stats, context, nd);

          const ciphertext = toArrayBuffer(response.data);
          if (!ciphertext || ciphertext.byteLength === 0)
            return callbacks.onSuccess(response, stats, context, nd);

          avsDecrypt(ciphertext, edgeTag, proxyDigest, requestTrace, cacheNode)
            .then(plaintext => {
              response.data = plaintext;
              callbacks.onSuccess(response, stats, context, nd);
            })
            .catch(err => callbacks.onError(
              { code: 0, text: `AVS decrypt: ${err.message}` }, context, null, nd
            ));
        }
      }));
    };
  };

  /**
   * AvsEncryptedLoader — HLS.js fLoader
   * Validates segment is non-empty, normalises to ArrayBuffer.
   *
   * Usage: new Hls({ fLoader: window.AvsEncryptedLoader })
   */
  window.AvsEncryptedLoader = function (LoaderClass) {
    const loader = new LoaderClass(LoaderClass);
    Object.defineProperties(this, {
      stats:   { get: () => loader.stats },
      context: { get: () => loader.context },
    });
    this.abort   = () => loader.abort();
    this.destroy = () => loader.destroy();

    this.load = function (ctx, config, callbacks) {
      loader.load(ctx, config, Object.assign({}, callbacks, {
        onSuccess(response, stats, context, nd) {
          const bytes = toUint8Array(response.data);
          if (!bytes || bytes.byteLength <= 0)
            return callbacks.onError({ code: 0, text: 'empty segment' }, context, null, nd);
          response.data = bytes.slice(0).buffer;
          callbacks.onSuccess(response, stats, context, nd);
        }
      }));
    };
  };

  /**
   * AvsDecryptPlaylist(url) → Promise<string>
   *
   * Standalone: fetch + decrypt playlist, resolve relative segment paths.
   * Token JWT expires 2 hours after issue — call promptly.
   */
  window.AvsDecryptPlaylist = async function (url) {
    const resp = await fetch(url, { credentials: 'same-origin' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const edgeTag      = resp.headers.get('X-Edge-Tag')      || '';
    const cacheNode    = resp.headers.get('X-Cache-Node')    || '';
    const requestTrace = resp.headers.get('X-Request-Trace') || '0';
    const proxyDigest  = resp.headers.get('X-Proxy-Digest')  || '';

    // No encryption headers → raw M3U8
    if (!edgeTag || !cacheNode) return resp.text();

    // Use arrayBuffer() to get raw bytes (same as XHR binary string approach)
    const ciphertext = await resp.arrayBuffer();
    const plaintext  = await avsDecrypt(ciphertext, edgeTag, proxyDigest, requestTrace, cacheNode);

    const origin = window.location.origin;
    return plaintext
      .split('\n')
      .map(line => (line && !line.startsWith('#') && line.startsWith('/'))
        ? origin + line : line)
      .join('\n');
  };

}(window));
