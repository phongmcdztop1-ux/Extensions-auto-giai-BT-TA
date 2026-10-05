// cre: Phong Anti-Blur & Anti-Detection Engine
// Chống phát hiện rời tab, chuyển cửa sổ, mất focus, di chuột ra ngoài cho các trang thi trực tuyến (Azota, Shub, LMS, Google Forms, v.v.)

(function () {
    'use strict';

    if (window.__cre_phong_antiblur_installed__) return;
    window.__cre_phong_antiblur_installed__ = true;

    // 1. Luôn giả lập tab đang active & hiển thị
    try {
        Object.defineProperty(Document.prototype, 'hidden', {
            get: function () { return false; },
            configurable: true
        });
        Object.defineProperty(document, 'hidden', {
            get: function () { return false; },
            configurable: true
        });

        Object.defineProperty(Document.prototype, 'visibilityState', {
            get: function () { return 'visible'; },
            configurable: true
        });
        Object.defineProperty(document, 'visibilityState', {
            get: function () { return 'visible'; },
            configurable: true
        });

        Object.defineProperty(Document.prototype, 'webkitVisibilityState', {
            get: function () { return 'visible'; },
            configurable: true
        });
        Object.defineProperty(document, 'webkitVisibilityState', {
            get: function () { return 'visible'; },
            configurable: true
        });

        // 2. hasFocus() luôn trả về true
        Document.prototype.hasFocus = function () { return true; };
        document.hasFocus = function () { return true; };
    } catch (e) { }

    // 3. Danh sách sự kiện cần vô hiệu hóa khi gắn vào window/document
    const BLOCKED_WINDOW_EVENTS = new Set([
        'blur',
        'focusout',
        'visibilitychange',
        'webkitvisibilitychange',
        'pagehide',
        'mouseleave',
        'mouseout'
    ]);

    // Chặn thông qua addEventListener
    const origAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
        const lowerType = (type || '').toLowerCase();

        // Nếu là sự kiện mất focus / rời tab / rời chuột trên window hoặc document -> chặn
        if (BLOCKED_WINDOW_EVENTS.has(lowerType)) {
            if (this === window || this === document || this === document.body || this === document.documentElement) {
                // Không đăng ký listener này của trang web
                return;
            }
        }

        return origAddEventListener.call(this, type, listener, options);
    };

    // 4. Vô hiệu hóa các handler gán trực tiếp: window.onblur, document.onvisibilitychange...
    const inlineProps = [
        { target: window, prop: 'onblur' },
        { target: window, prop: 'onfocusout' },
        { target: window, prop: 'onpagehide' },
        { target: window, prop: 'onmouseleave' },
        { target: window, prop: 'onmouseout' },
        { target: document, prop: 'onvisibilitychange' },
        { target: document, prop: 'onwebkitvisibilitychange' },
        { target: document, prop: 'onblur' },
        { target: document, prop: 'onfocusout' }
    ];

    inlineProps.forEach(({ target, prop }) => {
        try {
            Object.defineProperty(target, prop, {
                get: function () { return null; },
                set: function () { },
                configurable: true
            });
        } catch (e) { }
    });

    // 5. Chặn sự kiện ở capture phase nếu trang web đã lỡ đăng ký từ trước
    const suppressEvent = (e) => {
        e.stopImmediatePropagation();
        e.stopPropagation();
        e.preventDefault();
    };

    ['visibilitychange', 'webkitvisibilitychange', 'pagehide'].forEach(evt => {
        window.addEventListener(evt, suppressEvent, true);
        document.addEventListener(evt, suppressEvent, true);
    });

    window.addEventListener('blur', (e) => {
        if (e.target === window || e.target === document) {
            e.stopImmediatePropagation();
        }
    }, true);

    console.log('⚡ [cre: Phong] Anti-Blur & Anti-Detection đã kích hoạt thành công!');
})();
