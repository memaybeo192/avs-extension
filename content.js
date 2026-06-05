(function() {
    'use strict';

    // ── NETWORK INTERCEPTOR ──────────────────────────────────
    (function installNetworkDebugger() {
        const _origFetch = window.fetch;
        window.fetch = async function(...args) {
            let url = '';
            try {
                const r = args[0];
                if (typeof r === 'string')       url = r;
                else if (r instanceof URL)        url = r.href;
                else if (r instanceof Request)    url = r.url;
                else if (r && r.url != null)      url = String(r.url);
            } catch { url = ''; }

            // credentials: omit để tránh lỗi CORS khi server trả về Access-Control-Allow-Origin: *
            if (url && (url.includes('storage.googleapiscdn.com') || url.includes('googleusercontent.com'))) {
                const init = Object.assign({}, args[1] || {});
                init.credentials = 'omit';
                args = [args[0], init];
            }

            try {
                const response = await _origFetch.apply(this, args);
                if (response.status === 403 && url && url.includes('storage.googleapiscdn')) {
                    const clonedRes = response.clone();
                    const errorText = await clonedRes.text();
                    if (errorText.includes('Bot detected')) {
                        console.error(`🚨 [403 BOT DETECTED] Cloudflare chặn chunk: ${url.split('?')[0]}`);
                    }
                }
                return response;
            } catch (err) { return _origFetch.apply(this, args); }
        };
    })();

    // ── AVS-SHIELD NEUTRALIZER ───────────────────────────────

    // avs-shield phát hiện DevTools bằng cách log mảng 50 phần tử rồi đo thời gian
    const _origLog = console.log;
    console.log = function(...args) {
        if (args.length === 1 && Array.isArray(args[0]) && args[0].length === 50) return;
        return _origLog.apply(this, args);
    };
    console.clear = function() {};
    const _origTable = console.table;
    console.table = function() {};

    const _origDefProp = Object.defineProperty;
    Object.defineProperty = function(obj, prop, descriptor) {
        if (prop === 'id' && obj instanceof Element && descriptor && typeof descriptor.get === 'function') {
            return obj;
        }
        return _origDefProp.call(Object, obj, prop, descriptor);
    };
    Object.defineProperty.toString = () => 'function defineProperty() { [native code] }';

    const _origFunction = Function;
    const _FuncProto = Function.prototype;
    // Chặn avs-shield tạo hàm chứa debugger statement
    const SafeFunction = function(...args) {
        if (args.length === 1 && typeof args[0] === 'string' && args[0].includes('debugger')) {
            return function() {};
        }
        return _origFunction(...args);
    };
    SafeFunction.prototype = _FuncProto;
    try {
        _origDefProp.call(Object, _FuncProto, 'constructor', {
            value: SafeFunction, writable: true, configurable: true,
        });
    } catch(e) {}

    // Chặn avs-shield reload trang
    try {
        Location.prototype.reload = function() {};
    } catch(e) {}
    try {
        _origDefProp.call(Object, Location.prototype, 'href', {
            get() { return this.toString(); },
            set(url) {
                const curr = this.toString();
                // Chặn self-reload (gán cùng URL) — pattern reload của avs-shield
                if (!url || url === curr || url === curr + '#') return;
                if (typeof url === 'string' && url.includes('devtools-warning')) return;
                history.pushState(null, '', url);
            },
            configurable: true
        });
    } catch(e) {}

    // Chặn các event listener dùng để khoá DevTools, chuột phải, copy
    const _origAEL = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (typeof listener === 'function') {
            const src = listener.toString();
            if (
                (type === 'keydown'      && src.includes('F12')           && src.includes('preventDefault')) ||
                (type === 'contextmenu' && src.includes('preventDefault') && src.length < 200) ||
                (type === 'selectstart' && src.includes('preventDefault')) ||
                (type === 'dragstart'   && src.includes('preventDefault')) ||
                (type === 'copy'        && src.includes('preventDefault') && src.length < 200)
            ) { return; }
        }
        return _origAEL.call(this, type, listener, options);
    };
    EventTarget.prototype.addEventListener.toString = () => 'function addEventListener() { [native code] }';

    // ── PLAYER FRAME ─────────────────────────────────────────
    const isPlayerFrame = location.hostname.includes('googleapiscdn.com');

    if (isPlayerFrame) {

        // dumpAvsLoader removed (debug-only)

        // ── TOAST "XEM NGAY" FIX ────────────────────────────
        // Dùng touchstart thay click để phản hồi chính xác trên mobile
        const fixPlayerToastTouch = () => {
            const handleToastAction = (e) => {
                const nextBtn = e.target.closest('#avs-next-btn');
                if (nextBtn) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    nextBtn.innerHTML = "Đang chuyển...";
                    nextBtn.style.opacity = "0.5";
                    window.parent.postMessage({ type: 'AVS_FORCE_NEXT' }, '*');
                    return;
                }

                const closeBtn = e.target.closest('#avs-next-close');
                if (closeBtn) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    const toast = document.getElementById('avs-next-toast');
                    if (toast) toast.style.display = 'none';
                }
            };

            window.addEventListener('touchstart', handleToastAction, { passive: false, capture: true });
            window.addEventListener('click', handleToastAction, true);
        };

        fixPlayerToastTouch();

        // ── AD KILL ──────────────────────────────────────────
        const style = document.createElement('style');
        style.textContent = `
            #avs-pause-ad, .avs-pause-ad-box, .avs-pause-ad-img, .avs-pause-ad-close,
            .avs-pause-ad-label, .avs-pause-ad-link, #avs-banner-overlay,
            .avs-banner-img-link, .avs-banner-img, .avs-banner-close {
                display: none !important; visibility: hidden !important; pointer-events: none !important;
            }
        `;
        document.documentElement.appendChild(style);

        const _origGetById = Document.prototype.getElementById;
        const _docQSA      = Document.prototype.querySelectorAll;
        Document.prototype.getElementById = function(id) {
            if (id === 'avs-pause-ad' || id === 'avs-banner-overlay') return null;
            return _origGetById.call(this, id);
        };
        const killAd = () => {
            _origGetById.call(document, 'avs-pause-ad')?.remove();
            _origGetById.call(document, 'avs-banner-overlay')?.remove();
            _docQSA.call(document, '.avs-pause-ad-box,.avs-pause-ad-img,.avs-pause-ad-close')
                .forEach(el => el.remove());
        };
        const hookVideo = (v) => {
            if (v._avsHooked) return;
            v._avsHooked = true;
            v.addEventListener('pause', killAd, true);
            v.addEventListener('play',  killAd, true);
        };
        // Initial run
        document.querySelectorAll('video').forEach(hookVideo);
        killAd();
        // MutationObserver thay setInterval — chỉ chạy khi DOM thực sự thay đổi
        const _adObserver = new MutationObserver(() => {
            document.querySelectorAll('video').forEach(hookVideo);
            killAd();
        });
        _adObserver.observe(document.documentElement, { childList: true, subtree: true });

        // ── ADAPTIVE PLAYLIST RESOLVER ───────────────────────
        //
        // Native-first + plaintext-capture-first pipeline:
        //   1. Reuse plaintext M3U8 captured after the site's own decrypt.
        //   2. Ask native site helpers when they exist.
        //   3. Pass captured playlist text + response headers to _avsDecryptM3u8().
        //   4. Fall back to legacy WebCrypto cache for old v1.3.x-style flows.

        const PLAYLIST_HEADERS = [
            'X-Envelope',
            'X-Edge-Tag',
            'X-Cache-Node',
            'X-Request-Trace',
            'X-Proxy-Digest'
        ];

        let _lastKeyBytes       = null; // raw HMAC key bytes; diagnostic output only exposes length/hash
        let _lastSignInput      = null; // raw sign input; diagnostic output only exposes length/hash
        let _lastCiphertext     = null; // raw ciphertext; diagnostic output only exposes byteLength
        let _playlistUrl        = null; // best current playlist URL candidate
        let _playlistCandidates = [];
        let _lastPlaylistText   = '';
        let _lastPlaylistHeaders = {};
        let _lastPlaintext      = '';
        let _lastPlaintextSource = '';
        let _segmentCount       = 0;
        let _resolverLastSource = '';
        let _resolverErrors     = [];

        function rememberResolverError(source, err) {
            const message = err && err.message ? err.message : String(err || 'unknown');
            _resolverErrors.push({ source, message, t: Date.now() });
            if (_resolverErrors.length > 8) _resolverErrors.shift();
            console.warn(`[AVS-Ext] Resolver ${source} failed: ${message}`);
        }

        function hashBytes(bytes) {
            if (!bytes) return '';
            let hash = 2166136261;
            for (let i = 0; i < bytes.length; i++) {
                hash ^= bytes[i];
                hash = Math.imul(hash, 16777619) >>> 0;
            }
            return hash.toString(16);
        }

        function toBytes(data) {
            if (!data) return null;
            if (data instanceof ArrayBuffer) return new Uint8Array(data);
            if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            return null;
        }

        function safeLength(value) {
            return value && (value.byteLength ?? value.length) || 0;
        }

        function normalizeUrl(url, base = location.href) {
            try {
                const text = String(url || '');
                return text.startsWith('http') ? text : new URL(text, base).href;
            } catch {
                return String(url || '');
            }
        }

        function rememberPlaylistUrl(url) {
            const normalized = normalizeUrl(url);
            if (!normalized) return;
            _playlistUrl = normalized;
            if (!_playlistCandidates.includes(normalized)) {
                _playlistCandidates.push(normalized);
                if (_playlistCandidates.length > 8) _playlistCandidates.shift();
            }
        }

        function isSegmentUrl(url) {
            return /\/chunks\/.+\/video\d+\.html|\.ts([?#]|$)|si=\d+|seq=\d+|\/hls\/[0-9a-f]{24}\.ts/i.test(String(url || ''));
        }

        function isPlaylistCandidate(url) {
            const text = String(url || '');
            const lower = text.toLowerCase();
            if (!text || isSegmentUrl(text)) return false;
            if (/lh\d+\.googleusercontent\.com/i.test(text) &&
                !lower.includes('.m3u8') &&
                !lower.includes('playlist') &&
                !/[?&]_(?:c|t)=/i.test(text)) {
                return false;
            }
            return lower.includes('.m3u8') ||
                lower.includes('playlist') ||
                /[?&]_(?:c|t)=/i.test(text) ||
                (lower.includes('googleapiscdn.com') &&
                    !lower.includes('/static/') &&
                    !lower.includes('/admin/api/ads/'));
        }

        function isLikelyM3u8(text) {
            if (typeof text !== 'string' || !text.trim()) return false;
            if (text.includes('#EXTM3U')) return true;
            const segs = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
            return segs.length > 0 && /^(https?:\/\/|\/|[^?#\s]+\.ts([?#]|$))/i.test(segs[0]);
        }

        function isEncryptedPlaylistText(text) {
            return /[?&]_c=\d+/i.test(String(text || '')) || /[?&]_t=/i.test(String(text || ''));
        }

        function isUsablePlaintextM3u8(text) {
            return isLikelyM3u8(text) && !isEncryptedPlaylistText(text);
        }

        function plaintextLooksComplete(text) {
            const urls = extractSegmentUrls(text);
            if (urls.length > 1) return true;
            if (!urls.length) return false;
            return isNestedPlaylistUrl(urls[0]);
        }

        function capturePlaintext(text, source) {
            if (!isUsablePlaintextM3u8(text)) return false;
            _lastPlaintext = text;
            _lastPlaintextSource = source;
            const segs = extractSegmentUrls(text);
            if (segs.length > 0 && plaintextLooksComplete(text) && !segs.every(isNestedPlaylistUrl)) {
                _segmentCount = segs.length;
                window.parent.postMessage({ type: 'AVS_READY', count: segs.length }, '*');
            }
            return true;
        }

        function snapshotHeaders(headersLike) {
            const out = {};
            try {
                for (const name of PLAYLIST_HEADERS) {
                    let value = '';
                    if (headersLike && typeof headersLike.get === 'function') {
                        value = headersLike.get(name) || headersLike.get(name.toLowerCase()) || '';
                    } else if (headersLike && typeof headersLike === 'object') {
                        value = headersLike[name] || headersLike[name.toLowerCase()] || '';
                    }
                    if (value) {
                        out[name] = value;
                        out[name.toLowerCase()] = value;
                    }
                }
            } catch {}
            return out;
        }

        function mergeHeaders(headers) {
            const snap = snapshotHeaders(headers);
            if (Object.keys(snap).length) _lastPlaylistHeaders = Object.assign({}, _lastPlaylistHeaders, snap);
            return snap;
        }

        function hasUsefulPlaylistHeaders(headers) {
            const snap = snapshotHeaders(headers);
            return !!(snap['X-Envelope'] || snap['X-Edge-Tag'] || snap['x-envelope'] || snap['x-edge-tag']);
        }

        function publicHeaderState() {
            const out = {};
            for (const name of PLAYLIST_HEADERS) {
                const value = _lastPlaylistHeaders[name] || _lastPlaylistHeaders[name.toLowerCase()] || '';
                out[name] = { present: !!value, length: value ? String(value).length : 0 };
            }
            return out;
        }

        // Legacy v1.3.x-style fallback: reuse key/sign/ciphertext captured from WebCrypto hooks.
        async function avsDecryptCached(ciphertext) {
            if (!_lastKeyBytes || !_lastSignInput) {
                throw new Error('Chưa có key. Hãy đợi video load rồi thử lại.');
            }
            const hmacKey = await crypto.subtle.importKey(
                'raw', _lastKeyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
            );
            const aesMat = await crypto.subtle.sign('HMAC', hmacKey, _lastSignInput);
            const aesKey = await crypto.subtle.importKey(
                'raw', aesMat, { name: 'AES-GCM' }, false, ['decrypt']
            );
            const iv = _lastKeyBytes.slice(0, 12);
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext);
            return new TextDecoder().decode(plain);
        }

        function extractSegmentUrls(playlistText) {
            const base = _playlistUrl || location.href;
            return String(playlistText || '')
                .split('\n')
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('#'))
                .map(url => {
                    if (/^https?:\/\//i.test(url)) return url;
                    try { return new URL(url, base).href; } catch { return url; }
                });
        }

        function isNestedPlaylistUrl(url) {
            const text = String(url || '');
            return /\.m3u8(?:[?#]|$)/i.test(text) || /\/playlist(?:[/?#]|$)/i.test(text);
        }

        function pickBestVariantUrl(masterText) {
            const lines = String(masterText || '').split('\n').map(l => l.trim());
            let pendingBandwidth = -1;
            let best = null;

            for (const line of lines) {
                if (!line) continue;
                if (line.startsWith('#EXT-X-STREAM-INF')) {
                    const match = line.match(/BANDWIDTH=(\d+)/i);
                    pendingBandwidth = match ? parseInt(match[1], 10) || 0 : 0;
                    continue;
                }
                if (line.startsWith('#')) continue;
                if (!isNestedPlaylistUrl(line)) continue;

                const bandwidth = pendingBandwidth >= 0 ? pendingBandwidth : 0;
                if (!best || bandwidth >= best.bandwidth) {
                    best = { url: line, bandwidth };
                }
                pendingBandwidth = -1;
            }

            return best && best.url;
        }

        async function fetchNestedPlaylistText(url) {
            const nestedUrl = normalizeUrl(url, _playlistUrl || location.href);
            const previousUrl = _playlistUrl;
            rememberPlaylistUrl(nestedUrl);
            const response = await fetch(nestedUrl, { credentials: 'same-origin' });
            mergeHeaders(response.headers);
            const rawText = await response.clone().text();
            _lastPlaylistText = rawText;

            if (isEncryptedPlaylistText(rawText) && typeof window._avsDecryptM3u8 === 'function') {
                const decrypted = await window._avsDecryptM3u8(rawText, Object.assign({}, _lastPlaylistHeaders));
                if (isLikelyM3u8(decrypted)) return decrypted;
            }

            if (isLikelyM3u8(rawText)) return rawText;
            _playlistUrl = previousUrl || _playlistUrl;
            throw new Error('Nested playlist fetch không trả về M3U8 hợp lệ.');
        }

        async function expandPlaylistToSegmentUrls(playlistText, depth = 0) {
            if (depth > 2) throw new Error('Nested playlist quá sâu.');
            const urls = extractSegmentUrls(playlistText);
            if (!urls.length) return [];

            const segmentUrls = urls.filter(url => !isNestedPlaylistUrl(url));
            if (segmentUrls.length > 1) {
                return segmentUrls;
            }

            const bestVariant = pickBestVariantUrl(playlistText) || urls.find(isNestedPlaylistUrl);
            if (!bestVariant && urls.length === 1) {
                try {
                    const probeText = await fetchNestedPlaylistText(urls[0]);
                    return expandPlaylistToSegmentUrls(probeText, depth + 1);
                } catch (err) {
                    rememberResolverError('single-url-nested-probe', err);
                    return segmentUrls.length ? segmentUrls : urls;
                }
            }
            if (!bestVariant) return segmentUrls;

            const nestedText = await fetchNestedPlaylistText(bestVariant);
            return expandPlaylistToSegmentUrls(nestedText, depth + 1);
        }

        async function resolveViaCapturedPlaintext() {
            if (!isUsablePlaintextM3u8(_lastPlaintext)) throw new Error('Chưa có plaintext M3U8 cache.');
            if (!plaintextLooksComplete(_lastPlaintext)) {
                throw new Error('Plaintext cache chỉ có 1 direct URL; thử native playlist trước.');
            }
            _resolverLastSource = `captured-plaintext:${_lastPlaintextSource || 'unknown'}`;
            return _lastPlaintext;
        }

        async function resolveViaNativeUrl() {
            if (!_playlistUrl) throw new Error('Chưa capture được playlist URL.');
            if (typeof window.AvsDecryptPlaylist !== 'function') {
                throw new Error('Không tìm thấy window.AvsDecryptPlaylist.');
            }
            const text = await window.AvsDecryptPlaylist(_playlistUrl);
            if (!isLikelyM3u8(text)) throw new Error('AvsDecryptPlaylist trả về playlist không hợp lệ.');
            capturePlaintext(text, 'native-url');
            _resolverLastSource = 'native-url:AvsDecryptPlaylist';
            return text;
        }

        async function resolveViaNativeTextAndHeaders() {
            if (typeof window._avsDecryptM3u8 !== 'function') {
                throw new Error('Không tìm thấy window._avsDecryptM3u8.');
            }
            if (!_lastPlaylistText) {
                if (!_playlistUrl) throw new Error('Chưa có playlist text hoặc URL để fetch lại.');
                const response = await fetch(_playlistUrl, { credentials: 'same-origin' });
                mergeHeaders(response.headers);
                _lastPlaylistText = await response.clone().text();
            }
            const text = await window._avsDecryptM3u8(_lastPlaylistText, Object.assign({}, _lastPlaylistHeaders));
            if (!isLikelyM3u8(text)) throw new Error('_avsDecryptM3u8 trả về playlist không hợp lệ.');
            capturePlaintext(text, 'native-text-headers');
            _resolverLastSource = 'native-text-headers:_avsDecryptM3u8';
            return text;
        }

        async function resolveViaCryptoCache() {
            if (!_lastCiphertext) throw new Error('Không có ciphertext backup.');
            const text = await avsDecryptCached(_lastCiphertext);
            if (!isLikelyM3u8(text)) throw new Error('Legacy crypto cache trả về playlist không hợp lệ.');
            capturePlaintext(text, 'legacy-crypto-cache');
            _resolverLastSource = 'legacy-crypto-cache';
            return text;
        }

        async function resolvePlaylistText() {
            _resolverErrors = [];
            const resolvers = [
                ['native-url', resolveViaNativeUrl],
                ['native-text-headers', resolveViaNativeTextAndHeaders],
                ['captured-plaintext', resolveViaCapturedPlaintext],
                ['legacy-crypto-cache', resolveViaCryptoCache]
            ];

            for (const [name, resolver] of resolvers) {
                try {
                    return await resolver();
                } catch (err) {
                    rememberResolverError(name, err);
                }
            }

            throw new Error('Không resolve được playlist. Mở player iframe console và chạy window.__AVS_DEBUG_STATE__() để lấy debug state.');
        }

        async function getSegmentUrls() {
            const plaintext = await resolvePlaylistText();
            const segs = await expandPlaylistToSegmentUrls(plaintext);
            if (!segs.length || !/^https?:\/\//i.test(segs[0])) {
                throw new Error('Playlist không hợp lệ. Thử tải lại trang.');
            }
            _segmentCount = segs.length;
            console.log('[AVS-Ext] Resolver result:', {
                source: _resolverLastSource,
                total: segs.length,
                firstUrls: segs.slice(0, 5),
                playlistUrl: _playlistUrl,
                candidates: _playlistCandidates.slice(),
                hasEnvelope: !!(_lastPlaylistHeaders['X-Envelope'] || _lastPlaylistHeaders['x-envelope']),
                hasPlaintext: !!_lastPlaintext,
                plaintextSource: _lastPlaintextSource
            });
            return segs;
        }

        function capturePlaylistResponse(url, response) {
            if (!response || !response.headers || isSegmentUrl(url)) return;
            const usefulHeaders = hasUsefulPlaylistHeaders(response.headers);
            if (usefulHeaders || isPlaylistCandidate(url)) {
                rememberPlaylistUrl(url);
                mergeHeaders(response.headers);
            }
            if (usefulHeaders || isPlaylistCandidate(url)) {
                response.clone().text().then(text => {
                    if (!text) return;
                    if (isLikelyM3u8(text) || isEncryptedPlaylistText(text)) {
                        _lastPlaylistText = text;
                        capturePlaintext(text, 'fetch-response');
                    }
                }).catch(() => {});
            }
        }

        // Hook crypto.subtle để capture key + signInput + ciphertext
        const subtle     = crypto.subtle;
        const _importKey = subtle.importKey.bind(subtle);
        const _sign      = subtle.sign.bind(subtle);
        const _decrypt   = subtle.decrypt.bind(subtle);

        subtle.importKey = async function(format, keyData, algorithm, extractable, usages) {
            const result = await _importKey(format, keyData, algorithm, extractable, usages);
            try {
                const algoName = typeof algorithm === 'string' ? algorithm : algorithm?.name;
                if (algoName === 'HMAC' && (keyData instanceof ArrayBuffer || keyData instanceof Uint8Array)) {
                    _lastKeyBytes = new Uint8Array(keyData instanceof ArrayBuffer ? keyData : keyData.buffer,
                        keyData.byteOffset ?? 0, keyData.byteLength ?? keyData.length).slice();
                }
            } catch(e) {}
            return result;
        };

        // Capture HMAC sign input. Newer AVS may use "uid:trace:cacheNode[:envSnapshot]".
        subtle.sign = async function(algorithm, key, data) {
            const result = await _sign(algorithm, key, data);
            try {
                _lastSignInput = new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer,
                    data.byteOffset ?? 0, data.byteLength ?? data.length).slice();
            } catch(e) {}
            return result;
        };

        subtle.decrypt = async function(algo, key, data) {
            try {
                _lastCiphertext = data instanceof ArrayBuffer ? data.slice(0)
                    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength).buffer.slice(0);
            } catch(e) {}

            const result = await _decrypt(algo, key, data);

            try {
                const plain = new TextDecoder().decode(result);
                capturePlaintext(plain, 'crypto-decrypt-hook');
            } catch(e) {}
            return result;
        };

        // Capture playlist URL từ fetch + XHR (bỏ qua segment URLs)
        const _origFetch = window.fetch;
        window.fetch = async function(input, init) {
            const url = (typeof input === 'string') ? input
                      : (input instanceof Request)  ? input.url : String(input);
            const strUrl = String(url);
            if (isPlaylistCandidate(strUrl)) rememberPlaylistUrl(strUrl);

            const response = await _origFetch.call(this, input, init);
            try { capturePlaylistResponse(strUrl, response); } catch(e) {}
            return response;
        };

        const _origXHROpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            const strUrl = String(url);
            if (isPlaylistCandidate(strUrl)) rememberPlaylistUrl(strUrl);
            this._avsUrl = strUrl;
            return _origXHROpen.call(this, method, url, ...rest);
        };

        const _origXHRSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function(...args) {
            this.addEventListener('load', function() {
                try {
                    const allHeaders = this.getAllResponseHeaders();
                    const lower = String(allHeaders || '').toLowerCase();
                    if (!isSegmentUrl(this._avsUrl) && (lower.includes('x-envelope') || lower.includes('x-edge-tag') || isPlaylistCandidate(this._avsUrl))) {
                        rememberPlaylistUrl(this._avsUrl);
                        const headers = {};
                        for (const name of PLAYLIST_HEADERS) {
                            if (lower.includes(name.toLowerCase())) {
                                const value = this.getResponseHeader(name);
                                if (value) headers[name] = value;
                            }
                        }
                        mergeHeaders(headers);
                        if (typeof this.responseText === 'string' && this.responseText && (isLikelyM3u8(this.responseText) || isEncryptedPlaylistText(this.responseText))) {
                            _lastPlaylistText = this.responseText;
                            capturePlaintext(this.responseText, 'xhr-response');
                        }
                    }
                } catch(e) {}
            });
            return _origXHRSend.apply(this, args);
        };

        window.__AVS_DEBUG_STATE__ = function() {
            let g6Diag = null;
            try {
                if (typeof window._avsG6Diag === 'function') g6Diag = window._avsG6Diag();
            } catch (e) {
                g6Diag = { error: e && e.message || String(e) };
            }
            return {
                resolverLastSource: _resolverLastSource,
                resolverErrors: _resolverErrors.slice(),
                segmentCount: _segmentCount,
                playlistUrl: _playlistUrl,
                playlistCandidates: _playlistCandidates.slice(),
                hasPlaylistText: !!_lastPlaylistText,
                playlistTextLength: _lastPlaylistText.length,
                hasPlaintext: !!_lastPlaintext,
                plaintextLength: _lastPlaintext.length,
                plaintextSource: _lastPlaintextSource,
                headers: publicHeaderState(),
                hasEnvelope: !!(_lastPlaylistHeaders['X-Envelope'] || _lastPlaylistHeaders['x-envelope']),
                native: {
                    hasAvsDecryptPlaylist: typeof window.AvsDecryptPlaylist === 'function',
                    hasAvsDecryptM3u8: typeof window._avsDecryptM3u8 === 'function',
                    hasG6Diag: typeof window._avsG6Diag === 'function',
                    hasProbe: !!window._avsProbe
                },
                crypto: {
                    hasKeyBytes: !!_lastKeyBytes,
                    keyBytesLength: safeLength(_lastKeyBytes),
                    keyBytesHash: hashBytes(_lastKeyBytes),
                    hasSignInput: !!_lastSignInput,
                    signInputLength: safeLength(_lastSignInput),
                    signInputHash: hashBytes(_lastSignInput),
                    hasCiphertext: !!_lastCiphertext,
                    ciphertextLength: _lastCiphertext ? _lastCiphertext.byteLength : 0
                },
                g6Diag
            };
        };

        // Download: parallel staggered + Gaussian jitter
        // Segment nhỏ (~50-100ms/chunk) → jitter > segment_time → overlap rất ngắn → CF-safe
        // CONCURRENCY workers chạy lệch pha nhau qua jitter, hiếm khi thực sự concurrent
        const CONCURRENCY    = 2;
        const BURST_SIZE     = 40;
        const BURST_COOLDOWN = 2000;
        const JITTER_MEAN    = 200;   // > segment download time để tránh overlap
        const JITTER_STD     = 80;    // std cao → distribution khó đoán hơn

        // Box-Muller transform → Gaussian jitter, clamp [30, MEAN*3]
        function gaussianJitter() {
            let u, v;
            do { u = Math.random(); } while (u === 0);
            do { v = Math.random(); } while (v === 0);
            const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
            return Math.max(30, Math.min(JITTER_MEAN * 3, JITTER_MEAN + n * JITTER_STD));
        }

        // Lấy origin của main frame động từ document.referrer
        const _mainOrigin = (() => {
            try {
                const ref = document.referrer;
                if (ref) return new URL(ref).origin;
            } catch {}
            try {
                const ao = location.ancestorOrigins;
                if (ao && ao.length > 0) return new URL(ao[0]).origin;
            } catch {}
            return 'https://animevietsub.name';
        })();

        async function downloadSegments(filename) {
            window.parent.postMessage({ type: 'AVS_PROGRESS', current: 0, total: 0, phase: 'playlist' }, '*');

            let urls;
            try {
                urls = await getSegmentUrls();
            } catch(err) {
                window.parent.postMessage({ type: 'AVS_ERROR', msg: err.message }, '*');
                return;
            }

            const total = urls.length;
            console.log(`[DOWNLOAD] Bắt đầu: ${total} chunks, sequential (CF-safe)`);
            window.parent.postMessage({ type: 'AVS_PROGRESS', current: 0, total, phase: 'download' }, '*');

            try { document.querySelector('video')?.pause(); } catch(e) {}

            const chunks = new Array(total);

            let completed = 0;

            async function fetchChunk(i) {
                await new Promise(r => setTimeout(r, gaussianJitter()));

                let retries     = 4;
                let backoffBase = 5000;

                while (retries > 0) {
                    try {
                        const response = await fetch(urls[i], {
                            method: 'GET',
                            credentials: 'omit', // MV3/Chromium: cross-origin fetch không thể include cookie CDN dù có host_permissions
                            referrer: _mainOrigin + '/',
                            referrerPolicy: 'strict-origin-when-cross-origin',
                            headers: {
                                'Accept': '*/*',
                                'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
                            }
                        });

                        if (!response.ok) {
                            if (response.status === 403 || response.status === 429) {
                                retries--;
                                const wait = backoffBase * Math.pow(2, 4 - retries - 1) + Math.random() * 2000;
                                console.warn(`🚨 [${response.status}] Chunk ${i} bị chặn — nghỉ ${(wait/1000).toFixed(1)}s`);
                                await new Promise(r => setTimeout(r, wait));
                                continue;
                            }
                            throw new Error(`HTTP ${response.status}`);
                        }

                        chunks[i] = await response.arrayBuffer();
                        completed++;
                        window.parent.postMessage({ type: 'AVS_PROGRESS', current: completed, total, phase: 'download' }, '*');
                        return;

                    } catch(e) {
                        retries--;
                        if (retries === 0) {
                            chunks[i] = new ArrayBuffer(0);
                            completed++;
                            window.parent.postMessage({ type: 'AVS_PROGRESS', current: completed, total, phase: 'download' }, '*');
                        } else {
                            await new Promise(r => setTimeout(r, 2000));
                        }
                    }
                }
            }

            // Staggered parallel pool — burst/cooldown mỗi BURST_SIZE chunk
            const queue = Array.from({ length: total }, (_, i) => i);
            let burstCount = 0;

            const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, async () => {
                while (queue.length > 0) {
                    const i = queue.shift();
                    if (i === undefined) break;

                    // Burst cooldown: mỗi BURST_SIZE chunk hoàn thành
                    if (burstCount > 0 && burstCount % BURST_SIZE === 0) {
                        const cooldown = BURST_COOLDOWN + Math.random() * 1000;
                        window.parent.postMessage({ type: 'AVS_COOLDOWN', remaining: Math.ceil(cooldown/1000), current: completed, total }, '*');
                        await new Promise(r => setTimeout(r, cooldown));
                    }
                    burstCount++;

                    await fetchChunk(i);
                }
            });
            await Promise.all(workers);

            const totalBytes = chunks.reduce((s, c) => s + (c?.byteLength ?? 0), 0);
            const merged     = new Uint8Array(totalBytes);
            let offset = 0;
            for (const chunk of chunks) {
                if (chunk?.byteLength) {
                    merged.set(new Uint8Array(chunk), offset);
                    offset += chunk.byteLength;
                }
            }

            const blob    = new Blob([merged], { type: 'video/mp2t' });
            const blobUrl = URL.createObjectURL(blob);
            const a       = document.createElement('a');
            a.href     = blobUrl;
            a.download = filename || `avs_video_${Date.now()}.ts`;
            (document.body ?? document.documentElement).appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => {
                chunks.fill(null);
                merged.fill(0);
                URL.revokeObjectURL(blobUrl);
            }, 10000);

            window.parent.postMessage({ type: 'AVS_DONE', bytes: totalBytes }, '*');
        }

        window.addEventListener('message', (e) => {
            if (e.data?.type === 'AVS_DEBUG_REQUEST') {
                try {
                    window.parent.postMessage({ type: 'AVS_DEBUG_STATE', state: window.__AVS_DEBUG_STATE__() }, '*');
                } catch (err) {
                    window.parent.postMessage({ type: 'AVS_DEBUG_STATE', state: { error: err && err.message || String(err) } }, '*');
                }
                return;
            }

            if (e.data?.type === 'AVS_DOWNLOAD_START') {
                downloadSegments(e.data.filename).catch(err => {
                    window.parent.postMessage({ type: 'AVS_ERROR', msg: err.message }, '*');
                });
            }
        });

        return;
    }

    // ── MAIN FRAME ───────────────────────────────────────────
    window.open = function() { return null; };

    const fixNativeNextEp = () => {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('#avs-next-btn');
            if (!btn) return;

            e.preventDefault();
            e.stopImmediatePropagation();

            console.log("🛠 AVS Cleaner: Đang gọi API chuyển tập nội bộ của web...");

            try {
                const currentEpNode = document.querySelector("ul.list-episode li a[data-movie='playing']");
                if (!currentEpNode) throw new Error("Không tìm thấy tập đang chiếu");

                const episodeId = parseInt(currentEpNode.getAttribute("data-id"));

                // Gọi API nội bộ của web thay vì tự điều hướng
                const nextUrl = window.PLTV.readXml(window.MAIN_URL + '/ajax/get_episode?filmId=' + window.filmInfo.filmID + '&episodeId=' + episodeId, "link");

                if (nextUrl && nextUrl !== '') {
                    window.location.href = nextUrl;
                } else {
                    if (window.fx && window.fx.alertMessage) {
                        window.fx.alertMessage("Thông báo", "Phim này đã hết tập để play!", "info");
                    } else {
                        alert("Phim này đã hết tập để play!");
                    }
                    const toast = document.getElementById('avs-next-toast');
                    if (toast) toast.style.display = 'none';
                }
            } catch (err) {
                console.error("Lỗi khi dùng API nội bộ:", err);
                // Fallback: click nút tập tiếp trên giao diện
                const backupBtn = document.getElementById('btn-nextepisode');
                if (backupBtn) backupBtn.click();
            }
        }, true);
    };

    fixNativeNextEp();

    const buildStyleText = () => `
        .Adv, .ad-center-header, .header-ads-pc, .Ads, .ads_player,
        a[href*="vsbet"], a[href*="6789x.site"], a[href*="yo88"], a[href*="min88"],
        #avs-shield, .avs-shield, [id*="shield"],
        .ads-container, [id*="banner"], [class*="banner"],
        [id*="catfish"], [class*="catfish"], [href*="hide_catfix"],
        [id^="_preload-ads-"],
        div[style*="z-index: 9999"], a[style*="z-index: 99999"],
        a[target="_blank"] > img {
            display: none !important; visibility: hidden !important;
            opacity: 0 !important; height: 0 !important; width: 0 !important;
            pointer-events: none !important; position: absolute !important;
            left: -9999px !important; z-index: -9999 !important;
        }
        body { padding-top: 0 !important; }
    `;
    const injectStyle = () => {
        document.getElementById('avs-cleaner-style')?.remove();
        const s = document.createElement('style');
        s.id = 'avs-cleaner-style';
        s.textContent = buildStyleText();
        document.documentElement.appendChild(s);
    };
    injectStyle();
    window.addEventListener('load', injectStyle);

    const _docQSA = Document.prototype.querySelectorAll;
    const cleaner = () => {
        ['.ads-container','[class*="banner"]','[id*="banner"]',
         '[id*="catfish"]','[class*="catfish"]','[href*="hide_catfix"]',
         '[id^="_preload-ads-"]',
         '.Adv','.ad-center-header',
        ].forEach(sel => _docQSA.call(document, sel).forEach(el => el.remove()));
    };
    cleaner();
    // MutationObserver thay setInterval(500ms)
    new MutationObserver(cleaner).observe(document.documentElement, { childList: true, subtree: true });

    let _playerIframe = null;

    function getPlayerIframe() {
        return Array.from(document.querySelectorAll('iframe'))
            .find(f => f.src?.includes('googleapiscdn.com'));
    }

    function setBtn(text, color, disabled) {
        const btn = document.getElementById('avs-dl-btn');
        if (!btn) return;
        btn.textContent      = text;
        btn.style.background = color;
        btn.disabled         = disabled;
    }

    function injectDownloadButton(segmentCount) {
        const existing = document.getElementById('avs-dl-btn');
        if (existing) {
            existing.textContent     = segmentCount > 0 ? `⬇ Tải video (${segmentCount} phân đoạn)` : existing.textContent;
            existing.disabled        = false;
            existing.style.background = '#27ae60';
            return;
        }

        const btn = document.createElement('button');
        btn.id = 'avs-dl-btn';
        btn.textContent = segmentCount > 0 ? `⬇ Tải video (${segmentCount} phân đoạn)` : '⬇ Tải video';
        btn.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; z-index: 999999;
            padding: 10px 18px; background: #27ae60; color: #fff;
            border: none; border-radius: 8px; font-size: 14px; font-weight: bold;
            cursor: pointer; box-shadow: 0 2px 12px rgba(0,0,0,0.4);
            transition: background 0.2s;
        `;

        btn.addEventListener('click', () => {
            _playerIframe = getPlayerIframe();
            if (!_playerIframe) {
                alert('Không tìm thấy player. Hãy đợi video load xong rồi thử lại.');
                return;
            }
            const rawTitle = document.title
                .replace(/[\\/:*?"<>|]/g, '_')
                .replace(/\s+/g, '_')
                .slice(0, 80);
            const filename = rawTitle ? `${rawTitle}.ts` : `avs_video_${Date.now()}.ts`;

            setBtn('Đang chuẩn bị...', '#8e44ad', true);
            _playerIframe.contentWindow.postMessage({ type: 'AVS_DOWNLOAD_START', filename }, '*');
        });

        document.body.appendChild(btn);
    }

    window.addEventListener('message', (e) => {
        const d = e.data;
        if (!d?.type?.startsWith('AVS_')) return;

        switch (d.type) {
            case 'AVS_DEBUG_STATE':
                window.__AVS_LAST_PLAYER_DEBUG__ = d.state;
                console.log('[AVS-Ext] Player debug state:', d.state);
                break;

            case 'AVS_READY':
                _playerIframe = getPlayerIframe();
                injectDownloadButton(d.count);
                break;

            case 'AVS_PROGRESS':
                if (d.phase === 'playlist') {
                    setBtn('Đang lấy playlist...', '#8e44ad', true);
                } else {
                    const pct = d.total ? Math.round((d.current / d.total) * 100) : 0;
                    setBtn(`⬇ Đang tải... ${d.current}/${d.total} (${pct}%)`, '#2980b9', true);
                }
                break;

            case 'AVS_COOLDOWN': {
                let remaining = d.remaining;
                const pct = d.total ? Math.round((d.current / d.total) * 100) : 0;
                const tick = setInterval(() => {
                    remaining--;
                    if (remaining <= 0) {
                        clearInterval(tick);
                        setBtn(`⬇ Đang tải... ${d.current}/${d.total} (${pct}%)`, '#2980b9', true);
                    } else {
                        setBtn(`⏸ Nghỉ ${remaining}s... ${d.current}/${d.total} (${pct}%)`, '#e67e22', true);
                    }
                }, 1000);
                setBtn(`⏸ Nghỉ ${remaining}s... ${d.current}/${d.total} (${pct}%)`, '#e67e22', true);
                break;
            }

            case 'AVS_DONE': {
                const mb = (d.bytes / 1048576).toFixed(1);
                setBtn(`✓ Xong! ${mb} MB`, '#27ae60', false);
                break;
            }

            case 'AVS_ERROR':
                setBtn('⬇ Tải video (thử lại)', '#e74c3c', false);
                alert(`Lỗi: ${d.msg}`);
                break;
        }
    });

    window.addEventListener('load', () => {
        _playerIframe = getPlayerIframe();
    });

    window.__AVS_REQUEST_PLAYER_DEBUG__ = function() {
        _playerIframe = getPlayerIframe();
        if (!_playerIframe || !_playerIframe.contentWindow) return false;
        _playerIframe.contentWindow.postMessage({ type: 'AVS_DEBUG_REQUEST' }, '*');
        return true;
    };

    // Fallback: nếu JWPlayer không postMessage AVS_READY (không dùng crypto.subtle.decrypt flow),
    // inject button sau timeout khi iframe đã load xong.
    (function fallbackButtonInject() {
        let _injected = false;
        const tryInject = () => {
            if (_injected) return;
            const iframe = getPlayerIframe();
            if (!iframe) return;
            // Chỉ inject nếu button chưa có (AVS_READY chưa fire)
            if (document.getElementById('avs-dl-btn')) { _injected = true; return; }
            _injected = true;
            injectDownloadButton(0); // count=0 = "không rõ số segment"
            // Update text sau khi inject
            const btn = document.getElementById('avs-dl-btn');
            if (btn) btn.textContent = '⬇ Tải video';
        };

        // Thử sau 4s và 8s (JWPlayer có thể load chậm hơn ArtPlayer)
        setTimeout(tryInject, 4000);
        setTimeout(tryInject, 8000);

        // MutationObserver thay setInterval(500ms) — tự disconnect sau khi tìm thấy iframe
        const _iframeObserver = new MutationObserver(() => {
            const iframe = getPlayerIframe();
            if (!iframe) return;
            _iframeObserver.disconnect();
            if (!iframe._avsWatched) {
                iframe._avsWatched = true;
                iframe.addEventListener('load', () => setTimeout(tryInject, 2000));
            }
        });
        _iframeObserver.observe(document.documentElement, { childList: true, subtree: true });
    })();

    // Nhận lệnh chuyển tập từ player frame (AVS_FORCE_NEXT)
    window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'AVS_FORCE_NEXT') {
            console.log("🛠 AVS Cleaner: Nhận lệnh 'Xem Ngay' từ Player. Đang chuyển tập...");

            const realNextBtn = document.getElementById('btn-nextepisode');

            if (realNextBtn) {
                realNextBtn.click();
            } else {
                // Fallback: tự mò link tập tiếp
                const currentEpNode = document.querySelector("ul.list-episode li a[data-movie='playing']");
                const nextEpLink = currentEpNode?.closest('li')?.nextElementSibling?.querySelector('a');

                if (nextEpLink && nextEpLink.href) {
                    window.location.href = nextEpLink.href;
                } else {
                    alert("Đã hết tập hoặc không tìm thấy tập tiếp theo!");
                }
            }
        }
    });

})();
