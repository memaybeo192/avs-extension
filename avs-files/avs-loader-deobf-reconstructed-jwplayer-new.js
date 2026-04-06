/**
 * AVS HLS Playlist Decryption Module - JWPlayer Format
 * Deobf - reconstructed from avs-loader-new-obf-jwplayer.min.js
 *
 * Changes from ArtPlayer version:
 * 1. M3U8 response contains URLs with `_c=` parameter.
 * 2. Ciphertext is constructed by extracting `_t=` from each URL line.
 * 3. X-Proxy-Digest is URL-encoded.
 * 4. EXTINF headers prepended if raw output is just URL list.
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

  async function avsDecrypt(ciphertext, edgeTag, proxyDigest, requestTrace, cacheNode) {
    if (!isSupported) throw new Error('Web Crypto not supported');

    const keyBytes = base64urlToBytes(edgeTag);

    const hmacKey = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );

    const signInput = new TextEncoder().encode(`${proxyDigest}:${requestTrace}:${cacheNode}`);
    const aesKeyMaterial = await crypto.subtle.sign('HMAC', hmacKey, signInput);

    const aesKey = await crypto.subtle.importKey(
      'raw', aesKeyMaterial, { name: 'AES-GCM' }, false, ['decrypt']
    );

    const iv = keyBytes.slice(0, 12);

    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext);
    return new TextDecoder().decode(plaintext);
  }

  function toArrayBuffer(data) {
    if (!data) return null;
    if (data instanceof ArrayBuffer) return data;
    if (ArrayBuffer.isView(data))
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    if (typeof data === 'string') {
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
  
  // Format M3U8 string if needed
  function formatM3U8(plaintext) {
      if (!plaintext.includes('#EXTM3U')) {
          const segs = plaintext.split('\n').map(l => l.trim()).filter(l => l);
          let m3u8 = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n";
          segs.forEach(s => {
              m3u8 += "#EXTINF:10.0,\n" + s + "\n";
          });
          m3u8 += "#EXT-X-ENDLIST\n";
          return m3u8;
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
          const proxyDigest  = decodeURIComponent(getH('X-Proxy-Digest') || '');

          if (!edgeTag || !cacheNode)
            return callbacks.onSuccess(response, stats, context, nd);

          let rawText = '';
          if (typeof response.data === 'string') {
              rawText = response.data;
          } else if (response.data instanceof ArrayBuffer || ArrayBuffer.isView(response.data)) {
              rawText = new TextDecoder().decode(response.data);
          } else {
              return callbacks.onSuccess(response, stats, context, nd);
          }

          const lines = rawText.split('\n');
          const isNewFormat = lines.some(l => l && !l.startsWith('#') && /[?&]_c=[0-9]+/.test(l));

          if (isNewFormat) {
              const tTokens = lines
                  .filter(l => l && !l.startsWith('#'))
                  .map(l => { const m = l.match(/[?&]_t=([^&\s]+)/); return m ? m[1] : ''; })
                  .join('');
              if (!tTokens) return callbacks.onSuccess(response, stats, context, nd);

              const ciphertextBuf = new Uint8Array(tTokens.length);
              for (let i = 0; i < tTokens.length; i++) {
                  ciphertextBuf[i] = tTokens.charCodeAt(i) & 0xff;
              }
              
              avsDecrypt(ciphertextBuf.buffer, edgeTag, proxyDigest, requestTrace, cacheNode)
                .then(plaintext => {
                  response.data = formatM3U8(plaintext);
                  callbacks.onSuccess(response, stats, context, nd);
                })
                .catch(err => callbacks.onError(
                  { code: 0, text: `AVS decrypt: ${err.message}` }, context, null, nd
                ));
          } else {
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
          const bytes = toUint8Array(response.data);
          if (!bytes || bytes.byteLength <= 0)
            return callbacks.onError({ code: 0, text: 'empty segment' }, context, null, nd);
          response.data = bytes.slice(0).buffer;
          callbacks.onSuccess(response, stats, context, nd);
        }
      }));
    };
  };

  window.AvsDecryptPlaylist = async function (url) {
    const resp = await fetch(url, { credentials: 'omit' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const edgeTag      = resp.headers.get('X-Edge-Tag')      || '';
    const cacheNode    = resp.headers.get('X-Cache-Node')    || '';
    const requestTrace = resp.headers.get('X-Request-Trace') || '0';
    const proxyDigest  = decodeURIComponent(resp.headers.get('X-Proxy-Digest') || '');

    const rawText = await resp.text();

    if (!edgeTag || !cacheNode) return rawText;

    const lines = rawText.split('\n');
    const isNewFormat = lines.some(l => l && !l.startsWith('#') && /[?&]_c=[0-9]+/.test(l));

    let plaintext;
    if (isNewFormat) {
        const tTokens = lines
            .filter(l => l && !l.startsWith('#'))
            .map(l => { const m = l.match(/[?&]_t=([^&\s]+)/); return m ? m[1] : ''; })
            .join('');
        if (!tTokens) return rawText;

        const ciphertextBuf = new Uint8Array(tTokens.length);
        for (let i = 0; i < tTokens.length; i++) {
            ciphertextBuf[i] = tTokens.charCodeAt(i) & 0xff;
        }

        plaintext = await avsDecrypt(ciphertextBuf.buffer, edgeTag, proxyDigest, requestTrace, cacheNode);
        plaintext = formatM3U8(plaintext);
    } else {
        const bytes = new Uint8Array(rawText.length);
        for (let i = 0; i < rawText.length; i++) bytes[i] = rawText.charCodeAt(i) & 0xff;
        plaintext = await avsDecrypt(bytes.buffer, edgeTag, proxyDigest, requestTrace, cacheNode);
    }

    const origin = window.location.origin;
    return plaintext
      .split('\n')
      .map(line => (line && !line.startsWith('#') && line.startsWith('/'))
        ? origin + line : line)
      .join('\n');
  };

}(window));
