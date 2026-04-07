/**
 * AVS HLS Playlist Decryption Module - JWPlayer Format v1.3.1
 * Deobf from avs-loader-jw-1_3_1.js by Lam
 *
 * Changes from v1.2.0:
 * 1. Ciphertext (_t= tokens joined) is base64url-decoded INSIDE avsDecrypt
 *    (v1.2.0: caller did charCodeAt() → Uint8Array; v1.3.1: caller passes raw string)
 * 2. avsDecrypt parameter order changed:
 *    v1.2.0: (cipher, edgeTag, proxyDigest, requestTrace, cacheNode)
 *    v1.3.1: (cipher, edgeTag, cacheNode, proxyDigest, requestTrace)
 *    HMAC sign string unchanged: `${proxyDigest}:${requestTrace}:${cacheNode}`
 * 3. AvsDecryptPlaylist: credentials changed from 'same-origin' to 'omit'
 * 4. Content-Length check: AvsEncryptedLoader now validates byteLength > 0
 */
(function (window) {
  'use strict';

  const isSupported = !!(
    window.crypto && window.crypto.subtle && window.crypto.subtle.importKey
  );

  function base64urlToBytes(str) {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    s += '=='.slice(0, (2 - (s.length % 4)) % 4);
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // v1.3.1: ciphertext param is now a base64url STRING, decoded internally
  async function avsDecrypt(ciphertext, edgeTag, cacheNode, proxyDigest, requestTrace) {
    if (!isSupported) throw new Error('Web Crypto not supported');

    const keyBytes = base64urlToBytes(edgeTag);

    const hmacKey = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );

    // Sign order unchanged from v1.2.0
    const signInput = new TextEncoder().encode(`${proxyDigest}:${requestTrace}:${cacheNode}`);
    const aesKeyMaterial = await crypto.subtle.sign('HMAC', hmacKey, signInput);

    const aesKey = await crypto.subtle.importKey(
      'raw', aesKeyMaterial, { name: 'AES-GCM' }, false, ['decrypt']
    );

    const iv = keyBytes.slice(0, 12);

    // v1.3.1: ciphertext is base64url-decoded here (not by caller)
    const ciphertextBytes = base64urlToBytes(ciphertext);

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, aesKey, ciphertextBytes
    );
    return new TextDecoder().decode(plaintext);
  }

  function makeGetHeader(nd) {
    return (name) => {
      if (nd?.getResponseHeader) return nd.getResponseHeader(name) || '';
      if (nd?.headers?.get)      return nd.headers.get(name) || '';
      return '';
    };
  }

  function formatM3U8(plaintext, extinfLines, urlLines) {
    // Reassemble: EXTINF lines interleaved with decrypted URL lines
    if (extinfLines && extinfLines.length > 0) {
      let out = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n";
      extinfLines.forEach((extinf, i) => {
        out += extinf + '\n' + (urlLines[i] || '') + '\n';
      });
      out += '#EXT-X-ENDLIST\n';
      return out;
    }
    return plaintext;
  }

  window._avsCryptoSupported = isSupported;

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
          const proxyDigest  = decodeURIComponent(getH('X-Proxy-Digest') || 'anon');

          if (!edgeTag || !cacheNode)
            return callbacks.onSuccess(response, stats, context, nd);

          let rawText = typeof response.data === 'string'
            ? response.data
            : new TextDecoder().decode(response.data);

          const lines   = rawText.split('\n');
          const tTokens = [];
          const extinfs = [];
          const urls    = [];
          let isNewFmt  = false;

          for (const line of lines) {
            const l = line.trim();
            if (!l) continue;
            if (l.startsWith('#EXTINF:') || l.startsWith('#EXT-X-ENDLIST')) {
              extinfs.push(l);
            } else if (!l.startsWith('#')) {
              if (/[?&]_c=[0-9]+/.test(l)) isNewFmt = true;
              const m = l.match(/[?&]_t=([^&\s]+)/);
              if (m) tTokens.push(m[1]);
              else   urls.push(l);
            }
          }

          if (!isNewFmt || !tTokens.length)
            return callbacks.onSuccess(response, stats, context, nd);

          // v1.3.1: pass joined token string directly (base64url decoded inside avsDecrypt)
          const ciphertext = tTokens.join('');

          // v1.3.1 param order: (cipher, edgeTag, cacheNode, proxyDigest, requestTrace)
          avsDecrypt(ciphertext, edgeTag, cacheNode, proxyDigest, requestTrace)
            .then(plaintext => {
              response.data = formatM3U8(plaintext, extinfs, plaintext.split('\n').filter(l => l && !l.startsWith('#')));
              callbacks.onSuccess(response, stats, context, nd);
            })
            .catch(err => callbacks.onError(
              { code: 0, text: `AVS decrypt: ${err.message}` }, context, null, nd
            ));
        }
      }));
    };
  };

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
          const data = response.data;
          let bytes;
          if (data instanceof Uint8Array) bytes = data;
          else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
          else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          else return callbacks.onError({ code: 0, text: 'empty segment' }, context, null, nd);

          if (!bytes || bytes.byteLength <= 0)
            return callbacks.onError({ code: 0, text: 'empty segment' }, context, null, nd);

          response.data = bytes.slice(0).buffer;
          callbacks.onSuccess(response, stats, context, nd);
        }
      }));
    };
  };

  window.AvsDecryptPlaylist = async function (url) {
    // v1.3.1: credentials changed to 'omit'
    const resp = await fetch(url, { credentials: 'omit' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const edgeTag      = resp.headers.get('X-Edge-Tag')      || '';
    const cacheNode    = resp.headers.get('X-Cache-Node')    || '';
    const requestTrace = resp.headers.get('X-Request-Trace') || '0';
    const proxyDigest  = decodeURIComponent(resp.headers.get('X-Proxy-Digest') || 'anon');

    const rawText = await resp.text();
    if (!edgeTag || !cacheNode) return rawText;

    const lines   = rawText.split('\n');
    const tTokens = [];

    for (const line of lines) {
      const l = line.trim();
      if (!l || l.startsWith('#')) continue;
      const m = l.match(/[?&]_t=([^&\s]+)/);
      if (m) tTokens.push(m[1]);
    }

    const ciphertext = tTokens.join('');
    if (!ciphertext) return rawText;

    const plaintext = await avsDecrypt(ciphertext, edgeTag, cacheNode, proxyDigest, requestTrace);

    const origin = window.location.origin;
    return plaintext
      .split('\n')
      .map(line => (line && !line.startsWith('#') && line.startsWith('/'))
        ? origin + line : line)
      .join('\n');
  };

}(window));