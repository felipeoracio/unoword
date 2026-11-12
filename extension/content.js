/**
 * UnoWord — Content Script
 *
 * Two responsibilities on every allowed page:
 *
 *   1. Typing pipeline
 *      Watches for `input` events on editable targets (<textarea>,
 *      <input> text-like, contenteditable) and sends granular deltas
 *      { kind: 'typed' | 'pasted' | 'deleted', ... } to the background
 *      service worker while a session is active.
 *
 *   2. Floating on-screen counter
 *      Injects a Shadow-DOM overlay that mirrors the session state and
 *      updates live. Draggable, positioned bottom-right by default,
 *      supports click-to-expand with an in-page Stop Session button.
 *      Fully isolated from host-page CSS via Shadow DOM. Never
 *      inserted into the document flow — always position: fixed.
 */

(() => {
  /* GENERATED-MOTION:START */
  const counterMotion = ":host {\n  --uno-motion-feedback: 120ms;\n  --uno-motion-hover: 180ms;\n  --uno-motion-dropdown: 180ms;\n  --uno-motion-panel: 220ms;\n  --uno-motion-dialog: 260ms;\n  --uno-motion-page: 280ms;\n  --uno-motion-sidebar: 260ms;\n  --uno-motion-project: 360ms;\n  --uno-motion-focus: 420ms;\n  --uno-motion-achievement: 650ms;\n  --uno-motion-exit: 140ms;\n  --uno-motion-reveal: 420ms;\n  --uno-motion-stagger: 40ms;\n  --uno-motion-reveal-offset: 16px;\n  --uno-motion-hero-offset: 8px;\n  --uno-motion-hover-offset: 2px;\n  --uno-motion-enter-ease: cubic-bezier(0.16, 1, 0.3, 1);\n  --uno-motion-exit-ease: cubic-bezier(0.4, 0, 1, 1);\n  --uno-motion-state-ease: cubic-bezier(0.4, 0, 0.2, 1);\n  --uno-motion-popup-offset: 4px;\n  --uno-motion-dialog-offset: 6px;\n}\n#row, #stop-btn { transition: color var(--uno-motion-feedback) var(--uno-motion-state-ease), background-color var(--uno-motion-feedback) var(--uno-motion-state-ease); }\n@media(prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; } }";
  /* GENERATED-MOTION:END */
  if (window.__wcContentScriptLoaded) return;
  window.__wcContentScriptLoaded = true;

  // The full-page editor records its own metadata-only activity. Never send
  // ordinary DELTA messages for its canvas (or show a second live counter).
  if (['https://unoword.app', 'https://www.unoword.app', 'https://unoword.vercel.app'].includes(location.origin) && (location.pathname === '/editor' || location.pathname.startsWith('/editor/'))) {
    function localProgress() {
      try {
        chrome.runtime.sendMessage({ type: 'GET_LOCAL_WRITING_PROGRESS' }, response => {
          if (!chrome.runtime.lastError && response?.ok) window.postMessage({ type: 'UNO_WORD_LOCAL_PROGRESS', ...response }, location.origin);
        });
      } catch (_error) { /* extension reloaded */ }
    }
    window.addEventListener('message', event => {
      if (event.source !== window || event.origin !== location.origin) return;
      if (event.data?.type === 'UNO_WORD_REQUEST_LOCAL_PROGRESS') { localProgress(); return; }
      if (event.data?.type !== 'UNO_WORD_ACTIVITY_SAVED') return;
      // Read the verified server records; never trust counts supplied by a page.
      try { chrome.runtime.sendMessage({ type: 'SYNC_EDITOR_ACTIVITY' }, () => { void chrome.runtime.lastError; }); }
      catch (_error) { /* extension reloaded */ }
    });
    try { chrome.storage.onChanged.addListener((changes,area) => {
      if(area!=='local')return;
      if(changes.wc_account) window.postMessage({type:'UNO_WORD_ACCOUNT_CHANGED'},location.origin);
      if(changes.wc_history || changes.wc_account || changes.wc_state)localProgress();
    }); }
    catch (_error) { /* preview */ }
    return;
  }

  // =====================================================================
  // Shared state (cached from chrome.storage; kept fresh via onChanged)
  // =====================================================================

  let sessionState = {
    active: false,
    typedWords: 0,
    pastedWords: 0,
    startedAt: null,
  };
  let settings = {
    pasteMode: 'separate',
    counterPos: null,
  };

  const STATE_KEY = 'wc_state';
  const SETTINGS_KEY = 'wc_settings';

  // ---------------------------------------------------------------------
  // Storage bootstrap + live sync
  // ---------------------------------------------------------------------

  function readInitial() {
    try {
      chrome.storage.local.get([STATE_KEY, SETTINGS_KEY], (data) => {
        if (chrome.runtime.lastError) return;
        if (data?.[STATE_KEY]) sessionState = { ...sessionState, ...data[STATE_KEY] };
        if (data?.[SETTINGS_KEY]) settings = { ...settings, ...data[SETTINGS_KEY] };
        Overlay.syncFromState();
      });
    } catch (_e) { /* extension context invalidated */ }
  }
  readInitial();

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[STATE_KEY]?.newValue) {
        sessionState = { ...sessionState, ...changes[STATE_KEY].newValue };
      }
      if (changes[SETTINGS_KEY]?.newValue) {
        settings = { ...settings, ...changes[SETTINGS_KEY].newValue };
      }
      Overlay.syncFromState();
    });
  } catch (_e) { /* ignore */ }

  // =====================================================================
  // PART 1 · Typing pipeline
  // =====================================================================

  const TEXT_INPUT_TYPES = new Set([
    'text', 'search', 'url', 'tel', 'email', 'password', 'number',
  ]);

  function isEditableTarget(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return !el.disabled && !el.readOnly;
    if (tag === 'INPUT') {
      if (el.disabled || el.readOnly) return false;
      const type = (el.type || 'text').toLowerCase();
      return TEXT_INPUT_TYPES.has(type);
    }
    return false;
  }

  function getElementText(el) {
    if (el.isContentEditable) return el.innerText || '';
    return el.value != null ? String(el.value) : '';
  }

  const prevValues = new WeakMap();
  let lastEditableTarget = null;

  function sendDelta(delta) {
    try {
      chrome.runtime.sendMessage({ type: 'DELTA', delta }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_e) { /* extension context invalidated */ }
  }

  function onFocusIn(e) {
    const t = e.target;
    if (!isEditableTarget(t)) return;
    lastEditableTarget = t;
    if (!prevValues.has(t)) prevValues.set(t, getElementText(t));
  }

  // The word count is reconciled against the *actual* editor text on every
  // `input` event. We diff the previous vs current text at the word level and
  // tag the change using the event's `inputType`:
  //   - paste / drop            → pasted words (never counted as typed)
  //   - anything else that adds → typed words
  //   - anything that removes   → deleted (delete, backspace, cut/deleteByCut)
  //   - undo / redo             → reconciled like any other add/remove, so the
  //                               count always follows the resulting text
  // This is delta-based, not full-document counting: a pure paste adds only to
  // `pasted`, preserving paste protection.
  function onInput(e) {
    const t = e.target;
    if (!isEditableTarget(t)) return;
    lastEditableTarget = t;

    const curr = getElementText(t);

    if (!sessionState.active || sessionState.timer?.status === 'paused') {
      prevValues.set(t, curr);
      return;
    }

    const prev = prevValues.has(t) ? prevValues.get(t) : '';
    prevValues.set(t, curr);

    const engine = window.WCWordCount;
    if (!engine) return;

    const delta = engine.classifyDelta(prev, curr, e.inputType || '');
    if (delta) sendDelta(delta);
  }

  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('input', onInput, true);

  // Writing text is read only after an explicit AI Memory / Expand an Idea
  // choice (or prior Always Save consent), never with normal word deltas.
  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== 'CAPTURE_ACTIVE_EDITOR') return false;
      const target = isEditableTarget(lastEditableTarget) ? lastEditableTarget : document.activeElement;
      const isPassword = target && target.tagName === 'INPUT' && String(target.type || '').toLowerCase() === 'password';
      if (!isEditableTarget(target) || isPassword) {
        sendResponse({ ok: false, error: 'no_editor' });
        return false;
      }
      const text = getElementText(target);
      sendResponse(text.trim() ? { ok: true, text } : { ok: false, error: 'empty_writing' });
      return false;
    });
  } catch (_e) { /* extension context invalidated */ }

  // =====================================================================
  // PART 2 · Floating on-screen counter
  // =====================================================================

  const Overlay = (() => {
    /** @type {HTMLDivElement|null} */ let host = null;
    /** @type {ShadowRoot|null}    */ let root = null;
    /** @type {HTMLElement|null}   */ let card = null;
    /** @type {HTMLElement|null}   */ let numEl = null;
    /** @type {HTMLElement|null}   */ let labelEl = null;
    /** @type {HTMLElement|null}   */ let expandEl = null;
    let expanded = false;
    let dragActive = false;
    let dragMoved = false;
    let dragStart = { x: 0, y: 0, left: 0, top: 0 };

    // margin from viewport edges when using default position
    const EDGE = 20;

    function mount() {
      if (host || !document.body) return;
      host = document.createElement('div');
      host.id = 'wc-floating-host';
      // The host itself has no visual — the shadow root does. We only need
      // it to sit at the very top of the stacking context.
      host.style.all = 'initial';
      host.style.position = 'fixed';
      host.style.zIndex = '2147483647';
      host.style.top = '0';
      host.style.left = '0';
      host.style.width = '0';
      host.style.height = '0';
      host.style.pointerEvents = 'none';
      root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${counterMotion}</style>` + STYLES + HTML;
      card = root.getElementById('card');
      numEl = root.getElementById('num');
      labelEl = root.getElementById('label');
      expandEl = root.getElementById('expand');
      wireEvents();
      document.documentElement.appendChild(host);
    }

    function unmount() {
      if (host && host.parentNode) host.parentNode.removeChild(host);
      host = null; root = null; card = null; numEl = null; labelEl = null;
      expandEl = null; expanded = false; dragActive = false;
    }

    function wireEvents() {
      // Drag on the card body itself. We only start a drag after a small
      // pointer movement so click-to-expand still works.
      card.addEventListener('pointerdown', onPointerDown);
      root.getElementById('stop-btn').addEventListener('click', onStopClicked);
      // Click (without drag) toggles expand
      card.addEventListener('click', (e) => {
        if (dragMoved) { dragMoved = false; return; }
        // Don't toggle when clicking the stop button (it stops propagation)
        toggleExpand();
        e.stopPropagation();
      });
      // The toggle and End button are sibling controls inside a named group.
      card.setAttribute('role', 'group');
      const toggle = root.getElementById('row');
      toggle.setAttribute('aria-controls', 'expand');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleExpand();
        }
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && expanded) {
          e.preventDefault();
          toggleExpand();
          toggle.focus();
        }
      });
    }

    function onStopClicked(e) {
      e.stopPropagation();
      try {
        chrome.runtime.sendMessage({ type: 'STOP_SESSION' }, () => {
          void chrome.runtime.lastError;
        });
      } catch (_e) { /* ignore */ }
    }

    function toggleExpand() {
      expanded = !expanded;
      if (!card) return;
      card.classList.toggle('is-expanded', expanded);
      expandEl.hidden = !expanded;
      root.getElementById('row').setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }

    function onPointerDown(e) {
      // Ignore right-click and clicks on the stop button
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('#stop-btn')) return;
      dragActive = true;
      dragMoved = false;
      const rect = card.getBoundingClientRect();
      dragStart = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
      card.setPointerCapture?.(e.pointerId);
      card.addEventListener('pointermove', onPointerMove);
      card.addEventListener('pointerup', onPointerUp);
      card.addEventListener('pointercancel', onPointerUp);
    }

    function onPointerMove(e) {
      if (!dragActive) return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      if (!dragMoved && Math.hypot(dx, dy) < 4) return; // small threshold
      dragMoved = true;
      const nextLeft = clamp(
        dragStart.left + dx, 4, window.innerWidth  - card.offsetWidth  - 4
      );
      const nextTop  = clamp(
        dragStart.top  + dy, 4, window.innerHeight - card.offsetHeight - 4
      );
      applyPosition({ x: nextLeft, y: nextTop });
    }

    function onPointerUp(e) {
      if (!dragActive) return;
      dragActive = false;
      card.releasePointerCapture?.(e?.pointerId);
      card.removeEventListener('pointermove', onPointerMove);
      card.removeEventListener('pointerup', onPointerUp);
      card.removeEventListener('pointercancel', onPointerUp);
      if (dragMoved) {
        // Persist new position
        const rect = card.getBoundingClientRect();
        try {
          chrome.runtime.sendMessage({
            type: 'SET_SETTINGS',
            settings: { counterPos: { x: rect.left, y: rect.top } },
          }, () => { void chrome.runtime.lastError; });
        } catch (_e) { /* ignore */ }
      }
    }

    function clamp(v, min, max) {
      if (max < min) return min;
      return Math.max(min, Math.min(max, v));
    }

    function applyPosition(pos) {
      if (!card) return;
      if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        card.style.left = `${pos.x}px`;
        card.style.top  = `${pos.y}px`;
        card.style.right = 'auto';
        card.style.bottom = 'auto';
      } else {
        // Default: bottom-right
        card.style.left = 'auto';
        card.style.top  = 'auto';
        card.style.right  = `${EDGE}px`;
        card.style.bottom = `${EDGE}px`;
      }
    }

    function fmt(n) {
      const lang = (window.WCi18n && window.WCi18n.getLang && window.WCi18n.getLang()) === 'es' ? 'es-ES' : 'en-US';
      return Number(n || 0).toLocaleString(lang);
    }

    function tt(key, vars) {
      if (window.WCi18n && window.WCi18n.t) return window.WCi18n.t(key, vars);
      // Fallback English strings if i18n not attached
      const en = {
        'session.word': 'word', 'session.words': 'words',
        'session.wordTyped': 'word typed', 'session.wordsTyped': 'words typed',
        'session.pastedSuffix': `+ ${vars ? vars.n : ''} pasted`,
        'session.goalReached': 'Goal reached',
        'counter.region': 'UnoWord session counter',
        'counter.toggle': `Session: ${vars?.n || ''} ${vars?.words || ''}. Press Enter or Space to expand or collapse.`,
        'counter.drag': 'Drag to move',
      };
      return en[key] || key;
    }

    function computeDisplay() {
      // Only typed words are ever counted/shown; pasted text never appears.
      const typed = sessionState.typedWords || 0;
      const goal = sessionState.sessionGoal || 0;
      const label = typed === 1 ? tt('session.word') : tt('session.words');
      const text = (goal > 0) ? `${fmt(typed)} / ${fmt(goal)}` : fmt(typed);
      return { text, label, secondary: '', reached: goal > 0 && typed >= goal };
    }

    function syncFromState() {
      if (sessionState.active) {
        if (!host) mount();
        if (!host) return;
        applyPosition(settings.counterPos);
        renderCount();
      } else {
        if (host) unmount();
      }
    }

    function renderCount() {
      if (!numEl) return;
      if (window.WCi18n?.setLang) window.WCi18n.setLang(settings.language || window.WCi18n.detectDefault());
      const d = computeDisplay();
      numEl.textContent = d.text;
      if(sessionState.timer?.status==='paused')d.label=(settings.language==='es'?'En pausa':'Paused')+' · '+d.label;
      labelEl.textContent = d.label;
      card.setAttribute('aria-label', tt('counter.region'));
      card.lang = settings.language || 'en';
      card.dataset.paused = String(sessionState.timer?.status === 'paused');
      root.getElementById('row').setAttribute('aria-label', tt('counter.toggle', { n: d.text, words: d.label }));
      root.getElementById('grip').title = tt('counter.drag');
      const secEl = root.getElementById('secondary');
      if (d.secondary) { secEl.textContent = d.secondary; secEl.hidden = false; }
      else             { secEl.hidden = true; }
      const dotEl = root.getElementById('dot');
      if (dotEl) dotEl.classList.toggle('is-reached', !!d.reached);
      // Stop button label (localized)
      const stopEl = root.getElementById('stop-btn');
      if (stopEl) stopEl.textContent = tt('session.stop');
    }

    // Re-apply position if viewport shrinks such that the counter would
    // otherwise be off-screen.
    window.addEventListener('resize', () => {
      if (!host || !card) return;
      const rect = card.getBoundingClientRect();
      const maxLeft = window.innerWidth  - card.offsetWidth  - 4;
      const maxTop  = window.innerHeight - card.offsetHeight - 4;
      if (rect.left > maxLeft || rect.top > maxTop) {
        applyPosition(settings.counterPos ? {
          x: clamp(rect.left, 4, maxLeft),
          y: clamp(rect.top,  4, maxTop),
        } : null);
      }
    }, { passive: true });

    return { syncFromState };
  })();

  // =====================================================================
  // Overlay markup + styles (kept alongside logic for locality)
  // =====================================================================

  const HTML = `
    <div id="card" part="card" data-testid="wc-floating-counter">
      <button id="row" type="button">
        <span id="dot" aria-hidden="true"></span>
        <span id="num" data-testid="wc-floating-number">0</span>
        <span id="label" data-testid="wc-floating-label">words</span>
        <span id="grip" aria-hidden="true" title="Drag to move">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <circle cx="2.5" cy="2.5" r="1" fill="currentColor"/>
            <circle cx="7.5" cy="2.5" r="1" fill="currentColor"/>
            <circle cx="2.5" cy="7.5" r="1" fill="currentColor"/>
            <circle cx="7.5" cy="7.5" r="1" fill="currentColor"/>
          </svg>
        </span>
      </button>
      <div id="secondary" hidden data-testid="wc-floating-secondary"></div>
      <div id="expand" hidden>
        <button id="stop-btn" type="button" data-testid="wc-floating-stop">Stop Session</button>
      </div>
    </div>
  `;

  const STYLES = `
    <style>
      :host,* { box-sizing:border-box; }
      [hidden] { display:none !important; }
      #card {
        --uwc-surface:#fffdfa; --uwc-text:#132d53; --uwc-muted:#52698c;
        --uwc-line:#c5d1e2; --uwc-accent:#0758d4; --uwc-success:#24713d; --uwc-paused:#806119;
        position:fixed; right:20px; bottom:20px; pointer-events:auto;
        display:inline-flex; flex-direction:column; gap:8px; min-width:0;
        max-width:calc(100vw - 8px); padding:9px 12px;
        background:var(--uwc-surface); color:var(--uwc-text);
        border:1px solid var(--uwc-line); border-radius:14px;
        box-shadow:0 4px 20px #102b5526;
        font:13px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
        user-select:none; cursor:grab;
      }
      #card:active { cursor:grabbing; }
      #row {
        appearance:none; display:flex; align-items:center; gap:8px;
        min-width:0; min-height:26px; padding:0; margin:0; border:0;
        background:transparent; color:inherit; font:inherit; text-align:left;
        white-space:nowrap; cursor:inherit; border-radius:5px;
      }
      #dot { width:7px; height:7px; border-radius:50%; flex:none; background:var(--uwc-success); box-shadow:0 0 0 3px color-mix(in srgb,var(--uwc-success) 16%,transparent); }
      #dot.is-reached { background:var(--uwc-accent); box-shadow:0 0 0 3px color-mix(in srgb,var(--uwc-accent) 16%,transparent); }
      #card[data-paused="true"] #dot { background:var(--uwc-paused); box-shadow:0 0 0 3px color-mix(in srgb,var(--uwc-paused) 16%,transparent); }
      #num { color:var(--uwc-text); font-size:14px; font-weight:650; font-variant-numeric:tabular-nums; }
      #label { color:var(--uwc-muted); font-weight:500; white-space:normal; }
      #grip { margin-left:4px; color:var(--uwc-muted); display:inline-flex; align-items:center; flex:none; }
      #secondary { color:var(--uwc-muted); font-size:12px; font-variant-numeric:tabular-nums; padding-left:15px; }
      #expand { padding-top:2px; }
      #stop-btn { appearance:none; width:100%; min-height:40px; padding:8px 12px; border:1px solid #b42332; border-radius:10px; background:#b42332; color:white; font:600 13px/1.5 ui-sans-serif,system-ui,sans-serif; cursor:pointer; }
      #stop-btn:hover { background:#941c29; }
      #row:focus-visible,#stop-btn:focus-visible { outline:3px solid var(--uwc-accent); outline-offset:4px; }
      @media(prefers-color-scheme:dark) {
        #card { --uwc-surface:#17253a; --uwc-text:#f1f4fb; --uwc-muted:#b4c1d4; --uwc-line:#61718b; --uwc-accent:#9ac6ff; --uwc-success:#98d7af; --uwc-paused:#efd48e; box-shadow:0 4px 20px #0006; }
      }
      @media(max-width:320px) { #card { padding:8px 10px; } #row { flex-wrap:wrap; } #num { overflow-wrap:anywhere; white-space:normal; } }
      @media(forced-colors:active) { #card { background:Canvas; color:CanvasText; border-color:CanvasText; } #num,#label,#grip { color:CanvasText; } #row:focus-visible,#stop-btn:focus-visible { outline-color:Highlight; } }
    </style>
  `;

  // Expose for the storage listener (defined earlier by name, so the
  // closure sees the same reference).
  // (Overlay.syncFromState is already used above.)
})();
