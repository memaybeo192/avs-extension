# AVS deobf v1.12.21

Generated: 2026-06-05

## Main readable files

- avs-loader-deobf-reconstructed-1.12.21.js
  - Readable reconstruction in the same spirit as v1.3.7.
  - Updated with v1.12.21 envelope parser, service-worker message types, playlist decrypt flow,
    placeholder segment handling, and diagnostics.

- avs-fingerprint-deobf-reconstructed-1.12.21.js
  - Readable reconstruction of the new fingerprint companion module.

## Runtime-preserved backup files

- avs-loader-deobf-runtime-preserved-1.12.21.js
  - Body preserved from webcrack output for live-site fallback testing.

- avs-fingerprint-deobf-runtime-preserved-1.12.21.js
  - Body preserved from webcrack output for live-site fallback testing.

## Changelog vs v1.3.7

- X-Envelope is now a binary USDK container with CRC32 validation.
- Fallback headers remain X-Edge-Tag, X-Cache-Node, X-Request-Trace, X-Proxy-Digest.
- AES-GCM key derivation now uses uid:trace:cacheNode with optional envSnapshot hardening.
- Service worker message types are AVS_DECRYPT_PLAYLIST and AVS_RESOLVE_SEG.
- Segment handling includes placeholder /hls/<24hex>.ts URL recovery and _avsG6Diag.
- Fingerprint module now exposes window._avsProbe for environment/fingerprint signals.

## Extension integration notes

- `content.js` should treat these files as reference only. Do not bundle the full reconstructed loader/fingerprint runtime into the extension.
- Runtime resolver order for v1.12.21+ is native-first:
  1. `window.AvsDecryptPlaylist(url)` when exposed by the page.
  2. `window._avsDecryptM3u8(text, headers)` using captured playlist response text and pass-through headers.
  3. Captured plaintext M3U8, but only when it looks complete.
  4. Legacy v1.3.x WebCrypto cache fallback.
- Broad `googleusercontent.com` URLs are not playlist candidates anymore unless they include `.m3u8`, `playlist`, or encrypted playlist markers. This prevents direct media URLs from replacing the real playlist URL.
- Plaintext captured by `crypto.subtle.decrypt` may be a one-URL direct media payload. That cache must not drive `AVS_READY` or the primary download path unless it expands to a complete playlist.

## Verification

- node --check passed for all four v1.12.21 files.
- VM smoke test passed:
  - reconstructed/runtime-preserved loaders expose AvsPlaylistLoader, AvsEncryptedLoader,
    _avsDecryptM3u8, and _avsG6Diag.
  - reconstructed/runtime-preserved fingerprints expose _avsProbe.
- Extension live test on Chrome, 2026-06-05:
  - Same AnimeVietSub player initially exposed an incomplete plaintext cache with 1 direct URL.
  - Adaptive resolver ignored that incomplete cache, used the native text+headers path, and resolved 233 segments.
  - Download completed as a 175.6 MB `.ts` output.

