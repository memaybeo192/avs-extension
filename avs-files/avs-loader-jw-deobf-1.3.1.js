/**
 * ========================================================================================
 * ANIMEVIETSUB (AVS) HLS PLAYLIST DECRYPTION MODULE - v1.3.1 (Functional Parity)
 * ========================================================================================
 * 
 * ── ARCHITECTURE OVERVIEW ───────────────────────────────────────────────────────────────
 * This module implements a "Standalone XHR Loader" for HLS.js (used by JWPlayer).
 * AVS uses a multi-layered security protocol to protect its HLS streams (.m3u8).
 * 
 * 1. Obfuscated Manifest: The initial .m3u8 contains encrypted tokens (_t=) instead of URLs.
 * 2. Header-Based Key Material: Decryption keys are NOT in the playlist. They are sent
 *    via HTTP Response Headers (X-Edge-Tag, X-Cache-Node, X-Proxy-Digest).
 * 3. HMAC-AES Decryption: A unique AES-GCM key is derived for EACH playlist load.
 * 4. M3U8 Reconstruction: Decrypted URLs are interleaved back into the original M3U8.
 * 
 * ── TECHNICAL DETAILS ───────────────────────────────────────────────────────────────────
 * - HMAC Hash: SHA-256
 * - Cipher: AES-GCM (12-byte IV, derived from first 12 bytes of X-Edge-Tag)
 * - Key Derivation Order: HMAC_Sign(Key: X-Edge-Tag, Data: "proxyDigest:requestTrace:cacheNode")
 * - Compatibility: Explicitly designed for HLS.js Stats (loading, parsing, buffering)
 * 
 * ════════════════════════════════════════════════════════════════════════════════════════
 */

