# AnimeVietSub — Phân tích kỹ thuật

> Reverse engineering kiến trúc hệ thống  
> Mục đích: nghiên cứu kỹ thuật  
> Cập nhật: thêm AVS Service Worker + Safari encryption scheme

---

## Mục lục

1. [Tổng quan kiến trúc](#1-tổng-quan-kiến-trúc)
2. [Hệ thống phân phối video](#2-hệ-thống-phân-phối-video)
3. [Chuỗi mã hoá playlist M3U8](#3-chuỗi-mã-hoá-playlist-m3u8)
4. [Định dạng Segment URL](#4-định-dạng-segment-url)
5. [AVS Service Worker](#5-avs-service-worker)
6. [AVS-Shield — Hệ thống bảo vệ](#6-avs-shield--hệ-thống-bảo-vệ)
7. [Hệ thống quảng cáo](#7-hệ-thống-quảng-cáo)
8. [Player & Web API nội bộ](#8-player--web-api-nội-bộ)
9. [Giao tiếp cross-frame](#9-giao-tiếp-cross-frame)
10. [Sơ đồ luồng tổng thể](#10-sơ-đồ-luồng-tổng-thể)
11. [Tóm tắt bảo mật](#11-tóm-tắt-bảo-mật)

---

## 1. Tổng quan kiến trúc

AnimeVietSub sử dụng mô hình **hai frame**:

```
animevietsub.id  (Main Frame)
    └── <iframe src="*.googleapiscdn.com/..."> (Player Frame)
            └── ArtPlayer + HLS.js + avs-loader.min.js
```

| Thành phần | Công nghệ |
|---|---|
| Trang chủ / điều hướng | `animevietsub.id` |
| Video player | ArtPlayer + HLS.js (trong iframe) |
| CDN playlist | `storage.googleapiscdn.com` |
| CDN segment | `storage.googleapiscdn.com/chunks/` |
| Chống scraping | AVS-Shield + Cloudflare |
| Service Worker | `AVS-SW v1.2.17` — cache tĩnh + Safari decrypt + domain redirect |

---

## 2. Hệ thống phân phối video

### 2.1 Playlist M3U8 (Encrypted)

Playlist HLS được phục vụ từ `storage.googleapiscdn.com`. Server trả về **hai định dạng khác nhau tuỳ browser**:

| Browser | Định dạng response | Nơi giải mã |
|---|---|---|
| Chrome / Firefox | Toàn bộ body là AES-GCM ciphertext | `avs-loader.min.js` (Player Frame) |
| Safari / iOS | M3U8 hợp lệ nhưng segment URL chứa chunks mã hoá | `AVS-SW` (Service Worker) |

- Sau khi giải mã: M3U8 chuẩn chứa danh sách segment URL tuyệt đối

### 2.2 Segments (MPEG-TS)

Segment được phục vụ dưới dạng file `.html` nhưng nội dung thực là **raw MPEG-TS**:

```
https://storage.googleapiscdn.com/chunks/{id}/original/{obfuscated}/video{N}.html
    ?st={per-segment-token}
    &si={N}
    &seq={N}
    &token={shared-JWT}
```

| Trường | Ý nghĩa |
|---|---|
| `{id}` | ID video |
| `{obfuscated}` | Chuỗi định danh quality/source đã obfuscate |
| `video{N}.html` | Extension `.html` là **fake** — content thực là MPEG-TS |
| `st` | Per-segment token riêng từng chunk |
| `si`, `seq` | Segment index / sequence number |
| `token` | JWT dùng chung toàn session |

**Token JWT:** `exp = iat + 7200s` — TTL 2 giờ kể từ lúc trang load.

**Không có segment-level encryption** (`EXT-X-KEY` vắng mặt) — segment fetch được trực tiếp bằng URL hợp lệ.

---

## 3. Chuỗi mã hoá playlist M3U8

Hai scheme dùng cùng bộ headers nhưng **cấu trúc ciphertext và sign message khác nhau**.

### 3.1 Headers trả về từ CDN (chung cả hai scheme)

Server trả về các custom headers sau, tất cả expose qua `Access-Control-Expose-Headers`:

| Header | Encoding | Vai trò |
|---|---|---|
| `X-Edge-Tag` | base64url | Raw bytes HMAC key + nguồn IV |
| `X-Proxy-Digest` | hex | Input ký HMAC — phần 1 (uid) |
| `X-Request-Trace` | số nguyên (string) | Input ký HMAC — phần 2 (ts) |
| `X-Cache-Node` | base64 | Input ký HMAC — phần 3 (skB64) |

---

### 3.2 Scheme A — Standard (Chrome / Firefox)

Dùng trong `avs-loader.min.js` chạy tại Player Frame.

**Nguồn ciphertext:** Toàn bộ response body là AES-GCM ciphertext. HLS.js nhận qua XHR `responseType="text"`, cần convert lại bằng latin1.

**Sign message:** `"{X-Proxy-Digest}:{X-Request-Trace}:{X-Cache-Node}"`

#### Luồng giải mã (4 bước)

```
X-Edge-Tag (base64url)
    │
    ▼ base64url decode
keyBytes[16]
    │
    ├─[0..11]──────────────────────────────► IV (12 bytes) cho AES-GCM
    │
    ▼ importKey(HMAC-SHA-256)
hmacKey
    │
    ▼ sign("{X-Proxy-Digest}:{X-Request-Trace}:{X-Cache-Node}")
aesKeyMaterial[32]
    │
    ▼ importKey(AES-GCM)
aesKey
    │
    ▼ decrypt(AES-GCM, iv=keyBytes[0..11], body_ciphertext)
plaintext M3U8
```

#### Pseudo-code

```javascript
// Bước 1: HMAC key từ X-Edge-Tag
const keyBytes = base64urlDecode(X_Edge_Tag);           // 16 bytes
const hmacKey  = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
);

// Bước 2: Ký để sinh AES key material
const signInput      = encode(`${X_Proxy_Digest}:${X_Request_Trace}:${X_Cache_Node}`);
const aesKeyMaterial = await crypto.subtle.sign('HMAC', hmacKey, signInput);
// → 32 bytes

// Bước 3: AES-GCM key
const aesKey = await crypto.subtle.importKey(
    'raw', aesKeyMaterial, { name: 'AES-GCM' }, false, ['decrypt']
);

// Bước 4: Giải mã — ciphertext là toàn bộ body
const iv        = keyBytes.slice(0, 12);
const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, aesKey, ciphertext
);
```

#### Chuyển đổi text → bytes (quan trọng)

HLS.js dùng `responseType="text"` cho XHR playlist. Cần convert lại bằng latin1 — không dùng TextEncoder vì sẽ corrupt byte > 127:

```javascript
const bytes = new Uint8Array(data.length);
for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;
```

#### Ví dụ thực tế (verified)

| Giá trị | Data |
|---|---|
| `X-Edge-Tag` | `Z1TbTorQDBvlg6tZP6q8XQ` |
| `keyBytes` (hex) | `6754db4e8ad00c1be583ab593faabc5d` |
| `IV` (hex) | `6754db4e8ad00c1be583ab59` |
| Sign message | `98a645a...e68eb:1775275088:BH1P9u...RknIQ` |
| `aesKeyMaterial` (hex) | `5180b7397c2ed6ca...c9b6ca71` |

---

### 3.3 Scheme B — Safari / iOS (Service Worker)

Dùng trong `AVS-SW` (Service Worker) — intercept request tới `/playlist/…/playlist.m3u8`.

**Lý do có scheme riêng:** HLS.js trên Safari không hỗ trợ custom XHR loader bên trong Service Worker; SW là điểm duy nhất có thể intercept fetch và decrypt trước khi trả về cho native HLS engine.

#### Khác biệt cốt lõi so với Scheme A

| Điểm | Scheme A (Standard) | Scheme B (Safari SW) |
|---|---|---|
| Vị trí ciphertext | Toàn bộ body | Phân mảnh trong param `_t=` của mỗi segment URL |
| Body nhận từ server | Opaque bytes | M3U8 hợp lệ (có thể đọc được) |
| Dấu hiệu nhận biết | — | `_c={số}` xuất hiện trong segment URL |
| Sign message | `digest:trace:node` | `uid:ts:skB64` (cùng giá trị, tên biến khác) |
| Output | Plaintext M3U8 đầy đủ | Chỉ thay thế phần segment URLs |
| Nơi thực thi | Player Frame (browser tab) | Service Worker thread |

#### Cấu trúc M3U8 nhận từ server (Safari)

Server trả về M3U8 hợp lệ về mặt cú pháp, nhưng mỗi segment URL chứa hai query param đặc biệt:

```m3u8
#EXTM3U
#EXT-X-VERSION:3
...
#EXTINF:4.004,
/chunks/123/.../video0.html?_c=1&_t=Z1Tb...&token=eyJ...
#EXTINF:4.004,
/chunks/123/.../video1.html?_c=1&_t=Tb4e...&token=eyJ...
...
#EXT-X-ENDLIST
```

| Param | Ý nghĩa |
|---|---|
| `_c` | Flag báo playlist đang encrypted (bất kỳ số nguyên nào) |
| `_t` | **Một phần (chunk) của ciphertext** dạng base64url |

#### Reconstruct ciphertext

Tất cả giá trị `_t=` từ mọi segment URL được **nối lại theo thứ tự** → chuỗi base64url hoàn chỉnh → decode → ciphertext AES-GCM.

```javascript
const chunks = [];
lines.forEach(line => {
    if (!line.startsWith('#') && line.trim() !== '') {
        const tMatch = line.match(/[?&]_t=([^&\s]+)/);
        if (tMatch) chunks.push(tMatch[1]);
    }
});
const avsLine = chunks.join(''); // full base64url ciphertext
```

#### Luồng giải mã (Safari SW)

```
X-Edge-Tag (base64url)
    │
    ▼ b64urlToBytes()
cnBytes[16]
    │
    ├─[0..11]──────────────────────────────► IV (12 bytes)
    │
    ▼ importKey(HMAC-SHA-256)
hmacKey
    │
    ▼ sign("{X-Proxy-Digest}:{X-Request-Trace}:{X-Cache-Node}")
        (uid = X-Proxy-Digest, ts = X-Request-Trace, skB64 = X-Cache-Node)
sessionKeyBuf[32]
    │
    ▼ importKey(AES-GCM)
aesKey
    │
    ▼ decrypt(AES-GCM, iv=cnBytes[0..11], ciphertext)
segmentsBlock  ← chỉ chứa phần segment URLs, KHÔNG phải M3U8 đầy đủ
    │
    ▼ ghép: headerLines + segmentsBlock
plaintext M3U8 hoàn chỉnh
```

#### Pseudo-code (từ AVS-SW source)

```javascript
async function decryptPlaylist(text, cnB64, skB64, uid, ts, origin) {
    const chunks = [], headerLines = [];
    const lines  = text.split('\n');
    let isEncrypted = false;

    // Bước 1: phát hiện — tìm _c= trong segment URL đầu tiên
    for (const ln of lines) {
        if (!ln.startsWith('#') && ln.trim() !== '') {
            if (ln.match(/[?&]_c=[0-9]+/)) isEncrypted = true;
            break;
        }
    }
    if (!isEncrypted || !cnB64 || !skB64) return text; // không cần decrypt

    // Bước 2: thu thập _t chunks + tách header lines
    lines.forEach(line => {
        if (!line.startsWith('#') && line.trim() !== '') {
            const tMatch = line.match(/[?&]_t=([^&\s]+)/);
            if (tMatch) chunks.push(tMatch[1]);
        } else if (!line.match(/^#EXTINF:/) && !line.match(/^#EXT-X-ENDLIST/)) {
            headerLines.push(line);
        }
    });

    const avsLine = chunks.join(''); // full base64url ciphertext

    // Bước 3: derive key
    const cnBytes = b64urlToBytes(cnB64);        // X-Edge-Tag → 16 bytes
    const hmacKey = await crypto.subtle.importKey(
        'raw', cnBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    // sign message: "{X-Proxy-Digest}:{X-Request-Trace}:{X-Cache-Node}"
    const msg = new TextEncoder().encode(`${uid}:${ts}:${skB64}`);
    const sessionKeyBuf = await crypto.subtle.sign('HMAC', hmacKey, msg);

    const aesKey = await crypto.subtle.importKey(
        'raw', sessionKeyBuf, { name: 'AES-GCM' }, false, ['decrypt']
    );

    // Bước 4: decrypt
    const iv           = cnBytes.slice(0, 12);
    const cipherBytes  = b64urlToBytes(avsLine);
    const decrypted    = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv }, aesKey, cipherBytes
    );
    const segmentsBlock = new TextDecoder().decode(decrypted);

    // Bước 5: make segment URLs absolute nếu cần
    const fixedSegments = segmentsBlock.split('\n').map(line => {
        if (line.startsWith('#') || line.trim() === '') return line;
        if (line.startsWith('/')) return origin + line;
        return line;
    }).join('\n');

    // Bước 6: ghép header + segments
    return headerLines.join('\n') + '\n' + fixedSegments;
}
```

#### SW intercept condition

Service Worker chỉ decrypt khi request thoả **cả hai điều kiện**:

```javascript
url.includes('/playlist/') && url.includes('playlist.m3u8')
```

---

## 4. Định dạng Segment URL

### Fetch segment đúng cách

```http
GET /chunks/{id}/original/{path}/video{N}.html?st=...&token=...
Host: storage.googleapiscdn.com
Accept: */*
Accept-Language: vi-VN,vi;q=0.9
Referer: https://animevietsub.id/
```

Lưu ý:
- Không set `Accept: text/html` — nội dung là MPEG-TS
- Cloudflare bảo vệ — `403 "Bot detected"` nếu request pattern bất thường
- Rate limiting: burst nhiều request liên tiếp bị `429`

---

## 5. AVS Service Worker

### 5.1 Tổng quan

AVS-SW (`STATIC_VERSION = 1.2.17`, cache name `avs-static-v1.2.17`) đảm nhiệm ba trách nhiệm:

1. **Pre-cache static assets** khi install (tất cả browser)
2. **Cache-first** cho `/static/*` — giảm latency load player
3. **Safari playlist intercept** — decrypt M3U8 trong SW thread thay vì Player Frame

### 5.2 Assets được pre-cache

```
/static/jwplayer/jwplayer.js
/static/style.css
/static/avs-loader.min.js
/static/init.min.js
/static/jquery-3.7.1.min.js
/static/pako.min.js
/static/avs-shield.min.js
```

Dùng `cache.add()` riêng lẻ — một asset lỗi không block phần còn lại.

### 5.3 Lifecycle

**Install:** pre-cache assets → `self.skipWaiting()`

**Activate:** xoá cache cũ (key ≠ `avs-static-v1.2.17`) → `clients.claim()` → broadcast `{ type: 'SW_UPDATED', version }` đến tất cả tab đang mở.

### 5.4 Domain Redirect (từ minified SW source)

SW phiên bản production (minified) còn có thêm logic **domain redirect** khi domain hiện tại bị block hoặc thay đổi:

**Nguồn transform config:**
```
GET https://raw.githubusercontent.com/animevsubtv/data-animevsub-ext/master/transform.json
→ { host: "new-domain.com" }
```

**Domain lock check:**
```
GET https://static.fbcdns.net/api/domain-info/{hostname}
→ { isLocked: bool }
```

**Luồng xử lý fetch document (request.destination === "document"):**

```
fetch(request)
    │
    ├─ status 403 + cf-mitigated: challenge
    │       → set bt=true, reload sau khi Cloudflare challenge pass
    │
    ├─ body chứa "BỘ CÔNG AN" hoặc "Vietnam NCSC"
    │       → domain bị chặn bởi cơ quan nhà nước → redirect
    │
    └─ normal response → trả về bình thường

Nếu redirect cần thiết:
    wn(hostname) → fetch transform.json → lấy host mới
        │
        ├─ cookieStore available (Chrome/Edge)
        │       → compress cookies: deflateRaw + bytes → base64
        │       → 301 → new-domain/apply-cookie.php?cookie={compressed}
        │
        └─ cookieStore không có (Safari/Firefox)
                → serve /redirector/index.html với JSON embed
                  { pathname, search, hash, hostname, protocol, newDomain }
```

**Cookie compression:**
```javascript
// Cookies → JSON → deflateRaw(pako) → Uint8Array → latin1 string → base64
deflateRaw(JSON.stringify(cookies)) → base64
```

**Pre-cached pages phục vụ offline redirect:**
- `/unavailable/index.html` — hiển thị khi domain bị lock
- `/redirector/index.html` — trang chuyển hướng có JS embed data

---

## 6. AVS-Shield — Hệ thống bảo vệ

AVS-Shield là script anti-debug chạy trong Player Frame (`googleapiscdn.com`).

### 6.1 Kỹ thuật phát hiện DevTools

**Kỹ thuật 1 — Console array trick:**

```javascript
console.log([...50 phần tử...]);
```

Khi DevTools mở, browser format mảng dài theo cách khác → dùng làm tín hiệu phát hiện.

**Kỹ thuật 2 — `Object.defineProperty` trap trên `Element.id`:**

Gắn getter trên `.id` của element; DevTools tự enumerate properties khi inspect → getter kích hoạt → phát hiện.

**Kỹ thuật 3 — `Function` constructor với `debugger`:**

```javascript
new Function("debugger")()
```

Inject câu lệnh `debugger` ở runtime để tránh bị phát hiện qua static analysis. Chỉ có hiệu lực khi DevTools đang mở và ở chế độ pause-on-debugger.

### 6.2 Hành động khi phát hiện

- Hiển thị overlay chặn iframe player với thông báo *"Vui lòng tắt [blocker]"*
- `console.clear()` liên tục để xoá log
- Chặn F12 qua `keydown` + `preventDefault`
- Chặn chuột phải (`contextmenu`)

---

## 7. Hệ thống quảng cáo

### 7.1 Các loại quảng cáo

| Loại | Selector / Endpoint |
|---|---|
| Pause Ad | `#avs-pause-ad`, `.avs-pause-ad-box`, `.avs-pause-ad-img` |
| Banner overlay | `#avs-banner-overlay`, `.avs-banner-img-link`, `.avs-banner-img` |
| Header ads | `.Adv`, `.ad-center-header`, `.header-ads-pc`, `.Ads`, `.ads_player` |
| Catfish / Catfix | `[id*="catfish"]`, `[class*="catfish"]`, `[href*="hide_catfix"]` |
| Popup redirect | `a[href*="vsbet"]`, `a[href*="6789x.site"]`, `a[href*="yo88"]`, `a[href*="min88"]` |
| Ad tracking | `GET /api/ads/active` (XHR) |

### 7.2 Cơ chế hoạt động

**Pause Ad:** Script lắng nghe event `pause` trên `<video>` → inject `#avs-pause-ad` vào DOM trong **Player Frame** (`googleapiscdn.com`).

**Banner overlay:** Inject `#avs-banner-overlay` vào **Main Frame** (`animevietsub.id`), không liên quan đến iframe video.

**Ad tracking:** XHR tới `/api/ads/active` để ghi nhận impression khi video phát.

**Popup redirect:** `window.open()` được gọi khi người dùng click vào vùng nhất định của trang.

---

## 8. Player & Web API nội bộ

### 8.1 Global objects được expose

| Object | Vai trò |
|---|---|
| `window.PLTV` | Controller phim/tập chính |
| `window.PLTV.readXml(url, field)` | Gọi AJAX nội bộ lấy data |
| `window.MAIN_URL` | Base URL (`https://animevietsub.id`) |
| `window.filmInfo.filmID` | ID phim hiện tại |
| `window.fx.alertMessage(title, msg, type)` | Dialog thông báo nội bộ |

### 8.2 Endpoint nội bộ

```
GET {MAIN_URL}/ajax/get_episode?filmId={filmID}&episodeId={currentEpId}
→ field "link": URL tập tiếp theo
```

### 8.3 DOM structure điều hướng tập

```html
<ul class="list-episode">
    <li>
        <a data-movie="playing" data-id="{episodeId}">Tập N</a>
    </li>
    <li>
        <a href="...">Tập N+1</a>
    </li>
</ul>
```

Button tập tiếp chuẩn: `#btn-nextepisode`

### 8.4 Toast "Xem Ngay"

```html
<div id="avs-next-toast">
    <button id="avs-next-btn">Xem Ngay</button>
    <button id="avs-next-close">✕</button>
</div>
```

Toast render trong Player Frame; click → `postMessage({ type: 'AVS_FORCE_NEXT' })` lên Main Frame → Main Frame điều hướng tập tiếp.

### 8.5 ArtPlayer — Gesture mặc định

ArtPlayer có gesture seek mặc định: vuốt ngang trên màn hình video để tua. Khu vực `.art-progress` và `.art-bottom` được xử lý riêng (kéo thanh thời gian bình thường).

---

## 9. Giao tiếp cross-frame

Hai frame giao tiếp qua `postMessage`:

### Player Frame → Main Frame

| Type | Data | Ý nghĩa |
|---|---|---|
| `AVS_READY` | `{ count: N }` | Playlist giải mã xong, N segments |
| `AVS_PROGRESS` | `{ phase, current, total }` | Tiến trình |
| `AVS_COOLDOWN` | `{ remaining, current, total }` | Cooldown |
| `AVS_DONE` | `{ bytes }` | Hoàn thành |
| `AVS_ERROR` | `{ msg }` | Lỗi |
| `AVS_FORCE_NEXT` | — | Yêu cầu chuyển tập |

### Main Frame → Player Frame

| Type | Data | Ý nghĩa |
|---|---|---|
| `AVS_DOWNLOAD_START` | `{ filename }` | Kích hoạt tải xuống |

### Service Worker → All Clients

| Type | Data | Ý nghĩa |
|---|---|---|
| `SW_UPDATED` | `{ version }` | SW mới activate, client nên reload |

---

## 10. Sơ đồ luồng tổng thể

```
[Browser]
    │
    ├── Service Worker (AVS-SW v1.2.17)
    │       │
    │       ├── Cache-first: /static/* → avs-static-v1.2.17
    │       │
    │       ├── [Safari only] intercept /playlist/…/playlist.m3u8
    │       │       fetch(request) → headers: X-Edge-Tag, X-Cache-Node,
    │       │                                 X-Request-Trace, X-Proxy-Digest
    │       │       text = response.text()
    │       │       detect: _c= trong segment URL?
    │       │           YES → collect _t= chunks → join → b64url decode
    │       │                 HMAC(cnBytes, uid:ts:skB64) → aesKey
    │       │                 AES-GCM decrypt → segmentsBlock
    │       │                 headerLines + segmentsBlock → plaintext M3U8
    │       │           NO  → pass through
    │       │
    │       └── [Document fetch] domain redirect logic
    │               fetch transform.json (GitHub) → new host
    │               detect block: "BỘ CÔNG AN" / "Vietnam NCSC" / isLocked
    │               redirect:
    │                   Chrome/Edge: deflateRaw(cookies) → base64 → apply-cookie.php
    │                   Safari/FF:   serve /redirector/index.html + JSON embed
    │
    ├── Main Frame: animevietsub.id
    │       │
    │       ├── window.PLTV, filmInfo, MAIN_URL  (global API)
    │       ├── #btn-nextepisode, ul.list-episode (DOM navigation)
    │       │
    │       └── <iframe src="storage.googleapiscdn.com/...">
    │               │
    │               ├── AVS-Shield (anti-debug)
    │               │       ├── console array trick
    │               │       ├── Object.defineProperty trap
    │               │       ├── new Function("debugger")()
    │               │       └── → overlay chặn player khi phát hiện
    │               │
    │               └── ArtPlayer + HLS.js + avs-loader.min.js
    │                       │
    │                       ├── [Chrome/Firefox] XHR → playlist
    │                       │       Body: AES-GCM ciphertext (toàn bộ)
    │                       │       Headers: X-Edge-Tag, X-Proxy-Digest,
    │                       │                X-Request-Trace, X-Cache-Node
    │                       │       crypto.subtle:
    │                       │           importKey(HMAC-SHA-256, keyBytes)
    │                       │           sign("digest:trace:node") → aesKeyMaterial
    │                       │           importKey(AES-GCM)
    │                       │           decrypt(iv=keyBytes[0..11], body)
    │                       │           → plaintext M3U8
    │                       │
    │                       ├── [Safari] XHR → playlist (đã decrypt bởi SW)
    │                       │       Nhận M3U8 thuần từ SW response
    │                       │
    │                       └── Segments: /chunks/{id}/.../video{N}.html
    │                               Content: raw MPEG-TS (extension fake)
    │                               No EXT-X-KEY (không mã hoá segment)
    │
    └── CDN: storage.googleapiscdn.com
            ├── Cloudflare — bot/rate-limit protection
            └── Token JWT TTL 2h per session
```

---

## 11. Tóm tắt bảo mật

| Lớp bảo vệ | Cơ chế | Áp dụng | Điểm yếu |
|---|---|---|---|
| Playlist encryption (body) | AES-GCM, key từ HMAC + response headers | Chrome / Firefox | Key material gửi về client → có thể intercept |
| Playlist encryption (param) | AES-GCM, ciphertext phân mảnh trong `_t=` params | Safari / iOS (SW) | Cùng điểm yếu; SW source có thể đọc được |
| Segment access | JWT (TTL 2h) + per-segment `st` token | Tất cả | Token nằm trong M3U8 đã decrypt → đủ dùng 2h |
| DevTools detection | Console trick, defineProperty trap, debugger injection | Player Frame | Có thể patch Web API trước khi script chạy |
| Bot/rate-limit | Cloudflare 403/429 | CDN | Burst limit + jitter vẫn bypass được |
| Domain redirect | transform.json + domain-info API | SW (mọi browser) | Config public trên GitHub → có thể dự đoán domain mới |
| Cookie migration | deflateRaw + base64 qua URL param | Chrome/Edge redirect | Cookies lộ trong URL (HTTPS log, Referrer header) |

---

*Tài liệu tổng hợp từ phân tích ngược. Mục đích: nghiên cứu kỹ thuật.*