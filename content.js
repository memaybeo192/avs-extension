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

        (function dumpAvsLoader() {
            const _origCreate = document.createElement.bind(document);
            document.createElement = function(tag) {
                const el = _origCreate(tag);
                if (tag.toLowerCase() !== 'script') return el;

                const srcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
                Object.defineProperty(el, 'src', {
                    set(rawUrl) {
                        const url = rawUrl == null ? '' : String(rawUrl);
                        if (url && url.includes('avs-loader')) {
                            console.log('[AVS-DUMP] Found avs-loader:', url);
                            fetch(url, { credentials: 'include' })
                                .then(r => r.text())
                                .then(src => {
                                    console.log('[AVS-DUMP] Source length:', src.length);
                                    const stMatches = [...src.matchAll(/["']st["']/g)];
                                    stMatches.forEach(m => {
                                        console.log('[AVS-DUMP] st context:', src.slice(m.index - 100, m.index + 100));
                                    });
                                    console.log('[AVS-DUMP-FULL]', src);
                                })
                                .catch(e => console.error('[AVS-DUMP] Fetch failed:', e));
                        }
                        srcDesc.set.call(el, url);
                    },
                    get() { return srcDesc.get.call(el); }
                });
                return el;
            };
        })();

        // ── ARTPLAYER GESTURE FIX ────────────────────────────
        // Chặn ArtPlayer bắt touchmove để tránh tua không chủ ý khi vuốt
        (function fixArtplayerTouch() {
            let startX = 0;
            let startY = 0;

            window.addEventListener('touchstart', (e) => {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
            }, { capture: true, passive: true });

            window.addEventListener('touchmove', (e) => {
                // Cho phép kéo thanh thời gian bình thường
                if (e.target.closest('.art-progress') || e.target.closest('.art-bottom')) {
                    return;
                }

                const currX = e.touches[0].clientX;
                const currY = e.touches[0].clientY;
                const deltaX = Math.abs(currX - startX);
                const deltaY = Math.abs(currY - startY);

                if (deltaX > 5 || deltaY > 5) {
                    e.stopImmediatePropagation();
                    // e.preventDefault(); // bật nếu muốn chống cuộn trang khi fullscreen
                }
            }, { capture: true, passive: false });
        })();

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

            window.addEventListener('touchstart', handleToastAction, true);
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
        setInterval(() => {
            document.querySelectorAll('video').forEach(hookVideo);
            killAd();
        }, 300);

        // ── CRYPTO INTERCEPT ─────────────────────────────────
        //
        // Hook importKey + sign + decrypt để tái tạo đủ thông tin giải mã playlist:
        //   - keyBytes   (importKey lần 1: HMAC key)
        //   - signInput  (sign: "proxyDigest:requestTrace:cacheNode")
        //   - ciphertext (decrypt: M3U8 ciphertext)
        //
        // Khi download: dùng lại keyBytes + signInput + ciphertext mới (re-fetch URL nếu có).
        // Nếu không có URL: dùng ciphertext cũ — token trong M3U8 sống 2h từ lúc load trang.

        let _lastKeyBytes   = null;  // raw HMAC key bytes
        let _lastSignInput  = null;  // Uint8Array: "digest:trace:node"
        let _lastCiphertext = null;  // ArrayBuffer: ciphertext M3U8 mới nhất
        let _playlistUrl    = null;  // URL playlist nếu capture được
        let _segmentCount   = 0;

        function base64urlToBytes(str) {
            let s = str.replace(/-/g, '+').replace(/_/g, '/');
            s += '=='.slice(0, (2 - (s.length % 4)) % 4);
            const bin = atob(s);
            const out = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            return out;
        }

        async function avsDecryptFull(ciphertext, edgeTag, proxyDigest, requestTrace, cacheNode) {
            const keyBytes   = base64urlToBytes(edgeTag);
            const hmacKey    = await crypto.subtle.importKey('raw', keyBytes, { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
            const signInput  = new TextEncoder().encode(`${proxyDigest}:${requestTrace}:${cacheNode}`);
            const aesMat     = await crypto.subtle.sign('HMAC', hmacKey, signInput);
            const aesKey     = await crypto.subtle.importKey('raw', aesMat, { name:'AES-GCM' }, false, ['decrypt']);
            const iv         = keyBytes.slice(0, 12);
            const plain      = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, aesKey, ciphertext);
            return new TextDecoder().decode(plain);
        }

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

        // Fetch playlist và giải mã với key từ response headers
        async function fetchAndDecrypt(url) {
            const resp = await fetch(url, { credentials: 'omit' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const edgeTag      = resp.headers.get('X-Edge-Tag')      || '';
            const cacheNode    = resp.headers.get('X-Cache-Node')    || '';
            const requestTrace = resp.headers.get('X-Request-Trace') || '0';
            const proxyDigest  = decodeURIComponent(
                resp.headers.get('X-Proxy-Digest') || 'anon'
            );

            const rawText = await resp.text();

            if (!edgeTag || !cacheNode) return rawText;

            const lines = rawText.split('\n');
            const isNewFormat = lines.some(l => l && !l.startsWith('#') && /[?&]_c=[0-9]+/.test(l));

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
                return await avsDecryptFull(ciphertextBuf.buffer, edgeTag, proxyDigest, requestTrace, cacheNode);
            } else {
                const bytes = new Uint8Array(rawText.length);
                for (let i = 0; i < rawText.length; i++) bytes[i] = rawText.charCodeAt(i) & 0xff;
                return await avsDecryptFull(bytes.buffer, edgeTag, proxyDigest, requestTrace, cacheNode);
            }
        }

        // Ưu tiên: re-fetch URL (token mới) → fallback ciphertext cũ
        async function getSegmentUrls() {
            let plaintext;

            if (_playlistUrl) {
                try {
                    plaintext = await fetchAndDecrypt(_playlistUrl);
                } catch(e) {
                    // Fallback sang ciphertext cũ nếu URL hết hạn
                    if (!_lastCiphertext) throw new Error('Không thể fetch playlist và không có ciphertext backup.');
                    plaintext = await avsDecryptCached(_lastCiphertext);
                }
            } else if (_lastCiphertext) {
                // Không có URL → dùng ciphertext cũ (token trong M3U8 sống 2h)
                plaintext = await avsDecryptCached(_lastCiphertext);
            } else {
                throw new Error('Chưa có dữ liệu playlist. Hãy đợi video load vài giây rồi thử lại.');
            }

            const segs = plaintext.split('\n')
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('#'));

            if (!segs.length || !segs[0].startsWith('http')) {
                throw new Error('Playlist không hợp lệ. Thử tải lại trang.');
            }
            return segs;
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

        // Capture message = "proxyDigest:requestTrace:cacheNode"
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
                const segs  = plain.split('\n')
                    .map(l => l.trim())
                    .filter(l => l && !l.startsWith('#'));
                if (segs.length > 0 && segs[0].startsWith('http')) {
                    _segmentCount = segs.length;
                    window.parent.postMessage({ type: 'AVS_READY', count: segs.length }, '*');
                }
            } catch(e) {}
            return result;
        };

        // Capture playlist URL từ fetch + XHR (bỏ qua segment URLs)
        const IS_SEGMENT = /\/chunks\/.+\/video\d+\.html|\.ts([?#]|$)|si=\d+|seq=\d+/;

        const _origFetch = window.fetch;
        window.fetch = async function(input, init) {
            const url = (typeof input === 'string') ? input
                      : (input instanceof Request)  ? input.url : String(input);
            const strUrl = String(url);
            
            if (!IS_SEGMENT.test(strUrl) && (strUrl.includes('.m3u8') || strUrl.includes('playlist') || strUrl.includes('googleapiscdn.com') || strUrl.includes('googleusercontent.com'))) {
                try {
                    _playlistUrl = strUrl.startsWith('http') ? strUrl : new URL(strUrl, location.href).href;
                } catch(e) {}
            }
            
            const response = await _origFetch.call(this, input, init);
            try {
                if (response && response.headers && response.headers.get('X-Edge-Tag') && !IS_SEGMENT.test(strUrl)) {
                    _playlistUrl = strUrl.startsWith('http') ? strUrl : new URL(strUrl, location.href).href;
                }
            } catch(e) {}
            return response;
        };

        const _origXHROpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            const strUrl = String(url);
            if (!IS_SEGMENT.test(strUrl) && (strUrl.includes('.m3u8') || strUrl.includes('playlist') || strUrl.includes('googleapiscdn.com') || strUrl.includes('googleusercontent.com'))) {
                try {
                    _playlistUrl = strUrl.startsWith('http') ? strUrl : new URL(strUrl, location.href).href;
                } catch(e) {}
            }
            this._avsUrl = strUrl;
            return _origXHROpen.call(this, method, url, ...rest);
        };

        const _origXHRSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function(...args) {
            this.addEventListener('load', function() {
                try {
                    const edgeTag = this.getResponseHeader('X-Edge-Tag');
                    if (edgeTag && !IS_SEGMENT.test(this._avsUrl)) {
                        _playlistUrl = this._avsUrl.startsWith('http') ? this._avsUrl : new URL(this._avsUrl, location.href).href;
                    }
                } catch(e) {}
            });
            return _origXHRSend.apply(this, args);
        };

        // Download: tải theo burst để tránh Cloudflare rate-limit
        const BURST_SIZE     = 40;   // số chunks mỗi burst
        const BURST_COOLDOWN = 3000; // nghỉ 3s giữa các burst
        const JITTER_MIN     = 100;
        const JITTER_MAX     = 200;

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
            return 'https://animevietsub.id';
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
            console.log(`[DOWNLOAD] Bắt đầu: ${total} chunks, chế độ tuần tự`);
            window.parent.postMessage({ type: 'AVS_PROGRESS', current: 0, total, phase: 'download' }, '*');

            try { document.querySelector('video')?.pause(); } catch(e) {}

            const chunks = new Array(total);

            for (let i = 0; i < total; i++) {
                if (i > 0 && i % BURST_SIZE === 0) {
                    const cooldown = BURST_COOLDOWN + Math.random() * 1000;
                    window.parent.postMessage({ type: 'AVS_COOLDOWN', remaining: Math.ceil(cooldown/1000), current: i, total }, '*');
                    await new Promise(r => setTimeout(r, cooldown));
                }

                const jitter = JITTER_MIN + Math.random() * (JITTER_MAX - JITTER_MIN);
                await new Promise(r => setTimeout(r, jitter));

                let retries = 4;
                let backoffBase = 5000;

                while (retries > 0) {
                    try {
                        const response = await fetch(urls[i], {
                            method: 'GET',
                            credentials: 'omit',
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

                        const buf = await response.arrayBuffer();
                        chunks[i] = buf;
                        window.parent.postMessage({ type: 'AVS_PROGRESS', current: i + 1, total, phase: 'download' }, '*');
                        break;

                    } catch(e) {
                        retries--;
                        if (retries === 0) {
                            chunks[i] = new ArrayBuffer(0);
                            window.parent.postMessage({ type: 'AVS_PROGRESS', current: i + 1, total, phase: 'download' }, '*');
                        } else {
                            await new Promise(r => setTimeout(r, 2000));
                        }
                    }
                }
            }

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
        div[style*="z-index: 9999"], a[style*="z-index: 99999"],
        a[target="_blank"] > img {
            display: none !important; visibility: hidden !important;
            opacity: 0 !important; height: 0 !important; width: 0 !important;
            pointer-events: none !important; position: absolute !important;
            left: -9999px !important; z-index: -9999 !important;
        }
        .art-backdrop { background: transparent !important; display: none !important; }
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
         '.Adv','.ad-center-header',
        ].forEach(sel => _docQSA.call(document, sel).forEach(el => el.remove()));
    };
    setInterval(cleaner, 500);

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

        // Cũng watch iframe load event
        const watchIframe = () => {
            const iframe = getPlayerIframe();
            if (iframe && !iframe._avsWatched) {
                iframe._avsWatched = true;
                iframe.addEventListener('load', () => setTimeout(tryInject, 2000));
            }
        };
        setInterval(watchIframe, 500);
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