(function (window) {
  'use strict';

  // Check for Web Crypto API support (SubtleCrypto)
  const isSupported = !!(window.crypto && window.crypto.subtle);

  /**
   * base64urlToBytes(str)
   * --------------------------------------------------------------------------------------
   * Robust Base64URL decoder. Handles the '-' and '_' chars and ensures correct
   * padding ('=') before using the native atob() function.
   */
  function base64urlToBytes(str) {
    try {
      let s = str.replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      const bin = atob(s);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      return bytes;
    } catch (e) {
      console.error('[AVS-Loader] Base64 decoding failed:', e);
      return new Uint8Array();
    }
  }

  /**
   * avsDecrypt(ciphertext, edgeTag, cacheNode, proxyDigest, requestTrace)
   * --------------------------------------------------------------------------------------
   * The core cryptographic heart of AVS security.
   * 
   * STEP 1: Import 'X-Edge-Tag' as the HMAC key source.
   * STEP 2: Construct the signature input string: "proxyDigest:requestTrace:cacheNode".
   * STEP 3: Sign the input using HMAC-SHA256 to generate the 32-byte AES-GCM key.
   * STEP 4: Extract the first 12 bytes of 'X-Edge-Tag' to use as the AES-GCM IV.
   * STEP 5: Decrypt the joined tokens (ciphertext) using the derived key and IV.
   */
  /**
   * ======================================================================================
   * DEEP DIVE: AVS v1.3.1 DECRYPTION & DE-OBFUSCATION STRATEGY
   * ======================================================================================
   * 
   * 1. OBFUSCATION ANALYSIS:
   *    The original source (avs-loader.min.js) used "Control Flow Flattening" (CFF).
   *    All logic was inside a massive `switch` block driven by a sequence string (e.g., "4|1|0|3|2").
   *    By tracing the sequence, we discovered the linear execution of the decryption:
   *    - Step 1: Gather raw tokens (_t=) from the .m3u8 body.
   *    - Step 2: Extract 4 specific security headers from the network response.
   *    - Step 3: Use Web Crypto Subtle API to derive keys and decrypt.
   * 
   * 2. SECURITY HEADERS (The "Levers"):
   *    - X-Edge-Tag: A Base64URL string. Acts as BOTH the HMAC key and the AES-GCM IV.
   *    - X-Cache-Node: A dynamic node ID string.
   *    - X-Proxy-Digest: A URI-encoded digest (usually decoded to a JSON-like string).
   *    - X-Request-Trace: A trace ID (defaulting to '0').
   * 
   * 3. KEY DERIVATION (The "Secret Sauce"):
   *    AVS does NOT send the AES key directly. It sends material to GENERATE it locally.
   *    Formula: AES_KEY = HMAC_SHA256(Key = X-Edge-Tag, Data = proxyDigest + ":" + requestTrace + ":" + cacheNode)
   *    
   *    CRITICAL TRACE FINDING:
   *    In v1.3.0, the order was different. In v1.3.1, the string concatenation order 
   *    is strictly `${proxyDigest}:${requestTrace}:${cacheNode}`.
   * 
   * 4. AES-GCM PARAMETERS:
   *    - Ciphertext: All `_t` tokens found in the playlist, joined into one long string.
   *    - IV (Initialization Vector): The first 12 bytes of the decoded `X-Edge-Tag`.
   *    - Tag Length: Default 128-bit (handled automatically by SubtleCrypto).
   * 
   * 5. WHY PREVIOUS RECONSTRUCTIONS FAILED:
   *    - Incorrect Parameter Order: Passing headers in the wrong sequence to the HMAC sign function.
   *    - Buffer Handling: Not converting ciphertext strings to Uint8Array properly.
   *    - Padding: Base64URL strings often lack padding '=', causing atob() to crash.
   * ======================================================================================
   */
  async function avsDecrypt(ciphertext, edgeTag, cacheNode, proxyDigest, requestTrace) {
    const edgeTagBytes = base64urlToBytes(edgeTag);
    
    // Step 1: HMAC Key Import
    const hmacKey = await crypto.subtle.importKey(
      'raw', edgeTagBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );

    // Step 2 & 3: Signature Generation (Key Material)
    const signInput = new TextEncoder().encode(`${proxyDigest}:${requestTrace}:${cacheNode}`);
    const aesKeyMaterial = await crypto.subtle.sign('HMAC', hmacKey, signInput);

    // Step 4: AES Key Import
    const aesKey = await crypto.subtle.importKey(
      'raw', aesKeyMaterial, { name: 'AES-GCM' }, false, ['decrypt']
    );

    // Step 5: IV extraction & Decryption
    const iv = edgeTagBytes.slice(0, 12);
    const ciphertextBytes = base64urlToBytes(ciphertext);

    const plaintextBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv }, 
      aesKey, 
      ciphertextBytes
    );

    return new TextDecoder().decode(plaintextBuffer);
  }

  /**
   * formatM3U8(originalRaw, decryptedPlaintext)
   * --------------------------------------------------------------------------------------
   * Re-constructs a valid HLS Playlist from the obfuscated source.
   * 
   * AVS obfuscated playlists look like:
   *   #EXTINF:10.0,
   *   /chunk/token?_t=ENCRYPTED_TOKEN_A
   *   #EXTINF:10.0,
   *   /chunk/token?_t=ENCRYPTED_TOKEN_B
   * 
   * Decrypted plaintext looks like:
   *   /real_chunk_path_A.html
   *   /real_chunk_path_B.html
   * 
   * This function ensures that Version tags, Duration tags, and Sequence tags
   * are preserved or standardized, then interleaves EXTINF lines with the real URLs.
   */
  function formatM3U8(originalRaw, decryptedPlaintext) {
    // If the server returns a full M3U8 in the plaintext, return it as-is.
    if (decryptedPlaintext.includes('#EXTM3U')) return decryptedPlaintext;

    const lines = originalRaw.split('\n');
    const extinfs = [];
    const decryptedUrls = decryptedPlaintext.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    
    // Standardization: Force Version 3 and VOD type to ensure player stability.
    let output = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n";
    
    // Extract EXTINF tags from the original response
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('#EXTINF:')) {
        extinfs.push(trimmedLine);
      }
    }

    // Interleave the original duration tags with the decrypted URLs
    extinfs.forEach((extinf, i) => {
      output += extinf + '\n' + (decryptedUrls[i] || '') + '\n';
    });
    
    output += "#EXT-X-ENDLIST\n";
    return output;
  }

  /**
   * XHRLoader Class
   * --------------------------------------------------------------------------------------
   * A custom Standalone XHR Loader for HLS.js / JWPlayer.
   * 
   * Why Standalone?
   * Modern JWPlayer versions encapsulate Hls.js, making the global 'Hls' variable
   * inaccessible. By using a pure XMLHttpRequest implementation, we bypass the need
   * to inherit from Hls.js default loaders while maintaining full API compatibility.
   */
  function XHRLoader(config) {
    /**
     * Stats Object: Critical for Hls.js bandwidth calculation and error reporting.
     * Missing sub-objects like 'loading' or 'parsing' will cause Player Crash (TypeError).
     */
    this.stats = {
      trequest: 0, tfirst: 0, tload: 0, loaded: 0, total: 0, retry: 0,
      loading: { start: 0, first: 0, end: 0 },
      parsing: { start: 0, end: 0 },
      buffering: { start: 0, first: 0, end: 0 }
    };
    this.xhr = null;
  }

  /**
   * load(context, config, callbacks)
   * --------------------------------------------------------------------------------------
   * Standard HLS.js Loader interface.
   * - 'context': Contains URL, type ('manifest' or 'fragment'), and Byte Range info.
   * - 'callbacks': Hooks for 'onSuccess', 'onError', 'onTimeout', etc.
   */
  XHRLoader.prototype.load = function (context, config, callbacks) {
    this.context = context;
    const xhr = this.xhr = new XMLHttpRequest();
    const stats = this.stats;
    
    // Record request start time
    stats.trequest = stats.loading.start = performance.now();

    xhr.open('GET', context.url, true);
    if (context.responseType) xhr.responseType = context.responseType;
    
    // Handle Byte-Range requests if the player requests partial content
    if (context.rangeStart !== undefined && context.rangeEnd !== undefined) {
      xhr.setRequestHeader('Range', `bytes=${context.rangeStart}-${context.rangeEnd - 1}`);
    }

    xhr.onreadystatechange = () => {
      // Record Time-to-First-Byte (TTFB)
      if (xhr.readyState === 2) {
        stats.tfirst = stats.loading.first = performance.now();
      }
    };

    xhr.onload = () => {
      const now = performance.now();
      stats.tload = stats.loading.end = now;
      
      let data = xhr.response || xhr.responseText;
      stats.loaded = stats.total = (data.byteLength !== undefined ? data.byteLength : data.length);
      
      const response = { url: xhr.responseURL, data: data };

      /**
       * PLAYLIST DECRYPTION FLOW
       * --------------------------------------------------------------------------------
       * Check if this request is for a Manifest (.m3u8) and if decryption headers exist.
       */
      if (context.type === 'manifest') {
        const edgeTag = xhr.getResponseHeader('X-Edge-Tag');
        const cacheNode = xhr.getResponseHeader('X-Cache-Node');
        
        if (edgeTag && cacheNode) {
          const requestTrace = xhr.getResponseHeader('X-Request-Trace') || '0';
          const proxyDigest = decodeURIComponent(xhr.getResponseHeader('X-Proxy-Digest') || 'anon');
          const rawText = typeof data === 'string' ? data : new TextDecoder().decode(data);
          
          // Collect all _t tokens from the obfuscated playlist lines
          const tTokens = [];
          rawText.split('\n').forEach(line => {
            const match = line.match(/[?&]_t=([^&\s]+)/);
            if (match) tTokens.push(match[1]);
          });

          if (tTokens.length > 0) {
            avsDecrypt(tTokens.join(''), edgeTag, cacheNode, proxyDigest, requestTrace)
              .then(decrypted => {
                // Successfully decrypted! Now rebuild the HLS playlist.
                response.data = formatM3U8(rawText, decrypted);
                
                // Recalculate stats for the new (longer) playlist string
                stats.loaded = stats.total = response.data.length;
                
                // Trigger success callback. Pass 'xhr' as the networkDetails object.
                callbacks.onSuccess(response, stats, context, xhr);
              })
              .catch(err => {
                console.error('[AVS] Decryption critical failure:', err);
                callbacks.onError({ code: 0, text: 'AVS-Decrypt: ' + err.message }, context, xhr);
              });
            return; // Exit here; the callback is handled inside the Promise.
          }
        }
      }

      // Default path: Successful fetch for Fragments or Non-Encrypted Playlists
      callbacks.onSuccess(response, stats, context, xhr);
    };

    // Standard error handlers
    xhr.onerror = () => callbacks.onError({ code: xhr.status, text: xhr.statusText }, context, xhr);
    xhr.ontimeout = () => callbacks.onTimeout({ code: xhr.status, text: 'timeout' }, context, xhr);

    xhr.send();
  };

  /**
   * abort() & destroy()
   * --------------------------------------------------------------------------------------
   * Cleans up the XHR object to prevent memory leaks or unwanted callbacks.
   */
  XHRLoader.prototype.abort = function () {
    if (this.xhr) this.xhr.abort();
  };

  XHRLoader.prototype.destroy = function () {
    this.abort();
    this.xhr = null;
  };

  /**
   * EXPORT / GLOBAL REGISTRATION
   * --------------------------------------------------------------------------------------
   * These variables must match the names used in 'init_final.js' or the main player logic.
   */
  window.AvsPlaylistLoader = XHRLoader;
  window.AvsEncryptedLoader = XHRLoader;
  window._avsCryptoSupported = isSupported;

})(window);
