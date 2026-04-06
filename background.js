// Background Service Worker

const TRANSFORM_URL = 'https://raw.githubusercontent.com/animevsubtv/data-animevsub-ext/master/transform.json';
const LOGO_RULE_ID  = 100;

async function logoExists() {
    try {
        const url = chrome.runtime.getURL('assets/logoz.png');
        const r   = await fetch(url);
        return r.ok;
    } catch (e) {
        return false;
    }
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

async function updateLogoRule(transform) {
    try {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [LOGO_RULE_ID], addRules: [] });
    } catch {}

    const hasLogo = await logoExists();
    await chrome.storage.local.set({ avs_has_logo: hasLogo });

    if (!hasLogo) {
        await chrome.storage.local.set({ avs_log: '[AVS-BG] No logo file — skip redirect.' });
        return;
    }
    if (!transform) {
        await chrome.storage.local.set({ avs_log: '[AVS-BG] No transform — skip redirect.' });
        return;
    }

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
    const transform = await fetchTransform();
    if (transform) await chrome.storage.local.set({ avs_transform: transform });
    await updateLogoRule(transform);
}

chrome.runtime.onInstalled.addListener(updateDomain);
chrome.runtime.onStartup.addListener(updateDomain);

// Cho phép gọi thủ công từ DevTools: chrome.runtime.sendMessage({type:'AVS_UPDATE'})
chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'AVS_UPDATE') updateDomain();
});