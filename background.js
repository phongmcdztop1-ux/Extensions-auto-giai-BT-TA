// Background Service Worker v3.3

function toggleOverlay(tabId) {
    chrome.tabs.sendMessage(tabId, { action: 'toggle' }).catch(() => {
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        }).then(() => {
            setTimeout(() => {
                chrome.tabs.sendMessage(tabId, { action: 'toggle' });
            }, 200);
        }).catch(() => { });
    });
}

chrome.commands.onCommand.addListener((command) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) toggleOverlay(tabs[0].id);
    });
});

chrome.action.onClicked.addListener((tab) => {
    if (tab) toggleOverlay(tab.id);
});

// Capture using async/await + Promise API
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'capture' && sender.tab) {
        // Use promise-based API
        chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' })
            .then((dataUrl) => {
                sendResponse({ dataUrl: dataUrl });
            })
            .catch((err) => {
                console.log('Capture error msg:', err.message || err);
                sendResponse({ dataUrl: null, error: err.message || 'Capture failed' });
            });
        return true;
    }
    // Proxy fetch qua background để tránh CORS/CSP (Failed to fetch) khi content-script gọi API
    if (request.action === 'cre_fetch') {
        (async () => {
            try {
                const controller = new AbortController();
                const timeoutMs = Math.min(Math.max(parseInt(request.timeout, 10) || 60000, 5000), 120000);
                const timer = setTimeout(() => { try { controller.abort(); } catch (_) { } }, timeoutMs);
                const resp = await fetch(request.url, {
                    method: request.method || 'POST',
                    headers: request.headers || { 'Content-Type': 'application/json' },
                    body: request.body,
                    signal: controller.signal
                });
                clearTimeout(timer);
                const text = await resp.text().catch(() => '');
                let data = null;
                try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
                sendResponse({ ok: resp.ok, status: resp.status, text: text, data: data });
            } catch (e) {
                const msg = (e && e.name === 'AbortError')
                    ? 'Timeout (' + ((parseInt(request.timeout, 10) || 60000) / 1000) + 's) — server/AI phản hồi quá lâu'
                    : ('Network/CORS: ' + ((e && e.message) || 'fetch failed'));
                sendResponse({ ok: false, status: 0, text: '', data: null, error: msg });
            }
        })();
        return true;
    }
    if (request.action === 'cre_fetch_get') {
        (async () => {
            try {
                const controller = new AbortController();
                const timeoutMs = Math.min(Math.max(parseInt(request.timeout, 10) || 20000, 5000), 60000);
                const timer = setTimeout(() => { try { controller.abort(); } catch (_) { } }, timeoutMs);
                const resp = await fetch(request.url, {
                    method: 'GET',
                    headers: request.headers || {},
                    signal: controller.signal
                });
                clearTimeout(timer);
                const text = await resp.text().catch(() => '');
                let data = null;
                try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
                sendResponse({ ok: resp.ok, status: resp.status, text: text, data: data });
            } catch (e) {
                sendResponse({ ok: false, status: 0, text: '', data: null, error: 'Network/CORS: ' + ((e && e.message) || 'fetch failed') });
            }
        })();
        return true;
    }
});
