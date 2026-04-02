(function () {
    'use strict';

    const installedIds = new Set();
    const modStates = new Map();

    if (window.__smmOverlayInitialized) {
        if (Array.isArray(window.__smmInstalledModIds)) {
            window.__smmSetInstalledMods(window.__smmInstalledModIds);
        }

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

    function setInstalledIds(ids) {
        installedIds.clear();

        if (Array.isArray(ids)) {
            ids.forEach((id) => {
                if (id !== null && id !== undefined) {
                    installedIds.add(String(id));
                }
            });
        }

        refreshAllButtons();
    }

    function setModStates(states) {
        modStates.clear();

        if (states && typeof states === 'object') {
            Object.entries(states).forEach(([modId, state]) => {
                if (modId) {
                    modStates.set(String(modId), String(state || ''));
                }
            });
        }

        refreshAllButtons();
    }

    function isInstalled(modId) {
        return installedIds.has(String(modId));
    }

    function getState(modId) {
        const state = modStates.get(String(modId));
        if (state) return state;
        return isInstalled(modId) ? 'installed' : 'not-installed';
    }

    function getCardModName(item, modId) {
        return item.querySelector('.workshopItemTitle, .item_title, h3, .title')?.textContent?.trim() || modId;
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

    function getButtonBaseStyles() {
        return `
            position: absolute; bottom: 8px; right: 8px;
            color: white; border: none; border-radius: 6px;
            padding: 6px 12px; cursor: pointer; font-size: 12px;
            font-weight: bold; z-index: 9999;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            transition: all 0.2s ease;
        `;
    }

    function applyInstallVisual(btn) {
        btn.textContent = '\u2b07 Install';
        btn.title = 'Install mod with Stellaris Mod Manager';
        btn.style.background = 'linear-gradient(135deg, #4a9eff, #2979d8)';
    }

    function applyInstalledVisual(btn, isHovered) {
        if (isHovered) {
            btn.textContent = '\u2715 Uninstall';
            btn.title = 'Uninstall mod from Stellaris Mod Manager';
            btn.style.background = 'linear-gradient(135deg, #ef5b5b, #be3131)';
            return;
        }

        btn.textContent = '\u2713 Installed';
        btn.title = 'This mod is installed';
        btn.style.background = 'linear-gradient(135deg, #e2be67, #c2932c)';
    }

    function updateButtonVisual(btn) {
        const modId = btn.dataset.smmModId;
        const state = getState(modId);
        const hovered = btn.matches(':hover');

        btn.disabled = false;

        if (state === 'queued') {
            btn.textContent = '\u23f3 Queued';
            btn.title = 'Queued for install';
            btn.style.background = 'linear-gradient(135deg, #e2be67, #c2932c)';
            btn.disabled = true;
            return;
        }

        if (state === 'installing') {
            btn.textContent = '\u23f3 Installing...';
            btn.title = 'Install in progress';
            btn.style.background = 'linear-gradient(135deg, #4a9eff, #2979d8)';
            btn.disabled = true;
            return;
        }

        if (state === 'uninstalling') {
            btn.textContent = '\u23f3 Uninstalling...';
            btn.title = 'Uninstall in progress';
            btn.style.background = 'linear-gradient(135deg, #ef5b5b, #be3131)';
            btn.disabled = true;
            return;
        }

        if (state === 'error') {
            btn.textContent = '\u26A0 Retry Install';
            btn.title = 'Last action failed. Click to retry install';
            btn.style.background = 'linear-gradient(135deg, #ef5b5b, #be3131)';
            return;
        }

        if (state === 'installed') {
            applyInstalledVisual(btn, hovered);
            return;
        }

        applyInstallVisual(btn);
        if (hovered) {
            btn.style.background = 'linear-gradient(135deg, #6bd58d, #3ea769)';
        }
    }

    function onButtonClick(btn, modId, modName, event) {
        event.preventDefault();
        event.stopPropagation();

        const state = getState(modId);
        if (state === 'queued' || state === 'installing' || state === 'uninstalling') {
            return;
        }

        const installed = state === 'installed';
        const action = installed ? 'uninstall' : 'install';

        modStates.set(String(modId), installed ? 'uninstalling' : 'installing');
        refreshAllButtons();

        try {
            const payload = JSON.stringify({
                action: action,
                modId: modId,
                modName: modName
            });

            if (!postToHost(payload)) {
                window.location.href = 'smm://' + action + '/' + modId;
            }
        } catch (err) {
            modStates.set(String(modId), 'error');
            refreshAllButtons();
            return;
        }
    }

    function addInstallButton(item) {
        if (item.querySelector('.smm-install-btn')) return;

        const modId = extractModId(item);
        if (!modId) return;

        const btn = document.createElement('button');
        btn.className = 'smm-install-btn';
        btn.dataset.smmModId = modId;
        btn.style.cssText = getButtonBaseStyles();
        btn.onmouseenter = () => updateButtonVisual(btn);
        btn.onmouseleave = () => updateButtonVisual(btn);
        btn.onclick = (e) => onButtonClick(btn, modId, getCardModName(item, modId), e);

        item.style.position = 'relative';
        item.appendChild(btn);
        updateButtonVisual(btn);
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
            bigBtn.dataset.smmModId = detailsId;
            bigBtn.style.cssText = `
                display: block; width: 100%; margin: 10px 0;
                color: white; border: none; border-radius: 8px;
                padding: 12px 20px; cursor: pointer; font-size: 14px;
                font-weight: bold; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    transition: all 0.2s ease;
            `;
            bigBtn.onmouseenter = () => updateButtonVisual(bigBtn);
            bigBtn.onmouseleave = () => updateButtonVisual(bigBtn);
            bigBtn.onclick = (e) => onButtonClick(
                bigBtn,
                detailsId,
                document.querySelector('.workshopItemTitle, h1')?.textContent?.trim() || detailsId,
                e
            );
            mainArea.insertBefore(bigBtn, mainArea.firstChild);
            updateButtonVisual(bigBtn);
        }
    }

    function refreshAllButtons() {
        document.querySelectorAll('.smm-install-btn, .smm-install-main-btn').forEach((btn) => {
            updateButtonVisual(btn);
        });
    }

    window.__smmSetInstalledMods = function (ids) {
        window.__smmInstalledModIds = Array.isArray(ids) ? ids : [];
        setInstalledIds(window.__smmInstalledModIds);
    };

    window.__smmSetModStates = function (states) {
        window.__smmModStates = states && typeof states === 'object' ? states : {};
        setModStates(window.__smmModStates);
    };

    if (Array.isArray(window.__smmInstalledModIds)) {
        setInstalledIds(window.__smmInstalledModIds);
    }

    if (window.__smmModStates && typeof window.__smmModStates === 'object') {
        setModStates(window.__smmModStates);
    }
})();
