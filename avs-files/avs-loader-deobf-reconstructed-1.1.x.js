/**
 * ========================================================================================
 * ANIMEVIETSUB (AVS) HLS PLAYLIST DECRYPTION MODULE - v1.1.0
 * ========================================================================================
 * 
 * ⚠️ RECONSTRUCTION & MODIFICATION NOTICE:
 * This source code is a DE-OBFUSCATED version of the original AVS security module.
 * 
 * NOTE: The original minified/obfuscated code works perfectly in its native environment. 
 * However, manual de-obfuscation often breaks implicit dependencies and internal 
 * HLS.js state handling. These modifications were applied to RESTORE functional 
 * stability to the de-obfuscated logic, specifically by explicitly defining 
 * objects (like stats.parsing) that were handled implicitly in the original context.
 *
 * ═══════════════════════════════════════════════════════════
 * DEOBFUSCATION METHODOLOGY (Full Reconstruction)
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
 *     _0x3c458e  →  dataToString
 *     _0x495230  →  toUint8Array
 *
 * ── Step 5: Verify via dynamic trace ─────────────────────
 *
 *   Patched crypto.subtle.importKey / sign / decrypt in-browser to log all
 *   inputs/outputs, confirming:
 *   - X-Edge-Tag "Z1TbTorQDBvlg6tZP6q8XQ" → keyBytes hex 6754db4e8ad00c1be583ab593faabc5d
 *   - signInput = "98a645a...e68eb:1775275088:BH1P9u...RknIQ"
 *   - aesKeyMaterial (32 bytes) = 5180b7397c2ed6ca...c9b6ca71
 *   - iv = keyBytes[0..11] = 6754db4e8ad00c1be583ab59
 *   - ciphertext comes from responseType="text" → ArrayBuffer
 *
 * ═══════════════════════════════════════════════════════════
 * CONFIRMED CRYPTO CHAIN
 * ═══════════════════════════════════════════════════════════
 *
 *  Step 1  importKey(HMAC-SHA-256, raw, base64url_decode(X-Edge-Tag))
 *  Step 2  sign("{X-Proxy-Digest}:{X-Request-Trace}:{X-Cache-Node}")
 *           → 32-byte HMAC output = AES-GCM key material
 *  Step 3  importKey(AES-GCM, raw, hmac_output_32_bytes)
 *  Step 4  decrypt(AES-GCM, iv=X-Edge-Tag_raw[0..11], ciphertext)
 *           → plaintext = M3U8 body with real segment URLs
 * ═══════════════════════════════════════════════════════════
 */

(function (window) {
  'use strict';

  const isSupported = !!(window.crypto && window.crypto.subtle);

  function base64urlToBytes(str) {
    try {
      let s = str.replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      const bin = atob(s);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    } catch (e) { return new Uint8Array(); }
  }

  async function avsDecrypt(ciphertext, edgeTag, cacheNode, proxyDigest, requestTrace) {
    const edgeTagBytes = base64urlToBytes(edgeTag);
    const hmacKey = await crypto.subtle.importKey('raw', edgeTagBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signInput = new TextEncoder().encode(`${proxyDigest}:${requestTrace}:${cacheNode}`);
    const aesKeyMaterial = await crypto.subtle.sign('HMAC', hmacKey, signInput);
    const aesKey = await crypto.subtle.importKey('raw', aesKeyMaterial, { name: 'AES-GCM' }, false, ['decrypt']);
    const iv = edgeTagBytes.slice(0, 12);
    const ciphertextBytes = new Uint8Array(ciphertext);
    const plaintextBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertextBytes);
    return new TextDecoder().decode(plaintextBuffer);
  }

  function AvsLoader(config) {
    this.stats = { trequest: 0, tfirst: 0, tload: 0, loaded: 0, total: 0, retry: 0,
                   loading: { start: 0, first: 0, end: 0 }, parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 } };
    this.xhr = null;
  }

  AvsLoader.prototype.load = function (context, config, callbacks) {
    if (context.type === 'manifest') context.responseType = 'arraybuffer';
    this.context = context;
    const xhr = this.xhr = new XMLHttpRequest();
    const stats = this.stats;
    stats.trequest = stats.loading.start = performance.now();
    xhr.open('GET', context.url, true);
    if (context.responseType) xhr.responseType = context.responseType;
    xhr.onload = () => {
      stats.tload = stats.loading.end = performance.now();
      let data = xhr.response || xhr.responseText;
      const response = { url: xhr.responseURL, data: data };
      if (context.type === 'manifest' && xhr.getResponseHeader('X-Edge-Tag')) {
        const edgeTag = xhr.getResponseHeader('X-Edge-Tag');
        const cacheNode = xhr.getResponseHeader('X-Cache-Node');
        const requestTrace = xhr.getResponseHeader('X-Request-Trace') || '0';
        const proxyDigest = xhr.getResponseHeader('X-Proxy-Digest') || '';
        avsDecrypt(data, edgeTag, cacheNode, proxyDigest, requestTrace).then(decrypted => {
          response.data = decrypted;
          stats.loaded = stats.total = response.data.length;
          if (stats.parsing) stats.parsing.start = performance.now();
          callbacks.onSuccess(response, stats, context, xhr);
        }).catch(err => callbacks.onError({ code: 0, text: err.message }, context, xhr));
        return;
      }
      stats.loaded = stats.total = (data.byteLength !== undefined ? data.byteLength : data.length);
      callbacks.onSuccess(response, stats, context, xhr);
    };
    xhr.onerror = () => callbacks.onError({ code: xhr.status, text: xhr.statusText }, context, xhr);
    xhr.send();
  };

  AvsLoader.prototype.abort = function () { if (this.xhr) this.xhr.abort(); };
  AvsLoader.prototype.destroy = function () { this.abort(); this.xhr = null; };

  window.AvsPlaylistLoader = AvsLoader;
  window.AvsEncryptedLoader = AvsLoader;
  window._avsCryptoSupported = isSupported;

})(window);
