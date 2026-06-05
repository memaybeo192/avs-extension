// Background Service Worker

const TRANSFORM_URL      = 'https://raw.githubusercontent.com/animevsubtv/data-animevsub-ext/master/transform.json';
const LOGO_RULE_ID       = 100;
const CONTENT_SCRIPT_ID  = 'avs-content';
const ALARM_NAME         = 'avs-transform-sync';
const ALARM_PERIOD_MIN   = 60; // re-check mỗi 1 tiếng
const DEFAULT_HOST       = 'animevietsub.name';
const STATIC_MATCHES     = ['*://*.googleapiscdn.com/*'];

async function logoExists() {
    try {
        const r = await fetch(chrome.runtime.getURL('assets/logoz.png'));
        return r.ok;
    } catch { return false; }
}

async function fetchTransform() {
    try {
        const r = await fetch(TRANSFORM_URL, { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (!data.host || !data.host.includes('.')) throw new Error('host invalid');
        return {
            scheme:   data.scheme || 'https',
            host:     data.host,
            old_host: Array.isArray(data.old_host) ? data.old_host : []
        };
    } catch (err) {
        await chrome.storage.local.set({ avs_log: '[AVS-BG] fetchTransform failed: ' + err.message });
        return null;
    }
}

async function updateContentScript(transform) {
    const matches = [...STATIC_MATCHES];
    matches.push(`*://*.${DEFAULT_HOST}/*`);
    if (transform) {
        if (transform.host !== DEFAULT_HOST) matches.push(`*://*.${transform.host}/*`);
        for (const old of transform.old_host) matches.push(`*://*.${old}/*`);
    }

    // Luôn re-register để Chrome không giữ bản content.js cũ trong dynamic script registry.
    try {
        await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    } catch {}

    try {
        await chrome.scripting.registerContentScripts([{
            id:        CONTENT_SCRIPT_ID,
            matches,
            js:        ['content.js'],
            runAt:     'document_start',
            allFrames: true,
            world:     'MAIN'
        }]);
        await chrome.storage.local.set({ avs_log: '[AVS-BG] Re-registered content.js: ' + matches.join(', ') });
    } catch (err) {
        await chrome.storage.local.set({ avs_log: '[AVS-BG] registerContentScripts failed: ' + err.message });
    }
}

async function updateLogoRule(transform) {
    try {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [LOGO_RULE_ID], addRules: [] });
    } catch {}

    const hasLogo = await logoExists();
    await chrome.storage.local.set({ avs_has_logo: hasLogo });

    if (!hasLogo || !transform) return;

    const urlFilter = `cdn.${transform.host}/data/logo/logoz.png`;
    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [LOGO_RULE_ID],
        addRules: [{
            id: LOGO_RULE_ID,
            priority: 3,
            action: { type: 'redirect', redirect: { extensionPath: '/assets/logoz.png' } },
            condition: { urlFilter, resourceTypes: ['image'] }
        }]
    });

    await chrome.storage.local.set({ avs_log: '[AVS-BG] Logo rule set: ' + urlFilter });
}

async function updateDomain() {
    const transform = await fetchTransform() || { scheme: 'https', host: DEFAULT_HOST, old_host: [] };
    if (transform) await chrome.storage.local.set({ avs_transform: transform });
    await Promise.all([
        updateContentScript(transform),
        updateLogoRule(transform)
    ]);
}

// ── KHỞI TẠO ────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
    await updateDomain();
    // Đặt alarm định kỳ re-check transform.json
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MIN });
});

chrome.runtime.onStartup.addListener(updateDomain);

// Alarm fire mỗi 1 tiếng → tự re-check và update nếu domain đổi
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) updateDomain();
});

// Gọi thủ công từ DevTools: chrome.runtime.sendMessage({type:'AVS_UPDATE'})
chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'AVS_UPDATE') updateDomain();
});
