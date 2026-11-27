(() => {
  "use strict";

  if (window.__shortsShadowbanLoaded) return;
  window.__shortsShadowbanLoaded = true;

  const STORAGE_KEY = "shortsShadowbanHandles";
  const BUTTON_CLASS = "shorts-shadowban-button";
  const STYLE_ID = "shorts-shadowban-styles";
  const RENDERER_SELECTOR = "ytd-reel-video-renderer, ytd-reel-video-renderer-cow";
  let blockedHandles = new Set();
  let lastSkippedHandle = "";
  let lastSkippedAt = 0;
  let fallbackButton = null;
  let fallbackRenderer = null;

  const storageArea = () => {
    if (globalThis.chrome?.storage?.local) return globalThis.chrome.storage.local;
    if (globalThis.browser?.storage?.local) return globalThis.browser.storage.local;
    return null;
  };

  async function loadBlockedHandles() {
    const area = storageArea();
    try {
      if (area) {
        const result = await area.get(STORAGE_KEY);
        return Array.isArray(result?.[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
      }
    } catch (error) {
      console.warn("Shorts Shadowban: storage read failed", error);
    }

    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  }

  async function saveBlockedHandles() {
    const handles = [...blockedHandles].sort((a, b) => a.localeCompare(b));
    const area = storageArea();
    try {
      if (area) {
        await area.set({ [STORAGE_KEY]: handles });
        return;
      }
    } catch (error) {
      console.warn("Shorts Shadowban: storage write failed", error);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(handles));
  }

  function isShortsPage() {
    return location.pathname.startsWith("/shorts/");
  }

  function visibleArea(element) {
    const rect = element.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    return width * height;
  }

  function activeRenderer() {
    const renderers = [...document.querySelectorAll(RENDERER_SELECTOR)];
    const explicitlyActive = renderers.find((renderer) =>
      (renderer.hasAttribute("is-active") || renderer.hasAttribute("active")) &&
      !renderer.hidden && renderer.getAttribute("aria-hidden") !== "true"
    );
    if (explicitlyActive) return explicitlyActive;
    return renderers
      .filter((renderer) => !renderer.hidden && renderer.getAttribute("aria-hidden") !== "true")
      .sort((a, b) => visibleArea(b) - visibleArea(a))[0] || null;
  }

  function normalizeHandle(value) {
    const match = String(value || "").match(/(?:^|\/)(@[A-Za-z0-9._-]+)/);
    return match ? match[1].toLowerCase() : "";
  }

  function creatorHandle(renderer) {
    const link = renderer?.querySelector("a[href^='/@']");
    return normalizeHandle(link?.getAttribute("href") || link?.textContent);
  }

  function findActionBar(renderer) {
    if (!renderer) return null;

    const knownSelectors = [
      "ytd-reel-player-overlay-renderer-cow reel-action-bar-view-model",
      "ytd-reel-player-overlay-renderer-cow .ytReelPlayerOverlayViewModelActionsContainer",
      "yt-reel-player-overlay-view-model reel-action-bar-view-model",
      "yt-reel-player-overlay-view-model .ytReelPlayerOverlayViewModelActionsContainer",
      "reel-action-bar-view-model",
      ".ytReelPlayerOverlayViewModelActionsContainer",
      "ytd-reel-player-overlay-renderer #actions",
      "ytd-reel-player-overlay-renderer #actions-container",
      "ytd-reel-player-overlay-renderer [id='actions']",
      "#actions",
      "#actions-container",
      ".action-container",
      "[class*='action-buttons']"
    ];
    for (const selector of knownSelectors) {
      const match = renderer.querySelector(selector);
      if (match) return match;
    }

    // YouTube regularly renames the action bar. Locate it structurally by
    // walking up from the current Like/Share controls inside the Shorts overlay.
    const overlay = renderer.querySelector([
      "ytd-reel-player-overlay-renderer-cow",
      "yt-reel-player-overlay-view-model",
      "ytd-reel-player-overlay-renderer"
    ].join(",")) || renderer;
    const controls = [...overlay.querySelectorAll([
      "button[aria-label*='like' i]",
      "button[aria-label*='share' i]",
      "#like-button",
      "#share-button",
      "ytd-like-button-renderer"
    ].join(","))];

    for (const control of controls) {
      let candidate = control.parentElement;
      for (let depth = 0; candidate && candidate !== overlay && depth < 6; depth += 1) {
        const buttons = candidate.querySelectorAll("button, yt-button-shape");
        const hasLike = candidate.querySelector("button[aria-label*='like' i], #like-button, ytd-like-button-renderer");
        const hasShare = candidate.querySelector("button[aria-label*='share' i], #share-button");
        if (buttons.length >= 2 && (hasLike || hasShare)) return candidate;
        candidate = candidate.parentElement;
      }
    }

    return null;
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${BUTTON_CLASS} {
        align-items: center;
        background: rgba(15, 15, 15, .82);
        border: 1px solid rgba(255, 255, 255, .2);
        border-radius: 50%;
        box-shadow: 0 4px 16px rgba(0, 0, 0, .28);
        color: #fff;
        cursor: pointer;
        display: flex;
        font: 24px/1 system-ui, sans-serif;
        height: 48px;
        justify-content: center;
        margin: 12px auto;
        padding: 0;
        touch-action: manipulation;
        transition: transform .16s ease, background .16s ease;
        width: 48px;
        -webkit-tap-highlight-color: transparent;
      }
      .${BUTTON_CLASS}:hover { background: #d71920; transform: scale(1.08); }
      .${BUTTON_CLASS}:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
      .${BUTTON_CLASS}[data-saving='true'] { opacity: .65; pointer-events: none; }
      .${BUTTON_CLASS}[data-placement='fallback'] {
        margin: 0;
        position: fixed;
        z-index: 2147483646;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function nextShortButton() {
    const selectors = [
      "button[aria-label='Next video']",
      "button[aria-label='Next Short']",
      "#navigation-button-down button",
      "ytd-shorts #navigation-button-down button"
    ];
    return selectors.map((selector) => document.querySelector(selector)).find(Boolean) || null;
  }

  function skipNext() {
    const nextButton = nextShortButton();
    if (nextButton) {
      nextButton.click();
      return;
    }
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowDown",
      code: "ArrowDown",
      keyCode: 40,
      which: 40,
      bubbles: true,
      cancelable: true
    }));
  }

  async function blockAndSkip(renderer, button) {
    const handle = creatorHandle(renderer);
    if (!handle) {
      button.title = "Channel handle not found — try again";
      return;
    }
    button.dataset.saving = "true";
    blockedHandles.add(handle);
    await saveBlockedHandles();
    skipNext();
    setTimeout(() => { button.dataset.saving = "false"; }, 500);
  }

  function createButton(renderer, placement) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.dataset.placement = placement;
    button.textContent = "🚫";
    button.title = "Shadowban Channel";
    button.setAttribute("aria-label", "Shadowban Channel");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void blockAndSkip(renderer, button);
    });
    return button;
  }

  function positionFallback(button, renderer) {
    const player = renderer.querySelector("#player-container, #player, ytd-player, video") || renderer;
    const rect = player.getBoundingClientRect();
    const right = Math.max(12, innerWidth - Math.min(rect.right, innerWidth) + 16);
    const bottom = Math.max(82, innerHeight - Math.min(rect.bottom, innerHeight) + 24);
    button.style.right = `${right}px`;
    button.style.bottom = `${bottom}px`;
  }

  function removeFallback() {
    fallbackButton?.remove();
    fallbackButton = null;
    fallbackRenderer = null;
  }

  function injectButton(renderer) {
    const actionBar = findActionBar(renderer);

    if (actionBar) {
      removeFallback();
      if (!actionBar.querySelector(`.${BUTTON_CLASS}`)) {
        actionBar.appendChild(createButton(renderer, "actions"));
      }
      return;
    }

    if (!fallbackButton || fallbackRenderer !== renderer || !fallbackButton.isConnected) {
      removeFallback();
      fallbackButton = createButton(renderer, "fallback");
      fallbackRenderer = renderer;
      document.body.appendChild(fallbackButton);
    }
    positionFallback(fallbackButton, renderer);
  }

  function skipIfBlocked(renderer) {
    const handle = creatorHandle(renderer);
    const now = Date.now();
    if (!handle || !blockedHandles.has(handle)) return;
    if (handle === lastSkippedHandle && now - lastSkippedAt < 1200) return;
    lastSkippedHandle = handle;
    lastSkippedAt = now;
    skipNext();
  }

  function scan() {
    if (!isShortsPage()) {
      removeFallback();
      return;
    }
    const renderer = activeRenderer();
    if (!renderer) return;
    injectButton(renderer);
    skipIfBlocked(renderer);
  }

  let scanQueued = false;
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      scan();
    });
  }

  async function start() {
    addStyles();
    blockedHandles = new Set((await loadBlockedHandles()).map(normalizeHandle).filter(Boolean));
    new MutationObserver(queueScan).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "hidden", "class"]
    });
    addEventListener("scroll", queueScan, { passive: true, capture: true });
    addEventListener("yt-navigate-finish", queueScan);
    document.addEventListener("visibilitychange", queueScan);
    setInterval(scan, 1500);
    scan();
  }

  void start();
})();
