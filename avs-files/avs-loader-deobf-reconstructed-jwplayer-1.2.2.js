/**
 * ========================================================================================
 * ANIMEVIETSUB (AVS) HLS PLAYLIST DECRYPTION MODULE - v1.2.0 (JWPLAYER SMART WRAPPER)
 * ========================================================================================
 * 
 * ⚠️ RECONSTRUCTION & MODIFICATION NOTICE:
 * This source code is a DE-OBFUSCATED and RECONSTRUCTED version of the original 
 * AVS security module. 
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
 * ── Step 1: Recover String Array ──────────────────────────
 *   The module used a rotated string array. The rotation was verified by 
 *   matching the checksum of the shifted array elements.
 *
 * ── Step 2: Extract Security Logic ────────────────────────
 *   Identified the hybrid nature of the manifest (Binary vs Token).
 *   Logic was unflattened from the primary switch-case dispatcher.
 *
 * ── Step 3: Key Derivation Confirmation ───────────────────
 *   AES Key = HMAC_SHA256(X-Edge-Tag, `${proxyDigest}:${requestTrace}:${cacheNode}`)
 *
 * ── Step 4: Verification ──────────────────────────────────
 *   Confirmed functional parity using local overrides and crypto hooks.
 *
 * ═══════════════════════════════════════════════════════════
 * CONFIRMED CRYPTO CHAIN
 * ═══════════════════════════════════════════════════════════
 *  Step 1  importKey(HMAC-SHA-256, raw, base64url_decode(X-Edge-Tag))
 *  Step 2  sign("${proxyDigest}:${requestTrace}:${cacheNode}") -> AES Key Material
 *  Step 3  importKey(AES-GCM, raw, hmac_output_32_bytes)
 *  Step 4  decrypt(AES-GCM, iv=X-Edge-Tag_raw[0..11], ciphertext)
 * 
 * ── ARCHITECTURE OVERVIEW ───────────────────────────────────────────────────────────────
 * A Smart Wrapper for HLS.js. Reconstructed from 'avs-loader-new-obf-jwplayer.min.js'.
 * Supports Hybrid manifestation: Modern Tokens (_t=) and Legacy Binary Ciphertexts.
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
    const hmacKey = await crypto.subtle.importKey(
      'raw', edgeTagBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signInput = new TextEncoder().encode(`${proxyDigest}:${requestTrace}:${cacheNode}`);
    const aesKeyMaterial = await crypto.subtle.sign('HMAC', hmacKey, signInput);
    const aesKey = await crypto.subtle.importKey(
      'raw', aesKeyMaterial, { name: 'AES-GCM' }, false, ['decrypt']
    );
    const iv = edgeTagBytes.slice(0, 12);
    let ciphertextBytes = (typeof ciphertext === 'string') ? base64urlToBytes(ciphertext) : new Uint8Array(ciphertext);
    const plaintextBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertextBytes);
    return new TextDecoder().decode(plaintextBuffer);
  }

  function formatM3U8(originalRaw, decryptedPlaintext) {
    if (decryptedPlaintext.includes('#EXTM3U')) return decryptedPlaintext;
    const lines = originalRaw.split('\n');
    const extinfs = [];
    const decryptedUrls = decryptedPlaintext.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    let output = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n";
    for (const line of lines) {
      if (line.trim().startsWith('#EXTINF:')) extinfs.push(line.trim());
    }
    if (extinfs.length > 0) {
      extinfs.forEach((extinf, i) => { output += extinf + '\n' + (decryptedUrls[i] || '') + '\n'; });
    } else {
      decryptedUrls.forEach(url => { output += "#EXTINF:10.0,\n" + url + "\n"; });
    }
    output += "#EXT-X-ENDLIST\n";
    return output;
  }

  function createAvsLoader(BaseLoader) {
    return function (config) {
      const loader = new BaseLoader(config);
      Object.defineProperties(this, { stats: { get: () => loader.stats }, context: { get: () => loader.context } });
      this.load = function (context, config, callbacks) {
        const originalSuccess = callbacks.onSuccess;
        callbacks.onSuccess = function (response, stats, context, xhr) {
          const getH = (n) => (xhr?.getResponseHeader?.(n) || xhr?.headers?.get?.(n) || '');
          const edgeTag = getH('X-Edge-Tag');
          const cacheNode = getH('X-Cache-Node');
          if (!edgeTag || !cacheNode || context.type !== 'manifest') return originalSuccess(response, stats, context, xhr);
          const requestTrace = getH('X-Request-Trace') || '0';
          const proxyDigest = decodeURIComponent(getH('X-Proxy-Digest') || 'anon');
          const rawText = typeof response.data === 'string' ? response.data : new TextDecoder().decode(response.data);
          const tTokens = [];
          rawText.split('\n').forEach(line => {
            const m = line.match(/[?&]_t=([^&\s]+)/);
            if (m) tTokens.push(m[1]);
          });
          const performDecryption = (cipherData) => {
            avsDecrypt(cipherData, edgeTag, cacheNode, proxyDigest, requestTrace)
              .then(decrypted => {
                response.data = formatM3U8(rawText, decrypted);
                if (stats && !stats.parsing) stats.parsing = { start: 0, end: 0 };
                originalSuccess(response, stats, context, xhr);
              })
              .catch(err => callbacks.onError({ code: 0, text: err.message }, context, xhr));
          };
          if (tTokens.length > 0) return performDecryption(tTokens.join(''));
          if (response.data instanceof ArrayBuffer || ArrayBuffer.isView(response.data)) return performDecryption(response.data);
          originalSuccess(response, stats, context, xhr);
        };
        loader.load(context, config, callbacks);
      };
      this.abort = () => loader.abort();
      this.destroy = () => loader.destroy();
    };
  }

  const DefaultHlsLoader = (window.Hls && window.Hls.DefaultConfig && window.Hls.DefaultConfig.loader);
  if (DefaultHlsLoader) {
    window.AvsPlaylistLoader = createAvsLoader(DefaultHlsLoader);
    window.AvsEncryptedLoader = createAvsLoader(DefaultHlsLoader);
  }
  window._avsCryptoSupported = isSupported;
})(window);
