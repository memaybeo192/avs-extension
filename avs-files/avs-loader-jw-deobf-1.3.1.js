/**
 * ========================================================================================
 * ANIMEVIETSUB (AVS) HLS PLAYLIST DECRYPTION MODULE - v1.3.1 (SMART WRAPPER)
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
 * DEOBFUSCATION METHODOLOGY (v1.3.1 Trace)
 * ═══════════════════════════════════════════════════════════
 *
 * Obfuscator: javascript-obfuscator (High Compression)
 * Techniques identified:
 *   1. String array          — all literals moved to a central array
 *   2. Control flow flattening — massively complex switch-case state machine
 *   3. Hex identifiers        — all variable/property names replaced with _0xNNNN
 *
 * ── Step 1: Identify the string decoder ───────────────────
 *   Located the internal string lookup function. It uses a base offset to index 
 *   into the rotated string array.
 *
 * ── Step 2: Control Flow Unflattening ─────────────────────
 *   By tracing the sequence string (e.g., "1|4|0|3|2"), we mapped the 
 *   disjointed switch cases back into a linear logical flow.
 *
 * ── Step 3: Identify Security Headers ─────────────────────
 *   Discovered the usage of X-Edge-Tag, X-Cache-Node, X-Proxy-Digest, and 
 *   X-Request-Trace. These are retrieved from the XHR response headers.
 *
 * ── Step 4: Reconstruct Crypto Chain ──────────────────────
 *   Confirmed HMAC-SHA256 signature order for AES key derivation:
 *   AES_KEY = HMAC(Key: X-Edge-Tag, Data: `${proxyDigest}:${requestTrace}:${cacheNode}`)
 *
 * ── Step 5: Verify via Dynamic Trace ──────────────────────
 *   Patched Web Crypto API in the browser to intercept cleartext and IV.
 *   Verified IV = first 12 bytes of decoded X-Edge-Tag.
 *
 * ═══════════════════════════════════════════════════════════
 * CONFIRMED CRYPTO CHAIN
 * ═══════════════════════════════════════════════════════════
 *  Step 1  importKey(HMAC-SHA-256, raw, base64url_decode(X-Edge-Tag))
 *  Step 2  sign("${proxyDigest}:${requestTrace}:${cacheNode}") -> AES Key Material
 *  Step 3  importKey(AES-GCM, raw, hmac_output_32_bytes)
 *  Step 4  decrypt(AES-GCM, iv=X-Edge-Tag_raw[0..11], ciphertext)
 *
 * ── ARCHITECTURE (RECONSTRUCTED) ────────────────────────────────────────────────────────
 * This implementation follows the "Monkey-Patching" pattern observed in the original
 * AVS security modules. It acts as a transparent proxy between HLS.js and the server.
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
    const ciphertextBytes = base64urlToBytes(ciphertext);
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
    extinfs.forEach((extinf, i) => {
      output += extinf + '\n' + (decryptedUrls[i] || '') + '\n';
    });
    output += "#EXT-X-ENDLIST\n";
    return output;
  }

  function createAvsLoader(BaseLoader) {
    return function (config) {
      const loader = new BaseLoader(config);
      Object.defineProperties(this, { stats: { get: () => loader.stats }, context: { get: () => loader.context } });
      this.load = function (context, config, callbacks) {
        const originalSuccess = callbacks.onSuccess;
        callbacks.onSuccess = function (response, stats, context, networkDetails) {
          const getH = (n) => (networkDetails?.getResponseHeader?.(n) || networkDetails?.headers?.get?.(n) || '');
          const edgeTag = getH('X-Edge-Tag');
          const cacheNode = getH('X-Cache-Node');
          if (!edgeTag || !cacheNode || context.type !== 'manifest') return originalSuccess(response, stats, context, networkDetails);
          const requestTrace = getH('X-Request-Trace') || '0';
          const proxyDigest = decodeURIComponent(getH('X-Proxy-Digest') || 'anon');
          const rawText = typeof response.data === 'string' ? response.data : new TextDecoder().decode(response.data);
          const tTokens = [];
          rawText.split('\n').forEach(line => {
            const m = line.match(/[?&]_t=([^&\s]+)/);
            if (m) tTokens.push(m[1]);
          });
          if (tTokens.length === 0) return originalSuccess(response, stats, context, networkDetails);
          avsDecrypt(tTokens.join(''), edgeTag, cacheNode, proxyDigest, requestTrace)
            .then(decrypted => {
              response.data = formatM3U8(rawText, decrypted);
              if (stats && !stats.parsing) stats.parsing = { start: 0, end: 0 };
              originalSuccess(response, stats, context, networkDetails);
            })
            .catch(err => callbacks.onError({ code: 0, text: err.message }, context, networkDetails));
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
