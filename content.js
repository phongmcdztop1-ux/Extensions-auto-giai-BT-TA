
(function () {
    'use strict';

    // Random ID to avoid detection
    const RAND_ID = 'x' + Math.random().toString(36).substring(2, 10);

    // Chi chay o frame chinh — tranh chay trong quang cao / iframe (google ads, facebook...)
    // Neu van inject (all_frames cu), thoat ngay de khong tao nut/bong bong trong quang cao
    try {
        if (window.self !== window.top) return;
        if (window.frameElement) return;
    } catch (_) {
        // cross-origin iframe -> chac chan khong phai top -> thoat
        try { if (window.self !== window.top) return; } catch (_) { return; }
    }

    // Avoid duplicate injection
    if (document.querySelector(`[data-${RAND_ID}]`)) return;

    // Inject anti-blur script into page context (main world)
    try {
        const scriptEl = document.createElement('script');
        scriptEl.src = chrome.runtime.getURL('anti_blur.js');
        (document.head || document.documentElement).appendChild(scriptEl);
        scriptEl.onload = () => scriptEl.remove();
    } catch (e) { }

    // ===== cre: Phong Config (GUI editable, persisted via chrome.storage.local) =====
    const DEFAULT_CONFIG = {
        apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
        apiKeys: ['', ''],
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        sendMode: 'auto',
        temperature: 0.1,
        maxTokens: 4096
    };
    const PRESET_MODELS = [
        'meta-llama/llama-4-scout-17b-16e-instruct',
        'meta-llama/llama-4-maverick-17b-128e-instruct',
        'llama-3.2-11b-vision-preview',
        'llama-3.2-90b-vision-preview',
        'qwen/qwen3-32b',
        'moonshotai/kimi-k2-instruct'
    ];
    let CFG = { apiUrl: DEFAULT_CONFIG.apiUrl, apiKeys: [...DEFAULT_CONFIG.apiKeys], model: DEFAULT_CONFIG.model, sendMode: DEFAULT_CONFIG.sendMode, temperature: DEFAULT_CONFIG.temperature, maxTokens: DEFAULT_CONFIG.maxTokens };
    let currentKeyIndex = 0;
    let cachedModels = [];
 

    const getApiUrl = () => (CFG.apiUrl || DEFAULT_CONFIG.apiUrl).trim();
    const getApiKeys = () => (CFG.apiKeys || []).map(k => (k || '').trim()).filter(Boolean);
    const getCurrentModel = () => (CFG.model || DEFAULT_CONFIG.model).trim();
    const getCurrentModelName = () => getCurrentModel();
    const getMasked = (k) => !k ? '(trong)' : (k.length <= 12 ? '...' + k.slice(-4) : k.slice(0, 6) + '...' + k.slice(-4));
    const getSendMode = () => (CFG.sendMode || 'auto');
    const getTemperature = () => { const v = parseFloat(CFG.temperature); return isNaN(v) ? 0.1 : Math.min(2, Math.max(0, v)); };
    const getMaxTokens = () => { const v = parseInt(CFG.maxTokens, 10); return isNaN(v) || v <= 0 ? 4096 : v; };
    const isLocalUrl = (u) => /localhost|127\.0\.0\.1|192\.168\.|10\.\d|0\.0\.0\.0/i.test(u || getApiUrl());
    const needsKey = (u) => !isLocalUrl(u || getApiUrl());
    function baseFromChatUrl(u) {
        let s = String(u || '').trim().replace(/\/+$/, '');
        s = s.replace(/\/chat\/completions$/i, '');
        return s;
    }
    function modelsUrlFromChatUrl(u) { return baseFromChatUrl(u) + '/models'; }

    // ===== Fetch qua background (fix Failed to fetch do CORS/CSP/mixed-content) =====
    function sendMsgP(msg) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(msg, (r) => {
                    if (chrome.runtime.lastError) resolve(null);
                    else resolve(r);
                });
            } catch (_) { resolve(null); }
        });
    }
    // Tra ve object giong Response: {ok,status,json(),text(),_bgErr}
    async function fetchViaBg(url, method, headers, body, timeout) {
        const tm = timeout || (method === 'GET' ? 20000 : 90000);
        try {
            const bg = await sendMsgP({ action: method === 'GET' ? 'cre_fetch_get' : 'cre_fetch', url: url, method: method, headers: headers, body: body, timeout: tm });
            if (bg && typeof bg.status === 'number' && (bg.text !== undefined || bg.data !== undefined || bg.ok !== undefined || bg.error)) {
                const txt = (typeof bg.text === 'string' && bg.text) ? bg.text : '';
                return {
                    ok: !!bg.ok, status: bg.status, _bgErr: bg.error || '',
                    _text: txt,
                    json: async () => { if (bg.data) return bg.data; try { return txt ? JSON.parse(txt) : {}; } catch (_) { return {}; } },
                    text: async () => txt
                };
            }
        } catch (_) { /* roi xuong direct */ }
        // Fallback: fetch truc tiep tu content-script
        const ctrl = new AbortController();
        const timer = setTimeout(() => { try { ctrl.abort(); } catch (_) { } }, tm);
        try {
            const r = await fetch(url, { method: method, headers: headers, body: body, signal: ctrl.signal });
            clearTimeout(timer);
            return r;
        } catch (e) {
            clearTimeout(timer);
            const err = new Error('Failed to fetch');
            err._isNetwork = true;
            err._detail = (e && e.message) || '';
            err._isAbort = (e && e.name === 'AbortError');
            throw err;
        }
    }
    function friendlyNetErr(apiUrl, detail) {
        const local = isLocalUrl(apiUrl);
        if (local) return 'Không kết nối được server local (Failed to fetch). Kiểm tra: 1) LM Studio/Ollama đã bật server chưa, 2) URL đúng dạng http://localhost:1234/v1/chat/completions, 3) local server đã bật CORS (*). Chi tiết: ' + (detail || 'network');
        return 'Failed to fetch: trang web chặn gọi API trực tiếp (CORS/CSP) hoặc mạng lỗi. Đã thử qua background nhưng vẫn lỗi — kiểm tra mạng, API URL, VPN/adblock. Chi tiết: ' + (detail || 'network');
    }
    // Chan hien tool tren quang cao / iframe / video
    function isAdOrJunk(el) {
        if (!el || !el.closest) return false;
        try {
            if (el.closest('ins.adsbygoogle, [id^="google_ads"], [id*="-ad-"], [id*="_ad_"], [id*="adsbox"], [class*="adsbygoogle"], [class*="advert"], [class*="sponsor"], [aria-label="Advertisement"], [data-ad], iframe, video, [role="dialog"]')) return true;
            const id = (el.id || '') + ' ' + (el.className && el.className.baseVal !== undefined ? '' : (el.className || ''));
            if (/ads|advert|sponsor/i.test(id) && /banner|popup|overlay/i.test(id)) return true;
        } catch (_) { }
        return false;
    }

    async function loadConfig() {
        try {
            if (chrome && chrome.storage && chrome.storage.local) {
                // Doc kho moi; neu chua co thi fallback ve kho cu (PhantomX) de khong mat API key da luu
                const s = await chrome.storage.local.get(['cre_config', 'cre_models', 'phantomx_config', 'phantomx_models']);
                const c = (s && s.cre_config) || (s && s.phantomx_config);
                if (c && !(s && s.cre_config)) { try { await chrome.storage.local.set({ cre_config: c }); } catch (e) { } }
                if (c) {
                    if (typeof c.apiUrl === 'string' && c.apiUrl.trim()) CFG.apiUrl = c.apiUrl.trim();
                    if (typeof c.model === 'string' && c.model.trim()) CFG.model = c.model.trim();
                    if (Array.isArray(c.apiKeys)) CFG.apiKeys = c.apiKeys.map(x => String(x || '').trim());
                    if (typeof c.currentKeyIndex === 'number') currentKeyIndex = c.currentKeyIndex || 0;
                    if (typeof c.sendMode === 'string') CFG.sendMode = c.sendMode;
                    if (c.temperature !== undefined) CFG.temperature = c.temperature;
                    if (c.maxTokens !== undefined) CFG.maxTokens = c.maxTokens;
                }
                const mCache = (s && s.cre_models) || (s && s.phantomx_models);
                if (Array.isArray(mCache) && mCache.length) cachedModels = mCache.slice(0, 200);
            }
        } catch (e) { }
        if (!Array.isArray(CFG.apiKeys) || !CFG.apiKeys.length) CFG.apiKeys = ['', ''];
        currentKeyIndex = Math.min(Math.max(0, currentKeyIndex), Math.max(0, CFG.apiKeys.length - 1));
    }
    async function saveConfig() {
        try { await chrome.storage.local.set({ cre_config: { apiUrl: CFG.apiUrl, apiKeys: CFG.apiKeys, model: CFG.model, currentKeyIndex, sendMode: CFG.sendMode, temperature: CFG.temperature, maxTokens: CFG.maxTokens } }); } catch (e) { }
    }
    async function saveModelsCache() {
        try { await chrome.storage.local.set({ cre_models: cachedModels.slice(0, 200) }); } catch (e) { }
    }

    // Create host element with Shadow DOM (hidden from page scripts)
    const host = document.createElement('div');
    host.setAttribute(`data-${RAND_ID}`, '1');
    host.style.cssText = 'all: initial !important; position: fixed !important; z-index: 2147483647 !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; overflow: visible !important; pointer-events: none !important;';

    const shadow = host.attachShadow({ mode: 'closed' });
    document.documentElement.appendChild(host);

    // Auto-respawn if removed
    const observer = new MutationObserver(() => {
        if (!document.contains(host)) {
            document.documentElement.appendChild(host);
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Inject styles
    const style = document.createElement('style');
    style.textContent = `
        * { box-sizing: border-box !important; }
        .trigger {
            position: fixed !important; bottom: 15px !important; right: 15px !important;
            width: 40px !important; height: 40px !important;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
            border-radius: 50% !important; display: flex !important;
            align-items: center !important; justify-content: center !important;
            font-size: 20px !important; cursor: pointer !important;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3) !important;
            transition: transform 0.2s !important; pointer-events: auto !important;
            user-select: none !important; opacity: 0.8 !important;
        }
        .trigger:hover { transform: scale(1.1) !important; opacity: 1 !important; }
        .overlay {
            position: fixed !important; top: 15px !important; right: 15px !important;
            width: 360px !important; max-height: 520px !important;
            background: #1a1a2e !important; border: 1px solid #333 !important;
            border-radius: 10px !important; box-shadow: 0 10px 40px rgba(0,0,0,0.5) !important;
            font-family: -apple-system, Arial, sans-serif !important;
            color: #eee !important; display: none; flex-direction: column !important;
            overflow: hidden !important; pointer-events: auto !important;
        }
        .overlay.visible { display: flex !important; }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
            padding: 8px 12px !important; font-weight: bold !important; font-size: 13px !important;
            display: flex !important; justify-content: space-between !important; align-items: center !important;
        }
        .header-left { display: flex !important; align-items: center !important; gap: 8px !important; }
        .header-btns { display: flex !important; align-items: center !important; gap: 4px !important; }
        .settings-btn, .close {
            background: none !important; border: none !important; color: white !important;
            font-size: 14px !important; cursor: pointer !important; padding: 2px 6px !important;
            opacity: 0.8 !important; transition: opacity 0.2s !important;
        }
        .settings-btn:hover, .close:hover { opacity: 1 !important; }
        .body { padding: 10px !important; flex: 1 !important; overflow-y: auto !important; max-height: 420px !important; }
        .input { width: 100% !important; height: 45px !important; background: #16213e !important;
            border: 1px solid #444 !important; border-radius: 6px !important; color: #eee !important;
            padding: 8px !important; font-size: 12px !important; resize: none !important; margin-bottom: 6px !important; }
        .input:focus { outline: none !important; border-color: #667eea !important; }
        .hint { font-size: 10px !important; color: #666 !important; margin-bottom: 8px !important; }
        .status { text-align: center !important; color: #00d4ff !important; font-size: 12px !important;
            padding: 8px !important; display: none; }
        .error { color: #ff6b6b !important; font-size: 12px !important; padding: 6px !important; display: none; }
        .response { font-size: 12px !important; line-height: 1.6 !important; color: #eee !important; }
        .response strong { color: #00d4ff !important; }
        .math { display: block !important; margin: 8px 0 !important; padding: 8px !important;
            background: #0f172a !important; border-radius: 5px !important; text-align: center !important; }
        .body::-webkit-scrollbar { width: 5px !important; }
        .body::-webkit-scrollbar-thumb { background: #444 !important; border-radius: 3px !important; }

        /* Settings panel */
        .settings-panel {
            display: none; padding: 10px !important;
            border-bottom: 1px solid #333 !important;
            background: #16213e !important;
            max-height: 340px !important; overflow-y: auto !important;
        }
        .settings-panel.visible { display: block !important; }
        .settings-label {
            font-size: 10px !important; color: #888 !important;
            text-transform: uppercase !important; letter-spacing: 0.5px !important;
            margin-bottom: 4px !important; margin-top: 8px !important;
        }
        .settings-label:first-child { margin-top: 0 !important; }
        .settings-select, .settings-input {
            width: 100% !important; background: #1a1a2e !important;
            border: 1px solid #444 !important; border-radius: 5px !important;
            color: #eee !important; padding: 6px 8px !important;
            font-size: 12px !important; font-family: monospace !important;
        }
        .settings-input { cursor: text !important; }
        .settings-select:focus, .settings-input:focus { outline: none !important; border-color: #667eea !important; }
        .settings-select option { background: #1a1a2e !important; color: #eee !important; }
        .settings-row { display: flex !important; gap: 6px !important; margin-top: 6px !important; }
        .settings-btn2 {
            flex: 1 !important; padding: 6px 4px !important; font-size: 11px !important;
            border-radius: 5px !important; border: 1px solid #444 !important; cursor: pointer !important;
            background: #1a1a2e !important; color: #eee !important; font-weight: bold !important;
        }
        .settings-btn2.primary { background: linear-gradient(135deg,#667eea 0%,#764ba2 100%) !important; border: none !important; color: #fff !important; }
        .settings-btn2.danger { color: #ff6b6b !important; }
        .key-row { display: flex !important; gap: 6px !important; margin-bottom: 6px !important; align-items: center !important; }
        .key-row .settings-input { flex: 1 !important; }
        .key-del {
            background: none !important; border: 1px solid #444 !important; color: #ff6b6b !important;
            border-radius: 5px !important; padding: 5px 8px !important; cursor: pointer !important; font-size: 12px !important;
        }
        .save-msg { font-size: 11px !important; margin-top: 6px !important; min-height: 14px !important; color: #4ade80 !important; }
        .save-msg.err { color: #ff6b6b !important; }

        /* Current info bar */
        .info-bar {
            display: flex !important; justify-content: space-between !important;
            align-items: center !important; padding: 4px 10px !important;
            background: #0f172a !important; font-size: 10px !important;
            color: #667eea !important; border-bottom: 1px solid #222 !important;
        }
        .info-bar span { opacity: 0.9 !important; }
    `;
    shadow.appendChild(style);

    // Trigger button
    const trigger = document.createElement('div');
    trigger.className = 'trigger';
    trigger.innerHTML = '⚡';
    shadow.appendChild(trigger);

    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
        <div class="header">
            <span class="header-left">cre: Phong</span>
            <div class="header-btns">
                <button class="settings-btn" title="Cài đặt">⚙️</button>
                <button class="close">✕</button>
            </div>
        </div>
        <div class="info-bar">
            <span class="info-model">🤖 ...</span>
            <span class="info-key">🔑 ...</span>
        </div>
        <div class="settings-panel">
            <div class="settings-label">API URL (OpenAI-compatible)</div>
            <input class="settings-input api-url-input" placeholder="https://api.groq.com/openai/v1/chat/completions" spellcheck="false" />
            <div class="settings-label">Model ID (gõ tay hoặc chọn mẫu)</div>
            <input class="settings-input model-input" placeholder="meta-llama/llama-4-scout-17b-16e-instruct" spellcheck="false" />
            <select class="settings-select model-preset" style="margin-top:6px !important;">
            </select>
            <div class="settings-label">API Keys (xoay vòng khi bị 429 — Enter trong ô = lưu)</div>
            <div class="keys-list"></div>
            <div class="settings-row">
                <button class="settings-btn2 add-key">+ Thêm key</button>
                <button class="settings-btn2 test-conn">Test kết nối</button>
            </div>
            <div class="settings-row">
                <button class="settings-btn2 refresh-models">↻ Lấy models từ server</button>
            </div>
            <div class="settings-label">Cách gửi ảnh (model chữ sẽ lỗi 400 nếu gửi ảnh)</div>
            <select class="settings-select send-mode">
                <option value="auto">Auto: thử ảnh trước, lỗi thì gửi chữ</option>
                <option value="vision">Luôn gửi ảnh (vision / multimodal)</option>
                <option value="text">Chỉ gửi chữ (model text-only / local LLM)</option>
            </select>
            <div class="settings-row">
                <div style="flex:1 !important;">
                    <div class="settings-label">Temperature</div>
                    <input class="settings-input temp-input" placeholder="0.1" spellcheck="false" />
                </div>
                <div style="flex:1 !important;">
                    <div class="settings-label">Max tokens</div>
                    <input class="settings-input maxtok-input" placeholder="4096" spellcheck="false" />
                </div>
            </div>
            <div class="settings-row">
                <button class="settings-btn2 primary save-cfg">💾 Lưu cấu hình</button>
                <button class="settings-btn2 danger reset-cfg">Reset mặc định</button>
            </div>
            <div class="save-msg"></div>
        </div>
        <div class="body">
            <textarea class="input" placeholder="Mô tả (tùy chọn)..."></textarea>
            <div class="hint">Enter: Giải | Esc: Đóng | ⚙️ Cài đặt</div>
            <div class="status">⏳ Đang xử lý...</div>
            <div class="error"></div>
            <div class="response"></div>
        </div>
    `;
    shadow.appendChild(overlay);

    // Elements
    const inputEl = overlay.querySelector('.input');
    const statusEl = overlay.querySelector('.status');
    const errorEl = overlay.querySelector('.error');
    const responseEl = overlay.querySelector('.response');
    const closeBtn = overlay.querySelector('.close');
    const settingsBtn = overlay.querySelector('.settings-btn');
    const settingsPanel = overlay.querySelector('.settings-panel');
    const infoModel = overlay.querySelector('.info-model');
    const infoKey = overlay.querySelector('.info-key');
    const apiUrlInput = overlay.querySelector('.api-url-input');
    const modelInput = overlay.querySelector('.model-input');
    const modelPreset = overlay.querySelector('.model-preset');
    const keysList = overlay.querySelector('.keys-list');
    const addKeyBtn = overlay.querySelector('.add-key');
    const testBtn = overlay.querySelector('.test-conn');
    const refreshBtn = overlay.querySelector('.refresh-models');
    const sendModeSel = overlay.querySelector('.send-mode');
    const tempInput = overlay.querySelector('.temp-input');
    const maxtokInput = overlay.querySelector('.maxtok-input');
    const saveBtn = overlay.querySelector('.save-cfg');
    const resetBtn = overlay.querySelector('.reset-cfg');
    const saveMsg = overlay.querySelector('.save-msg');

    function showSaveMsg(m, isErr) {
        saveMsg.textContent = m; saveMsg.classList.toggle('err', !!isErr);
        if (m) setTimeout(() => { if (saveMsg.textContent === m) saveMsg.textContent = ''; }, 4000);
    }
    function updateInfoBar() {
        const keys = getApiKeys();
        const mdl = getCurrentModel();
        infoModel.textContent = '🤖 ' + (mdl.length > 34 ? '...' + mdl.slice(-31) : mdl);
        infoModel.title = mdl;
        if (isLocalUrl(getApiUrl())) infoKey.textContent = '🔑 local — ko can key';
        else if (!keys.length) infoKey.textContent = '🔑 chua co key — bam ⚙️';
        else { const i = Math.min(currentKeyIndex, keys.length - 1); infoKey.textContent = '🔑 Key ' + (i + 1) + '/' + keys.length + ' ' + getMasked(keys[i]); }
    }

    function refreshSettingsUI() {
        apiUrlInput.value = CFG.apiUrl || '';
        modelInput.value = CFG.model || '';
        sendModeSel.value = getSendMode();
        tempInput.value = CFG.temperature;
        maxtokInput.value = CFG.maxTokens;
        const allM = [...new Set([CFG.model, ...cachedModels, ...PRESET_MODELS].filter(Boolean))];
        modelPreset.innerHTML = allM.map(m => '<option value="' + m + '">' + m + '</option>').join('') + '<option value="__custom__">Giu chu tu go...</option>';
        modelPreset.value = CFG.model;
        keysList.innerHTML = '';
        const raw = (CFG.apiKeys && CFG.apiKeys.length ? CFG.apiKeys : ['']);
        raw.forEach((k, i) => {
            const row = document.createElement('div');
            row.className = 'key-row';
            const inp = document.createElement('input');
            inp.className = 'settings-input key-input';
            inp.type = 'password'; inp.placeholder = 'Key ' + (i + 1);
            inp.spellcheck = false; inp.value = k || '';
            inp.title = 'Double-click de hien/an';
            inp.addEventListener('dblclick', () => { inp.type = inp.type === 'password' ? 'text' : 'password'; });
            inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); collectFromUI(true); } });
            const del = document.createElement('button');
            del.className = 'key-del'; del.textContent = 'X'; del.title = 'Xoa';
            del.addEventListener('click', (ev) => { ev.stopPropagation(); collectFromUI(false); CFG.apiKeys.splice(i, 1); if (!CFG.apiKeys.length) CFG.apiKeys = ['']; saveConfig().then(() => { refreshSettingsUI(); }); });
            row.appendChild(inp); row.appendChild(del);
            keysList.appendChild(row);
        });
        updateInfoBar();
    }
    function collectFromUI(andSave) {
        CFG.apiUrl = (apiUrlInput.value || '').trim() || DEFAULT_CONFIG.apiUrl;
        const tm = (modelInput.value || '').trim();
        if (tm) CFG.model = tm;
        CFG.sendMode = sendModeSel.value || 'auto';
        const tv = parseFloat((tempInput.value || '').trim());
        if (!isNaN(tv)) CFG.temperature = Math.min(2, Math.max(0, tv));
        const mv = parseInt((maxtokInput.value || '').trim(), 10);
        if (!isNaN(mv) && mv > 0) CFG.maxTokens = mv;
        const ins = [...keysList.querySelectorAll('.key-input')];
        CFG.apiKeys = ins.map(x => (x.value || '').trim());
        if (!CFG.apiKeys.length) CFG.apiKeys = [''];
        currentKeyIndex = 0;
        if (andSave !== false) saveConfig().then(() => { updateInfoBar(); showSaveMsg('Da luu! Ap dung ngay.'); });
        updateInfoBar();
    }

    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsPanel.classList.toggle('visible');
        if (settingsPanel.classList.contains('visible')) refreshSettingsUI();
    });

    function showOverlay() {
        overlay.classList.add('visible');
        trigger.style.display = 'none';
        inputEl.focus();
        responseEl.innerHTML = '';
        errorEl.style.display = 'none';
        statusEl.style.display = 'none';
    }

    function hideOverlay() {
        overlay.classList.remove('visible');
        trigger.style.display = 'flex';
        settingsPanel.classList.remove('visible');
    }

    trigger.addEventListener('click', (e) => { e.stopPropagation(); showOverlay(); });
    closeBtn.addEventListener('click', hideOverlay);

    // An nut 👻 khi hover quang cao / video / iframe — tranh hien nham tren ads
    // (content.js da co guard top-frame + all_frames:false, day la lop 2 cho fixed trigger)
    document.addEventListener('mouseover', (e) => {
        try {
            if (overlay.classList.contains('visible')) return;
            const el = e.target;
            if (!el || !el.closest) return;
            if (isAdOrJunk(el)) {
                trigger.style.opacity = '0';
                trigger.style.pointerEvents = 'none';
            } else {
                trigger.style.opacity = '';
                trigger.style.pointerEvents = '';
            }
        } catch (_) { }
    }, true);

    // Settings inputs: stopPropagation so page + overlay Enter-handler ignore them
    modelPreset.addEventListener('change', (e) => {
        e.stopPropagation();
        if (e.target.value && e.target.value !== '__custom__') modelInput.value = e.target.value;
    });
    [apiUrlInput, modelInput].forEach(el => {
        el.addEventListener('click', (e) => e.stopPropagation());
        el.addEventListener('keydown', (ev) => {
            ev.stopPropagation();
            if (ev.key === 'Enter') { ev.preventDefault(); collectFromUI(true); }
        });
    });
    addKeyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        collectFromUI(false); CFG.apiKeys.push('');
        saveConfig().then(() => refreshSettingsUI());
    });
    saveBtn.addEventListener('click', (e) => { e.stopPropagation(); collectFromUI(true); });
    resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        CFG = { apiUrl: DEFAULT_CONFIG.apiUrl, apiKeys: [...DEFAULT_CONFIG.apiKeys], model: DEFAULT_CONFIG.model, sendMode: DEFAULT_CONFIG.sendMode, temperature: DEFAULT_CONFIG.temperature, maxTokens: DEFAULT_CONFIG.maxTokens };
        currentKeyIndex = 0;
        saveConfig().then(() => { refreshSettingsUI(); showSaveMsg('Da reset ve mac dinh.'); });
    });
    testBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        collectFromUI(false);
        const url = getApiUrl();
        const tk = getApiKeys();
        if (needsKey(url) && !tk.length) { showSaveMsg('Chua co API key nao.', true); return; }
        showSaveMsg('Dang test...');
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (needsKey(url)) headers['Authorization'] = 'Bearer ' + tk[Math.min(currentKeyIndex, tk.length - 1)];
            else if (tk.length) headers['Authorization'] = 'Bearer ' + tk[0];
            let r;
            try {
                r = await fetchViaBg(url, 'POST', headers, JSON.stringify({ model: getCurrentModel(), messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }), 30000);
            } catch (e) {
                throw new Error((e && e._isNetwork) ? friendlyNetErr(url, e._detail) : ((e && e.message) || 'Fetch failed'));
            }
            if (r.ok) { showSaveMsg('Ket noi OK! Model dung duoc.'); await saveConfig(); }
            else if (r.status === 429) showSaveMsg('Key bi rate-limit (429).', true);
            else if (r.status === 401 || r.status === 403) showSaveMsg('Sai key (401/403).', true);
            else { const t = await r.text().catch(() => ''); showSaveMsg('Loi ' + r.status + ': ' + t.slice(0, 200), true); }
        } catch (err) { showSaveMsg('Loi mang/URL: ' + err.message, true); }
        updateInfoBar();
    });
    refreshBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        collectFromUI(false);
        const url = getApiUrl();
        showSaveMsg('Dang lay danh sach models...');
        try {
            const headers = {};
            const tk = getApiKeys();
            if (tk.length) headers['Authorization'] = 'Bearer ' + tk[0];
            let r;
            try {
                r = await fetchViaBg(modelsUrlFromChatUrl(url), 'GET', headers, undefined, 20000);
            } catch (e) {
                throw new Error((e && e._isNetwork) ? friendlyNetErr(url, e._detail) : ((e && e.message) || 'Fetch failed'));
            }
            if (!r.ok) { const t = await r.text().catch(() => ''); showSaveMsg('Ko lay duoc models (' + r.status + '): ' + t.slice(0, 150), true); return; }
            const j = await r.json();
            const list = (j.data || j.models || []).map(x => x.id || x.name).filter(Boolean);
            if (!list.length) { showSaveMsg('Server tra ve 0 model.', true); return; }
            cachedModels = [...new Set(list)].sort();
            await saveModelsCache(); await saveConfig();
            refreshSettingsUI();
            if (cachedModels.length && !cachedModels.includes(CFG.model)) { modelInput.value = cachedModels[0]; CFG.model = cachedModels[0]; await saveConfig(); refreshSettingsUI(); }
            showSaveMsg('Da nap ' + cachedModels.length + ' models! Chon o dropdown.');
        } catch (err) { showSaveMsg('Loi: ' + err.message + ' (server local can --cors?)', true); }
    });
    loadConfig().then(() => refreshSettingsUI());

    // Keyboard (capture phase) — bo qua khi dang go trong panel cai dat
    document.addEventListener('keydown', (e) => {
        if (overlay.classList.contains('visible')) {
            try {
                const ae = shadow.activeElement;
                if (ae && (ae.classList.contains('api-url-input') || ae.classList.contains('model-input') || ae.classList.contains('model-preset') || ae.classList.contains('key-input') || ae.classList.contains('temp-input') || ae.classList.contains('maxtok-input') || ae.classList.contains('send-mode'))) return;
            } catch (_) { }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideOverlay(); }
            else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); captureAndSolve(); }
        }
    }, true);

    // Messages from background
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'toggle') {
            overlay.classList.contains('visible') ? hideOverlay() : showOverlay();
        }
        sendResponse({ ok: true });
    });

    let pxBusy = false;
    function captureAndSolve() {
        if (pxBusy) { statusEl.style.display = 'block'; statusEl.textContent = '⏳ Đang xử lý — đợi 5s rồi bấm lại...'; return; }
        const url = getApiUrl();
        const keys0 = getApiKeys();
        if (needsKey(url) && !keys0.length) {
            showError('Chua co API key — bam ⚙️ de nhap key.');
            settingsPanel.classList.add('visible');
            refreshSettingsUI();
            return;
        }
        statusEl.style.display = 'block';
        statusEl.textContent = '⏳ Dang xu ly (' + getCurrentModel() + ')...';
        errorEl.style.display = 'none';
        responseEl.innerHTML = '';
        pxBusy = true;
        chrome.runtime.sendMessage({ action: 'capture' }, (response) => {
            pxBusy = false;
            if (response && response.dataUrl) {
                processScreenshot(response.dataUrl);
            } else {
                showError(response?.error || 'Không thể chụp');
            }
        });
        setTimeout(() => { pxBusy = false; }, 15000);
    }

    // OpenAI-compatible chat (works with Groq / OpenAI / OpenRouter / LM Studio / Ollama...)
    function buildPrompt(description) {
        return 'Ban la chuyen gia giai bai tap mon TIENG ANH. Hay giai toan bo cau hoi trong anh. ' + (description ? 'Yeu cau them: ' + description : '') + '\n\nQUY TAC:\n- Ghi ro tung cau: **Cau 1:** **[Dap an]** (Vi du: **1. A - although**)\n- Trac nghiem: Ghi ro chu cai (A/B/C/D) kem noi dung cua dap an do\n- Giai thich sieu ngan gon (cau truc ngu phap/tu vung/dich nghia trong 1 dong)\n- Dien tu / viet lai cau / chia thi: Dua ra dap an chuan xac ngay lap tuc\n- Di thang vao dap an, KHONG tom tat de, KHONG dai dong' + '\n\n[DAP AN]: Dong dau tien BAT BUOC ghi dung format: DAP AN: 1A 2B 3C ... (so cau + chu cai A/B/C/D lien nhau, cach nhau bang khoang trang; nhieu dap an thi noi bang + vi du 4A+C; dien tu/tu luan ngan thi ghi 5:tu-can-dien). Vi du: DAP AN: 1B 2A 3D 4A+C 5:although. Sau dong DAP AN moi giai thich chi tiet tung cau.';
    }
    function compressImage(dataUrl, maxW, q) {
        maxW = maxW || 1280; q = (q == null ? 0.82 : q);
        return new Promise(function (resolve) {
            try {
                if (!dataUrl || dataUrl.indexOf('data:image') !== 0) { resolve(dataUrl); return; }
                var img = new Image();
                img.onload = function () {
                    try {
                        var w = img.width || maxW, h = img.height || 800;
                        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
                        var maxH = 2000;
                        if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
                        var c = document.createElement('canvas'); c.width = w; c.height = h;
                        var ctx = c.getContext('2d');
                        ctx.drawImage(img, 0, 0, w, h);
                        try { resolve(c.toDataURL('image/jpeg', q)); }
                        catch (e) { resolve(dataUrl); }
                    } catch (e) { resolve(dataUrl); }
                };
                img.onerror = function () { resolve(dataUrl); };
                img.src = dataUrl;
            } catch (e) { resolve(dataUrl); }
        });
    }
    function buildMessages(prompt, dataUrl, withImage) {
        if (withImage) return [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } }] }];
        return [{ role: 'user', content: prompt + (dataUrl ? '\n\n[Luu y: model nay khong doc duoc anh, hay giai theo mo ta: ' + (inputEl.value.trim() || 'hay mo ta de bai trong o Mo ta roi Enter lai') + ']' : '') }];
    }
    async function doChat(apiUrl, apiKey, model, messages) {
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
        const temp = getTemperature();
        const mtok = getMaxTokens();
        const bodies = [
            { model: model, messages: messages, temperature: temp, max_tokens: mtok },
            { model: model, messages: messages, temperature: temp, max_completion_tokens: mtok },
            { model: model, messages: messages, max_tokens: mtok },
            { model: model, messages: messages }
        ];
        let lastResp = null;
        for (let i = 0; i < bodies.length; i++) {
            let resp;
            try {
                resp = await fetchViaBg(apiUrl, 'POST', headers, JSON.stringify(bodies[i]), 90000);
            } catch (e) {
                if (e && e._isNetwork) throw new Error(friendlyNetErr(apiUrl, e._detail));
                throw e;
            }
            if (resp.ok) return resp;
            if (resp.status !== 400 && resp.status !== 422) return resp;
            let txt = '';
            try { if (typeof resp._text === 'string' && resp._text) txt = resp._text; else if (resp.clone) txt = await resp.clone().text(); else txt = await resp.text(); } catch (_) { return resp; }
            const isParamErr = /temperature|top_p|max_tokens|max_completion|unsupported.*param|unknown.*param|additional properties|exclusiveMinimum|validation/i.test(txt || '');
            if (!isParamErr) return resp;
            lastResp = resp;
        }
        return lastResp;
    }
    async function parseErr(response) {
        const raw = await response.text().catch(() => '');
        try { const j = JSON.parse(raw); const m = j.error && (j.error.message || j.error.code || j.error.type); if (m) return m + ' (HTTP ' + response.status + ')'; } catch (_) { }
        if (raw) return raw.slice(0, 300) + ' (HTTP ' + response.status + ')';
        return 'Error: ' + response.status;
    }
    function looksLikeImageError(msg) {
        return /image|vision|multimodal|invalid.*content|unsupported.*type|\"model\"/i.test(msg || '');
    }
    function extractText(data) {
        try {
            var ch = data && data.choices && data.choices[0];
            var t = ch && ((ch.message && ch.message.content) || ch.text || (ch.delta && ch.delta.content));
            if (Array.isArray(t)) t = t.map(function (x) { return (x && (x.text || x.content)) || ''; }).join('');
            if (t && typeof t !== 'string') t = String(t);
            return (t || '').toString();
        } catch (_) { return ''; }
    }
    async function processScreenshot(dataUrl) {
        if (!dataUrl) { showError('Không thể chụp'); return; }
        try { statusEl.textContent = '⏳ Đang nén ảnh...'; dataUrl = await compressImage(dataUrl); } catch (_) { }
        const description = inputEl.value.trim();
        const model = getCurrentModel();
        const apiUrl = getApiUrl();
        let keys = getApiKeys();
        if (!needsKey(apiUrl) && !keys.length) keys = [null];
        if (!keys.length) { showError('Chua co API key — bam ⚙️ de nhap.'); return; }
        const mode = getSendMode();
        const prompt = buildPrompt(description);

        // Try with current key, fallback to other key on rate limit
        let lastErr = '';
        for (let attempt = 0; attempt < keys.length; attempt++) {
            const keyIdx = (currentKeyIndex + attempt) % keys.length;
            const apiKey = keys[keyIdx];
            currentKeyIndex = keyIdx; updateInfoBar(); saveConfig();
            const variants = mode === 'text' ? [false] : (mode === 'vision' ? [true] : [true, false]);

            for (let v = 0; v < variants.length; v++) {
                const withImage = variants[v];
                try {
                    statusEl.textContent = withImage ? ('⏳ Dang gui ANH cho ' + model + '...') : ('⏳ Model ko nhan anh, gui CHU cho ' + model + '...');
                    const response = await doChat(apiUrl, apiKey, model, buildMessages(prompt, dataUrl, withImage));
                    if (response.status === 429) { statusEl.textContent = '⏳ Key ' + (keyIdx + 1) + ' bi limit, doi key...'; break; }
                    if (!response.ok) {
                        const msg = await parseErr(response);
                        if (withImage && (response.status === 400 || response.status === 422) && v < variants.length - 1) continue;
                        if (withImage && looksLikeImageError(msg) && v < variants.length - 1) continue;
                        if (attempt === keys.length - 1 && v === variants.length - 1) {
                            if (/model/i.test(msg)) showError(msg + ' → bam ⚙️ ↻ Lay models tu server de chon id dung.');
                            else showError(msg + (withImage ? '' : ' → model text-only: hay go de bai vao o Mo ta.'));
                        }
                        lastErr = msg;
                        break;
                    }
                    const data = await response.json();
                    const text = extractText(data);
                    if (!text) { lastErr = 'Khong co phan hoi'; if (attempt === keys.length - 1 && v === variants.length - 1) showError(lastErr); break; }
                    renderResponse(text);
                    statusEl.style.display = 'none';
                    return;
                } catch (err) {
                    lastErr = err.message || 'Fetch failed';
                    if (attempt === keys.length - 1 && v === variants.length - 1) showError(lastErr);
                }
            }
        }
    }

    function showError(msg) {
        errorEl.textContent = '❌ ' + msg;
        errorEl.style.display = 'block';
        statusEl.style.display = 'none';
    }

    function renderResponse(text) {
        let html = text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>')
            .replace(/\$\$([\s\S]*?)\$\$/g, '<div class="math">$$$1$$</div>');
        responseEl.innerHTML = html;
    }


})();
