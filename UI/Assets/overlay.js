(function () {
    'use strict';

    if (window.__smmOverlayInitialized) {
        if (typeof window.__smmOverlayRescan === 'function') {
            window.__smmOverlayRescan();
        }
        return;
    }

    window.__smmOverlayInitialized = true;

    function postToHost(payload) {
        if (typeof window.invokeCSharpAction === 'function') {
            window.invokeCSharpAction(payload);
            return true;
        }

        if (window.chrome && window.chrome.webview && typeof window.chrome.webview.postMessage === 'function') {
            window.chrome.webview.postMessage(payload);
            return true;
        }

        return false;
    }

    function extractModId(item) {
        // Try data-publishedfileid attribute first
        if (item.dataset.publishedfileid) return item.dataset.publishedfileid;
        // Try href links containing id=
        const link = item.querySelector('a[href*="id="]');
        if (link) {
            const match = link.href.match(/[?&]id=(\d+)/);
            if (match) return match[1];
        }
        // Try data attribute from parent
        const parent = item.closest('[data-publishedfileid]');
        if (parent) return parent.dataset.publishedfileid;
        return null;
    }

    function addInstallButton(item) {
        if (item.querySelector('.smm-install-btn')) return;

        const modId = extractModId(item);
        if (!modId) return;

        const btn = document.createElement('button');
        btn.className = 'smm-install-btn';
        btn.textContent = '\u2b07 Install';
        btn.title = 'Install mod with Stellaris Mod Manager';
        btn.style.cssText = `
            position: absolute; bottom: 8px; right: 8px;
            background: linear-gradient(135deg, #4a9eff, #2979d8);
            color: white; border: none; border-radius: 6px;
            padding: 6px 12px; cursor: pointer; font-size: 12px;
            font-weight: bold; z-index: 9999;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            transition: all 0.2s ease;
        `;
        btn.onmouseenter = () => { btn.style.background = 'linear-gradient(135deg, #66b3ff, #4a9eff)'; };
        btn.onmouseleave = () => { btn.style.background = 'linear-gradient(135deg, #4a9eff, #2979d8)'; };
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            btn.textContent = '\u23f3 Installing...';
            btn.disabled = true;
            try {
                const payload = JSON.stringify({
                    action: 'install',
                    modId: modId,
                    modName: item.querySelector('.workshopItemTitle, .item_title, h3, .title')?.textContent?.trim() || modId
                });

                if (!postToHost(payload)) {
                    // Fallback: navigate to custom scheme
                    window.location.href = 'smm://install/' + modId;
                }
            } catch (err) {
                btn.textContent = '\u2b07 Install';
                btn.disabled = false;
            }
        };
        item.style.position = 'relative';
        item.appendChild(btn);
    }

    function scanItems() {
        // Prefer top-level workshop card containers to avoid duplicate buttons on nested nodes.
        const cards = document.querySelectorAll('.workshopItem, .workshop_item_link');
        if (cards.length > 0) {
            cards.forEach(addInstallButton);
            return;
        }

        // Fallback selector for pages that only expose published-file nodes.
        document.querySelectorAll('[data-publishedfileid]').forEach(addInstallButton);
    }

    window.__smmOverlayRescan = scanItems;

    // Initial scan
    scanItems();

    // Watch for dynamic content (infinite scroll etc.)
    const observer = new MutationObserver(scanItems);
    observer.observe(document.body, { childList: true, subtree: true });

    // Also handle single-item page (mod detail page)
    const detailsId = new URLSearchParams(window.location.search).get('id');
    if (detailsId && window.location.href.includes('filedetails')) {
        const mainArea = document.querySelector('.rightDetailsBlock, .game_area_description');
        if (mainArea && !document.querySelector('.smm-install-main-btn')) {
            const bigBtn = document.createElement('button');
            bigBtn.className = 'smm-install-main-btn';
            bigBtn.textContent = '\u2b07 Install with SMM';
            bigBtn.style.cssText = `
                display: block; width: 100%; margin: 10px 0;
                background: linear-gradient(135deg, #4a9eff, #2979d8);
                color: white; border: none; border-radius: 8px;
                padding: 12px 20px; cursor: pointer; font-size: 14px;
                font-weight: bold; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            `;
            bigBtn.onclick = (e) => {
                e.preventDefault();
                const payload = JSON.stringify({
                    action: 'install',
                    modId: detailsId,
                    modName: document.querySelector('.workshopItemTitle, h1')?.textContent?.trim() || detailsId
                });

                postToHost(payload);
            };
            mainArea.insertBefore(bigBtn, mainArea.firstChild);
        }
    }
})();
