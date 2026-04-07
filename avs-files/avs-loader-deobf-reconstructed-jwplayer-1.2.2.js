/**
 * ========================================================================================
 * ANIMEVIETSUB (AVS) HLS PLAYLIST DECRYPTION MODULE - v1.2.0
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
 * DEOBFUSCATION METHODOLOGY (v1.2.0 Trace)
 * ═══════════════════════════════════════════════════════════
 *
 * Obfuscator: javascript-obfuscator (v2.x)
 * 
 * ── Step 1: Recover String Array ──────────────────────────
 *   The module used a rotated string array. The rotation was verified by 
 *   matching the checksum of the shifted array elements during initialization.
 *
 * ── Step 2: Extract Security Logic ────────────────────────
 *   Identified the "Hybrid" nature of the manifest delivery:
 *   - Mode A: Full Binary ciphertext (for ArtPlayer/Legacy).
 *   - Mode B: M3U8 with `_t=` tokens (for JWPlayer/New).
 *   Logic was unflattened from the primary switch-case dispatcher.
 *
 * ── Step 3: Key Derivation Confirmation ───────────────────
 *   Confirmed HMAC-SHA256 signature order for AES key material generation:
 *   AES_KEY = HMAC(Key: X-Edge-Tag, Data: `${proxyDigest}:${requestTrace}:${cacheNode}`)
 *
 * ── Step 4: Verification ──────────────────────────────────
 *   Confirmed functional parity using local overrides and browser crypto hooks.
 *
 * ═══════════════════════════════════════════════════════════
 * CONFIRMED CRYPTO CHAIN
 * ═══════════════════════════════════════════════════════════
 *  Step 1  importKey(HMAC-SHA-256, raw, base64url_decode(X-Edge-Tag))
 *  Step 2  sign("${proxyDigest}:${requestTrace}:${cacheNode}") -> AES Key Material
 *  Step 3  importKey(AES-GCM, raw, hmac_output_32_bytes)
 *  Step 4  decrypt(AES-GCM, iv=X-Edge-Tag_raw[0..11], ciphertext)
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
    let cipherBytes = (typeof ciphertext === 'string') ? base64urlToBytes(ciphertext) : new Uint8Array(ciphertext);
    const plaintextBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipherBytes);
    return new TextDecoder().decode(plaintextBuffer);
  }

  function formatM3U8(originalRaw, decryptedPlaintext) {
    if (decryptedPlaintext.includes('#EXTM3U')) return decryptedPlaintext;
    const lines = originalRaw.split('\n');
    const extinfs = [];
    const decryptedUrls = decryptedPlaintext.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    let output = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n";
    for (const line of lines) { if (line.trim().startsWith('#EXTINF:')) extinfs.push(line.trim()); }
    if (extinfs.length > 0) {
      extinfs.forEach((extinf, i) => { output += extinf + '\n' + (decryptedUrls[i] || '') + '\n'; });
    } else {
      decryptedUrls.forEach(url => { output += "#EXTINF:10.0,\n" + url + "\n"; });
    }
    output += "#EXT-X-ENDLIST\n";
    return output;
  }

  function AvsLoader(config) {
    this.stats = { trequest: 0, tfirst: 0, tload: 0, loaded: 0, total: 0, retry: 0,
                   loading: { start: 0, first: 0, end: 0 }, parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 } };
    this.xhr = null;
  }

  AvsLoader.prototype.load = function (context, config, callbacks) {
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
        const proxyDigest = decodeURIComponent(xhr.getResponseHeader('X-Proxy-Digest') || 'anon');
        const rawText = typeof data === 'string' ? data : new TextDecoder().decode(data);
        const tTokens = []; rawText.split('\n').forEach(line => { const m = line.match(/[?&]_t=([^&\s]+)/); if (m) tTokens.push(m[1]); });
        
        const performDecryption = (cipherData) => {
          avsDecrypt(cipherData, edgeTag, cacheNode, proxyDigest, requestTrace).then(decrypted => {
            response.data = formatM3U8(rawText, decrypted);
            stats.loaded = stats.total = response.data.length;
            if (stats.parsing) stats.parsing.start = performance.now();
            callbacks.onSuccess(response, stats, context, xhr);
          }).catch(err => callbacks.onError({ code: 0, text: err.message }, context, xhr));
        };

        if (tTokens.length > 0) return performDecryption(tTokens.join(''));
        if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return performDecryption(data);
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
