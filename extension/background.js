/**
 * Word Count Extension — Background Service Worker
 *
 * Single source of truth for session, settings, history and prompt state.
 * Everything lives in chrome.storage.local so:
 *   - the popup can close and reopen without losing anything
 *   - the on-screen counter (content script) reads the same data
 *   - the dashboard tab reads the same data
 *
 * STORAGE KEYS
 *   wc_state     — active session buffers + last completed result
 *   wc_settings  — user preferences (paste mode, plan, language, goal…)
 *   wc_history   — completed sessions, newest first, capped at HISTORY_MAX
 *   wc_prompt    — today's prompt state so it stays consistent for a day
 */

importScripts('shared/wordcount.js');
importScripts('shared/history.js');
importScripts('shared/dates.js');
importScripts('shared/prompts.js');
importScripts('shared/ai-profile.js');
importScripts('shared/api-client.js');
importScripts('shared/memory-queue.js');

const STATE_KEY    = 'wc_state';
const SETTINGS_KEY = 'wc_settings';
const HISTORY_KEY  = 'wc_history';
const PROMPT_KEY   = 'wc_prompt';
const ACCOUNT_KEY  = 'wc_account';

const HISTORY_MAX        = 500;   // rich enough to power yearly aggregates
const PROMPT_HISTORY_MAX = 12;    // avoid immediate repetition

const DEFAULT_STATE = {
  active: false,
  startedAt: null,
  endedAt: null,
  typedText: '',
  pastedText: '',
  typedWords: 0,
  pastedWords: 0,
  sessionGoal: 0,     // snapshotted at start for pro users; 0 = no goal
  lastResult: null,
};

const DEFAULT_SETTINGS = {
  // First-run
  langChosen: false,          // first-launch language screen completed
  proOnboarded: false,        // pro walkthrough completed at least once
  // Floating counter
  counterPos: null,
  counterHidden: false,
  // Localization
  language: null,             // null → auto-detect from navigator
  // Subscription (demo)
  plan: 'free',               // 'free' | 'pro'
  // Pro profile
  profile: {
    name: '',
    email: '',
    timezone: null,           // set on onboarding, kept in profile
    createdAt: null,
  },
  wordGoal: 250,
  themes: ['personal-experiences', 'memories', 'gratitude', 'ideas', 'everyday-life'],
  // Optional AI onboarding draft. Local-only until the user explicitly syncs
  // after Supabase Auth is connected in a later phase.
  aiProfileDraft: self.WCAIProfile.createDraft(),
  aiMemoryPreference: 'ask',  // 'ask' | 'always'
  aiMemoryLastHandledSession: null,
  aiSuggestionMode: 'new_topic',
};

const DEFAULT_PROMPT = {
  dateKey: null,   // 'YYYY-MM-DD' local
  language: null,
  promptId: null,
  text: null,
  theme: null,
  history: [],     // recent prompt ids to avoid repetition
};

const DEFAULT_ACCOUNT = {
  authenticated: false,
  userId: null,
  email: null,
  plan: null,
  aiAccess: false,
  online: true,
  profileSyncEnabled: false,
  profileSyncedAt: null,
};

// ---------- storage helpers ----------

async function getState()   { const { [STATE_KEY]: s }    = await chrome.storage.local.get(STATE_KEY);    return { ...DEFAULT_STATE, ...(s || {}) }; }
async function getSettings(){
  const { [SETTINGS_KEY]: s } = await chrome.storage.local.get(SETTINGS_KEY);
  const account = await getAccount();
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(s || {}),
    profile: { ...DEFAULT_SETTINGS.profile, ...((s && s.profile) || {}) },
    aiProfileDraft: self.WCAIProfile.sanitizeDraft((s && s.aiProfileDraft) || {}),
  };
  // Plan is a cache of a server-verified entitlement, never a user setting.
  merged.plan = account.authenticated && account.aiAccess === true ? 'pro' : 'free';
  if (merged.aiProfileOwnerId && merged.aiProfileOwnerId !== account.userId) {
    merged.aiProfileDraft = self.WCAIProfile.createDraft();
    merged.themes = [...DEFAULT_SETTINGS.themes];
  }
  // Purge the removed "copied/pasted text" setting so no obsolete value lingers.
  delete merged.pasteMode;
  delete merged.onboarded;
  return merged;
}
async function getHistory() { const { [HISTORY_KEY]: h }  = await chrome.storage.local.get(HISTORY_KEY);  return Array.isArray(h) ? h : []; }
async function getPrompt()  { const { [PROMPT_KEY]: p }   = await chrome.storage.local.get(PROMPT_KEY);   return { ...DEFAULT_PROMPT, ...(p || {}) }; }
async function getAccount() { const { [ACCOUNT_KEY]: a } = await chrome.storage.local.get(ACCOUNT_KEY); return { ...DEFAULT_ACCOUNT, ...(a || {}) }; }

async function setState(next) {
  // typedWords / pastedWords are the authoritative session counters. They are
  // reconciled against the real editor text by the content script (see
  // classifyDelta) and accumulated here, so we simply persist clamped ints.
  const withDerived = {
    ...next,
    typedWords: Math.max(0, Math.floor(Number(next.typedWords) || 0)),
    pastedWords: Math.max(0, Math.floor(Number(next.pastedWords) || 0)),
  };
  await chrome.storage.local.set({ [STATE_KEY]: withDerived });
  broadcastState(withDerived).catch(() => {});
}
async function setSettings(next) {
  const { [SETTINGS_KEY]: old } = await chrome.storage.local.get(SETTINGS_KEY);
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  if (old && JSON.stringify(old.themes) !== JSON.stringify(next.themes)) {
    const prompt = await getPrompt();
    await setPrompt({ ...prompt, dateKey: null, promptId: null, text: null });
  }
}
async function setPrompt(next)   { await chrome.storage.local.set({ [PROMPT_KEY]: next });   }
async function setAccount(next) {
  const previous = await getAccount();
  if (previous.userId && previous.userId !== next.userId) {
    const { [SETTINGS_KEY]: stored } = await chrome.storage.local.get(SETTINGS_KEY);
    await setSettings({ ...(stored || {}), aiProfileDraft: self.WCAIProfile.createDraft(), aiProfileOwnerId: next.userId || null, themes: [...DEFAULT_SETTINGS.themes] });
    next = { ...next, profileSyncEnabled: false, profileSyncedAt: null };
  }
  await chrome.storage.local.set({ [ACCOUNT_KEY]: next });
  if (previous.authenticated !== next.authenticated || previous.aiAccess !== next.aiAccess || previous.userId !== next.userId) {
    await setSettings(await getSettings());
  }
}

// ---------- Supabase account + explicit profile sync ----------

function apiErrorCode(error) {
  if (!error || !error.body) return 'offline';
  const detail = error.body.detail;
  if (error.status === 401 || error.status === 400) return 'invalid_credentials';
  if (detail === 'offline' || error.status === 0) return 'offline';
  return 'request_failed';
}

async function refreshAccount() {
  const current = await getAccount();
  try {
    const user = await self.WCApi.get('/auth/me');
    const next = {
      ...current,
      authenticated: true,
      userId: user.id,
      email: user.email,
      plan: user.plan || null,
      aiAccess: user.ai_access === true,
      online: true,
    };
    await setAccount(next);
    return next;
  } catch (error) {
    if (error.status === 401) {
      const next = { ...DEFAULT_ACCOUNT, online: true };
      await setAccount(next);
      return next;
    }
    return { ...current, online: false };
  }
}

async function authenticateAccount(mode, email, password) {
  const path = mode === 'signup' ? '/auth/signup' : '/auth/login';
  const result = await self.WCApi.post(path, { email, password });
  if (!result.authenticated) {
    const pending = { ...DEFAULT_ACCOUNT, email: result.user && result.user.email, online: true };
    await setAccount(pending);
    return { account: pending, message: result.message };
  }
  const account = {
    ...DEFAULT_ACCOUNT,
    authenticated: true,
    userId: result.user.id,
    email: result.user.email,
    plan: result.user.plan || null,
    aiAccess: result.user.ai_access === true,
    online: true,
  };
  await setAccount(account);
  return { account, message: result.message };
}

async function cacheWritingProfile(cloud, owner) {
  const current = await getAccount();
  if (current.userId !== owner || !current.authenticated || cloud.user_id !== owner) throw new Error('account_changed');
  const settings = await getSettings();
  const profile = self.WCAIProfile.fromApiProfile(cloud, { promptThemes: settings.themes });
  const next = { ...settings, aiProfileDraft: profile, aiProfileOwnerId: owner, themes: profile.promptThemes };
  await setSettings(next);
  return { profile, settings: next, account: current };
}

async function loadWritingProfile(expectedUserId = null) {
  const account = await refreshAccount();
  if (!account.authenticated) throw new Error('auth_required');
  if (expectedUserId && account.userId !== expectedUserId) throw new Error('account_changed');
  const cloud = await self.WCApi.get('/ai/profile');
  return cacheWritingProfile(cloud, account.userId);
}

async function saveWritingProfile(draft, expectedUserId) {
  const account = await refreshAccount();
  if (!account.authenticated) throw new Error('auth_required');
  if (expectedUserId !== account.userId) throw new Error('account_changed');
  const body = self.WCAIProfile.toApiProfile(draft);
  if (!account.aiAccess) delete body.ai_preferences.prompt_themes;
  const cloud = await self.WCApi.put('/ai/profile', { ...body, expected_user_id: account.userId });
  const result = await cacheWritingProfile(cloud, account.userId);
  const nextAccount = { ...result.account, profileSyncEnabled: true, profileSyncedAt: Date.now() };
  await setAccount(nextAccount);
  return { ...result, account: nextAccount };
}

async function syncAIProfileDraft() {
  const [settings, account] = await Promise.all([getSettings(), refreshAccount()]);
  if (!account.authenticated) throw new Error('auth_required');
  if (settings.aiProfileOwnerId && settings.aiProfileOwnerId !== account.userId) throw new Error('account_changed');
  return saveWritingProfile({ ...settings.aiProfileDraft, promptThemes: settings.themes }, account.userId);
}

async function maybeAutoSyncProfile(profile) {
  const [account, settings] = await Promise.all([getAccount(), getSettings()]);
  if (!account.authenticated || !account.profileSyncEnabled || settings.aiProfileOwnerId !== account.userId) return profile;
  try { return (await saveWritingProfile({ ...profile, promptThemes: settings.themes }, account.userId)).profile; }
  catch (_error) { return { ...profile, syncStatus: 'pending' }; }
}

let changingPlan = false;
async function requestPlanChange(msg) {
  const account = await refreshAccount();
  if (!account.authenticated) return { ok: false, error: 'auth_required', account };
  if (account.userId !== msg.expectedUserId) return { ok: false, error: 'account_changed', account };
  if (msg.confirmed !== true) return { ok: false, error: 'confirmation_required' };
  if (changingPlan) return { ok: false, error: 'request_in_progress' };
  changingPlan = true;
  try {
    await self.WCApi.post('/subscription/change', { target_plan: msg.targetPlan, confirmed: true, expected_user_id: account.userId });
    return { ok: true, account: await refreshAccount() };
  } catch (error) { return { ok: false, error: typeof error.body?.detail === 'string' ? error.body.detail : 'request_failed' }; }
  finally { changingPlan = false; }
}

async function captureActiveEditor(preferredTabId = null) {
  let tabId = preferredTabId;
  if (!tabId) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tabs && tabs[0] && tabs[0].id;
  }
  if (!tabId) throw new Error('no_editor');
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_ACTIVE_EDITOR' }, (response) => {
      if (chrome.runtime.lastError) { reject(new Error('no_editor')); return; }
      if (!response || !response.ok) { reject(new Error(response?.error || 'no_editor')); return; }
      resolve(response.text);
    });
  });
}

async function syncQueueEntry(entry) {
  const payload = await self.WCMemoryQueue.readPayload(entry);
  const saved = await self.WCApi.post('/ai/writing-sessions', payload);
  await self.WCMemoryQueue.markSynced(entry.id, saved.id);
  return saved;
}

async function syncOwnedMemoryQueue(account) {
  if (!account.authenticated || !account.aiAccess) throw new Error('ai_access_required');
  const pending = await self.WCMemoryQueue.pendingForOwner(account.userId);
  let synced = 0;
  for (const entry of pending) {
    try { await syncQueueEntry(entry); synced++; }
    catch (error) {
      if (error.status === 401 || error.status === 403) throw error;
      break; // Preserve this and later ciphertext entries for a future retry.
    }
  }
  return { synced, status: await self.WCMemoryQueue.status(account.userId) };
}

async function captureAndQueueMemory(lastResult, preferredTabId = null) {
  if (!lastResult || !lastResult.startedAt) throw new Error('no_session');
  const text = await captureActiveEditor(preferredTabId);
  if (text.length > self.WCMemoryQueue.MAX_CHARS) throw new Error('writing_too_large');
  const account = await getAccount();
  const payload = {
    existing_session_ref: String(lastResult.startedAt),
    word_count: (lastResult.typedWords || 0) + (lastResult.pastedWords || 0),
    writing_duration_seconds: Math.max(0, Math.floor(((lastResult.endedAt || 0) - (lastResult.startedAt || 0)) / 1000)),
    content: text,
    save_to_memory: true,
  };
  const entry = await self.WCMemoryQueue.enqueue(payload, account.authenticated ? account.userId : null);
  const settings = await getSettings();
  await setSettings({ ...settings, aiMemoryLastHandledSession: lastResult.startedAt });
  let saveStatus = 'queued';
  if (account.authenticated && account.aiAccess && account.online) {
    try { await syncQueueEntry(entry); saveStatus = 'synced'; }
    catch (_error) { saveStatus = 'queued'; }
  }
  return {
    saveStatus,
    queue: await self.WCMemoryQueue.status(account.authenticated ? account.userId : null),
    settings: await getSettings(),
  };
}

// ---------- word counting ----------
// Tokenization + session math live in shared/wordcount.js (imported above),
// so the content script, service worker and tests share identical rules.
// Counting happens in the content script (which sees the real editor text);
// the service worker only accumulates the resulting typed/pasted deltas.

// ---------- date helpers (respect user timezone if provided, else local) ----------

function dayKey(ts, tz) {
  const d = new Date(ts);
  try {
    if (tz) {
      // en-CA formats as YYYY-MM-DD reliably.
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(d);
    }
  } catch (_) { /* fall through */ }
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function requestAISuggestion({ currentWriting = '', currentProject = '', mode = 'new_topic', language = 'en', ideaSourceId = null, expectedUserId = null } = {}) {
  const account = await refreshAccount();
  if (expectedUserId && account.userId !== expectedUserId) {
    return { ok: false, reason: 'account_changed', account };
  }
  if (!account.authenticated || !account.aiAccess || !account.online) {
    const reason = !account.authenticated
      ? 'auth_required'
      : (!account.aiAccess ? 'plan_required' : 'offline');
    return { ok: false, reason, account };
  }
  const payload = { mode, language };
  if (ideaSourceId) payload.idea_source_id = ideaSourceId;
  const draft = (currentWriting || '').trim().slice(0, 20000);
  if (draft) payload.current_writing = draft;
  const project = (currentProject || '').trim().slice(0, 2000);
  if (project) payload.current_project = project;
  try {
    const suggestion = await self.WCApi.post('/ai/suggestion', payload, { timeout: 60000 });
    return { ok: true, suggestion, account };
  } catch (error) {
    const status = error && error.status;
    if (status === 401 || status === 403) {
      return { ok: false, reason: status === 401 ? 'auth_required' : 'plan_required', account: await refreshAccount() };
    }
    if (status === 429) return { ok: false, reason: 'rate_limited' };
    if (status === 422) return { ok: false, reason: 'idea_required' };
    return { ok: false, reason: status === 0 ? 'offline' : 'request_failed' };
  }
}

// ---------- session lifecycle ----------

async function startSession(idea = null) {
  const settings = await getSettings();
  const next = {
    ...DEFAULT_STATE,
    active: true,
    startedAt: Date.now(),
    sessionGoal: settings.plan === 'pro' ? Math.max(0, Number(settings.wordGoal) || 0) : 0,
    idea: idea ? { id: idea.id, title: idea.title, suggestion: idea.suggestion, mode: idea.mode, questions: idea.questions } : null,
  };
  await setState(next);
  return next;
}

async function stopSession() {
  const state = await getState();
  if (!state.active) return state;
  const endedAt = Date.now();
  const settings = await getSettings();
  const typedWords  = state.typedWords || 0;
  const pastedWords = state.pastedWords || 0;
  const goal = state.sessionGoal || 0;
  const lastResult = {
    startedAt: state.startedAt,
    endedAt,
    typedWords,
    pastedWords,
    sessionGoal: goal,                       // historical goal snapshot
    goalReached: goal > 0 ? typedWords >= goal : false,
    timezone: settings.profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    idea: state.idea || null,
  };
  const next = { ...state, active: false, endedAt, lastResult };
  await setState(next);
  await appendHistory(lastResult);
  return next;
}

async function appendHistory(session) {
  const history = await getHistory();
  const words = (session.typedWords || 0) + (session.pastedWords || 0);
  const duration = Math.max(0, (session.endedAt || 0) - (session.startedAt || 0));
  if (words === 0 && duration < 1000) return history;
  const next = [{ id: session.startedAt || Date.now(), ...session }, ...history].slice(0, HISTORY_MAX);
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
  return next;
}

async function clearHistory() { await chrome.storage.local.set({ [HISTORY_KEY]: [] }); }

async function applyDelta(delta) {
  const state = await getState();
  if (!state.active) return;
  const { typedWords, pastedWords } = self.WCWordCount.applyDelta(state, delta || {});
  await setState({ ...state, typedWords, pastedWords });
}

// ---------- prompt ----------

async function getOrCreateTodaysPrompt() {
  const settings = await getSettings();
  const stored = await getPrompt();
  const tz = settings.profile.timezone;
  const today = dayKey(Date.now(), tz);
  const lang = settings.language === 'es' ? 'es' : 'en';

  if (
    stored.dateKey === today &&
    stored.language === lang &&
    stored.promptId
  ) {
    return stored;
  }

  const pick = self.WCPrompts.pickPrompt(settings.themes, lang, stored.history || []);
  if (!pick) return stored;
  const nextHistory = [pick.id, ...(stored.history || [])].slice(0, PROMPT_HISTORY_MAX);
  const next = {
    dateKey: today,
    language: lang,
    promptId: pick.id,
    text: pick.text,
    theme: pick.theme,
    history: nextHistory,
  };
  await setPrompt(next);
  return next;
}

async function requestAnotherPrompt() {
  const settings = await getSettings();
  const stored = await getPrompt();
  const tz = settings.profile.timezone;
  const today = dayKey(Date.now(), tz);
  const lang = settings.language === 'es' ? 'es' : 'en';

  // Exclude the current prompt id, then the recent history.
  const skip = [stored.promptId, ...(stored.history || [])].filter(Boolean);
  const pick = self.WCPrompts.pickPrompt(settings.themes, lang, skip);
  if (!pick) return stored;
  const nextHistory = [pick.id, ...(stored.history || [])].slice(0, PROMPT_HISTORY_MAX);
  const next = {
    dateKey: today,
    language: lang,
    promptId: pick.id,
    text: pick.text,
    theme: pick.theme,
    history: nextHistory,
  };
  await setPrompt(next);
  return next;
}

// ---------- aggregation for dashboard ----------

/**
 * Return aggregated stats for the given range.
 * range: 'today' | 'week' | 'month' | 'year' | 'all'
 * Returns:
 *   {
 *     range,
 *     totalWords, sessionCount, longestSessionWords,
 *     buckets: [ { key, label, words, sessions } ]  // for chart display
 *     sessions: [ ... recent for this range ... ]
 *   }
 */
async function getStats(range) {
  const history = await getHistory();
  const settings = await getSettings();
  const tz = settings.profile.timezone;
  const now = Date.now();

  const withWords = history.map((s) => ({
    ...s,
    _words: self.WCHistory.sessionWords(s),   // typed only; pasted never counts
    _duration: Math.max(0, (s.endedAt || 0) - (s.startedAt || 0)),
    _dayKey: dayKey(s.startedAt, tz),
  }));

  const { start, end } = rangeBounds(range, now, tz);
  const inRange = withWords.filter((s) => s.startedAt >= start && s.startedAt < end);

  const totalWords    = inRange.reduce((sum, s) => sum + s._words, 0);
  const sessionCount  = inRange.length;
  const longestSessionWords = inRange.reduce((m, s) => Math.max(m, s._words), 0);

  const buckets = buildBuckets(range, start, end, inRange, tz);

  return {
    range,
    start, end,
    totalWords,
    sessionCount,
    longestSessionWords,
    buckets,
    sessions: inRange.slice(0, 100),
  };
}

function rangeBounds(range, now, tz) {
  return self.WCDates.rangeBounds(range, now, tz);
}

function buildBuckets(range, start, end, sessions, tz) {
  const pad = (n) => String(n).padStart(2, '0');
  const perDay = (ts) => dayKey(ts, tz);

  if (range === 'today') {
    // Single bucket
    const words = sessions.reduce((s, x) => s + x._words, 0);
    return [{ key: perDay(start), label: perDay(start), words, sessions: sessions.length }];
  }
  if (range === 'week' || range === 'month') {
    return self.WCDates.dayKeysForRange(start, end, tz).map(key => {
      const date = new Date(`${key}T00:00:00Z`);
      const list = sessions.filter(session => session._dayKey === key);
      return { key, label: range === 'week' ? key : String(date.getUTCDate()),
        dow: (date.getUTCDay() + 6) % 7, dayOfMonth: date.getUTCDate(),
        words: list.reduce((sum, session) => sum + session._words, 0), sessions: list.length };
    });
  }
  if (range === 'year') {
    const buckets = [];
    for (let m = 0; m < 12; m++) {
      const monthKey = `${perDay(start).slice(0, 4)}-${pad(m + 1)}`;
      const list = sessions.filter(session => session._dayKey.startsWith(monthKey));
      buckets.push({
        key: monthKey,
        label: monthKey,
        month: m,
        words: list.reduce((sum, s) => sum + s._words, 0),
        sessions: list.length,
      });
    }
    return buckets;
  }
  // all — bucket by month for chart
  const monthSet = new Map();
  sessions.forEach((s) => {
    const key = perDay(s.startedAt).slice(0, 7);
    if (!monthSet.has(key)) monthSet.set(key, { key, label: key, words: 0, sessions: 0 });
    const b = monthSet.get(key);
    b.words += s._words;
    b.sessions += 1;
  });
  return Array.from(monthSet.values()).sort((a, b) => a.key.localeCompare(b.key));
}

// ---------- broadcast ----------

async function broadcastState(state) {
  const settings = await getSettings();
  const payload = buildPopupPayload(state, settings);
  try { await chrome.runtime.sendMessage({ type: 'STATE_UPDATE', payload }); }
  catch (_e) { /* no listener */ }
}

function buildPopupPayload(state, settings) {
  const typedWords  = state.typedWords || 0;
  const pastedWords = state.pastedWords || 0;
  return {
    idea: state.idea || null,
    active: state.active,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    typedWords,
    pastedWords,
    totalWords: typedWords + pastedWords,
    sessionGoal: state.sessionGoal || 0,
    langChosen: settings.langChosen,
    proOnboarded: settings.proOnboarded,
    plan: settings.plan || 'free',
    language: settings.language,
    lastResult: state.lastResult,
  };
}

// ---------- message router ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case 'GET_STATE': {
          const state = await getState();
          const settings = await getSettings();
          sendResponse({ ok: true, payload: buildPopupPayload(state, settings) });
          return;
        }
        case 'GET_ALL': {
          const account = await refreshAccount();
          const [state, settings, history, prompt] = await Promise.all([
            getState(), getSettings(), getHistory(), getPrompt(),
          ]);
          sendResponse({ ok: true,
            payload: buildPopupPayload(state, settings),
            settings, history, prompt, account,
          });
          return;
        }
        case 'START_SESSION': {
          let idea = null;
          if (msg.suggestionId) {
            try { idea = await self.WCApi.post(`/ai/suggestions/${encodeURIComponent(msg.suggestionId)}/use`, {}); }
            catch (error) { sendResponse({ ok: false, error: apiErrorCode(error) }); return; }
          }
          const state = await startSession(idea);
          const settings = await getSettings();
          sendResponse({ ok: true, payload: buildPopupPayload(state, settings) });
          return;
        }
        case 'STOP_SESSION': {
          const state = await stopSession();
          let settings = await getSettings();
          let memory = null;
          const account = await getAccount();
          if (
            settings.aiMemoryPreference === 'always' &&
            account.authenticated && account.aiAccess &&
            state.lastResult?.startedAt !== settings.aiMemoryLastHandledSession
          ) {
            try { memory = await captureAndQueueMemory(state.lastResult, sender.tab && sender.tab.id); }
            catch (error) { memory = { saveStatus: 'error', error: error.message }; }
            settings = await getSettings();
          }
          sendResponse({ ok: true, payload: buildPopupPayload(state, settings), settings, memory });
          return;
        }
        case 'DELTA': {
          await applyDelta(msg.delta || {});
          sendResponse({ ok: true });
          return;
        }
        case 'GET_SETTINGS': {
          sendResponse({ ok: true, settings: await getSettings() });
          return;
        }
        case 'SET_SETTINGS': {
          const current = await getSettings();
          // Deep-merge nested profile records; the rest is a shallow overlay.
          const patch = { ...(msg.settings || {}) };
          delete patch.plan;
          delete patch.aiProfileOwnerId;
          const nextProfile = patch.profile
            ? { ...current.profile, ...patch.profile }
            : current.profile;
          const nextAIProfile = patch.aiProfileDraft
            ? self.WCAIProfile.sanitizeDraft({ ...current.aiProfileDraft, ...patch.aiProfileDraft }, Date.now())
            : current.aiProfileDraft;
          const next = { ...current, ...patch, profile: nextProfile, aiProfileDraft: nextAIProfile };
          await setSettings(next);
          if (patch.aiProfileDraft) next.aiProfileDraft = await maybeAutoSyncProfile(next.aiProfileDraft);
          const state = await getState();
          broadcastState(state).catch(() => {});
          sendResponse({ ok: true, settings: next });
          return;
        }
        case 'LOAD_MY_PROFILE':
        case 'SAVE_MY_PROFILE': {
          try {
            const result = msg.type === 'LOAD_MY_PROFILE' ? await loadWritingProfile(msg.expectedUserId) : await saveWritingProfile(msg.profile, msg.expectedUserId);
            sendResponse({ ok: true, ...result });
          } catch (error) { sendResponse({ ok: false, error: ['auth_required','account_changed'].includes(error.message) ? error.message : apiErrorCode(error) }); }
          return;
        }
        case 'CHANGE_PLAN': {
          sendResponse(await requestPlanChange(msg)); return;
        }
        case 'GET_AI_PROFILE_DRAFT': {
          const settings = await getSettings();
          sendResponse({ ok: true, profile: settings.aiProfileDraft });
          return;
        }
        case 'SET_AI_PROFILE_DRAFT': {
          const settings = await getSettings();
          const profile = self.WCAIProfile.sanitizeDraft(
            { ...settings.aiProfileDraft, ...(msg.profile || {}) },
            Date.now(),
          );
          const next = { ...settings, aiProfileDraft: profile };
          await setSettings(next);
          const synced = await maybeAutoSyncProfile(profile);
          sendResponse({ ok: true, profile: synced });
          return;
        }
        case 'GET_ACCOUNT': {
          const account = msg.refresh === false ? await getAccount() : await refreshAccount();
          sendResponse({ ok: true, account });
          return;
        }
        case 'ACCOUNT_SECURITY': {
          const routes = { status: '/auth/security', email: '/auth/email/change', resend: '/auth/email/resend', password: '/auth/password/change', recovery: '/auth/recovery' };
          try {
            if (!routes[msg.action]) throw new Error('invalid_action');
            let body = msg.body || {};
            if (!['status', 'recovery'].includes(msg.action)) {
              const owner = await refreshAccount();
              if (!owner.authenticated || owner.userId !== msg.expectedUserId) throw new Error('account_changed');
              body = { ...body, expected_user_id: owner.userId };
            }
            const result = msg.action === 'status' ? await self.WCApi.get(routes.status) : await self.WCApi.post(routes[msg.action], body);
            sendResponse({ ok: true, result });
          } catch (error) {
            const detail = error.body && error.body.detail;
            sendResponse({ ok: false, error: typeof detail === 'string' ? detail : error.message === 'account_changed' ? 'account_changed' : 'security_provider_failed' });
          }
          return;
        }
        case 'AUTH_ACCOUNT': {
          try {
            const result = await authenticateAccount(msg.mode, msg.email, msg.password);
            sendResponse({ ok: true, ...result });
          } catch (error) {
            sendResponse({ ok: false, error: apiErrorCode(error) });
          }
          return;
        }
        case 'LOGOUT_ACCOUNT': {
          try { await self.WCApi.post('/auth/logout'); } catch (_error) { /* clear local metadata regardless */ }
          await setAccount({ ...DEFAULT_ACCOUNT, online: true });
          sendResponse({ ok: true, account: { ...DEFAULT_ACCOUNT, online: true } });
          return;
        }
        case 'SYNC_AI_PROFILE': {
          try {
            const result = await syncAIProfileDraft(msg.enableAutoSync !== false);
            sendResponse({ ok: true, ...result });
          } catch (error) {
            sendResponse({ ok: false, error: error.message === 'auth_required' ? 'auth_required' : apiErrorCode(error) });
          }
          return;
        }
        case 'SAVE_SESSION_TO_AI_MEMORY': {
          try {
            const state = await getState();
            if (msg.always === true) {
              const settings = await getSettings();
              await setSettings({ ...settings, aiMemoryPreference: 'always' });
            }
            const result = await captureAndQueueMemory(state.lastResult, sender.tab && sender.tab.id);
            sendResponse({ ok: true, ...result });
          } catch (error) {
            sendResponse({ ok: false, error: error.message || 'memory_save_failed' });
          }
          return;
        }
        case 'DISMISS_AI_MEMORY': {
          const state = await getState();
          const settings = await getSettings();
          const next = { ...settings, aiMemoryLastHandledSession: state.lastResult?.startedAt || null };
          await setSettings(next);
          sendResponse({ ok: true, settings: next });
          return;
        }
        case 'SET_AI_MEMORY_PREFERENCE': {
          const settings = await getSettings();
          const next = { ...settings, aiMemoryPreference: msg.preference === 'always' ? 'always' : 'ask' };
          await setSettings(next);
          sendResponse({ ok: true, settings: next });
          return;
        }
        case 'GET_MEMORY_QUEUE_STATUS': {
          const account = await getAccount();
          sendResponse({ ok: true, queue: await self.WCMemoryQueue.status(account.authenticated ? account.userId : null) });
          return;
        }
        case 'CLAIM_MEMORY_QUEUE': {
          try {
            const account = await refreshAccount();
            if (!account.authenticated || !account.aiAccess) throw new Error('ai_access_required');
            const claimed = await self.WCMemoryQueue.claimUnowned(account.userId);
            const result = await syncOwnedMemoryQueue(account);
            sendResponse({ ok: true, claimed, ...result });
          } catch (error) {
            sendResponse({ ok: false, error: error.message || apiErrorCode(error) });
          }
          return;
        }
        case 'SYNC_MEMORY_QUEUE': {
          try {
            const account = await refreshAccount();
            const result = await syncOwnedMemoryQueue(account);
            sendResponse({ ok: true, ...result });
          } catch (error) {
            sendResponse({ ok: false, error: error.message || apiErrorCode(error) });
          }
          return;
        }
        case 'DELETE_SYNCED_MEMORY_QUEUE': {
          const account = await getAccount();
          if (!account.authenticated) { sendResponse({ ok: false, error: 'auth_required' }); return; }
          const removed = await self.WCMemoryQueue.removeSynced(account.userId);
          sendResponse({ ok: true, removed, queue: await self.WCMemoryQueue.status(account.userId) });
          return;
        }
        case 'IS_ACTIVE': {
          const state = await getState();
          sendResponse({ ok: true, active: state.active });
          return;
        }
        case 'GET_HISTORY': {
          const [full, settings] = await Promise.all([getHistory(), getSettings()]);
          const plan = settings.plan || 'free';
          const now = Date.now();
          const visible = self.WCHistory.visibleHistory(full, plan, now);
          sendResponse({
            ok: true,
            history: visible,
            plan,
            totalCount: full.length,
            hasMore: visible.length < full.length,
          });
          return;
        }
        case 'GET_STREAK': {
          const [full, settings] = await Promise.all([getHistory(), getSettings()]);
          const streak = self.WCHistory.computeStreak(full, settings.profile.timezone, Date.now());
          sendResponse({ ok: true, streak });
          return;
        }
        case 'EXPORT_HISTORY': {
          const [full, settings] = await Promise.all([getHistory(), getSettings()]);
          if ((settings.plan || 'free') !== 'pro') { sendResponse({ ok: false, error: 'pro_only' }); return; }
          sendResponse({ ok: true, csv: self.WCHistory.toCSV(full), count: full.length });
          return;
        }
        case 'IMPORT_HISTORY': {
          const settings = await getSettings();
          if ((settings.plan || 'free') !== 'pro') { sendResponse({ ok: false, error: 'pro_only' }); return; }
          const records = Array.isArray(msg.records) ? msg.records : [];
          const mode = msg.mode === 'replace' ? 'replace' : 'merge';
          const existing = await getHistory();
          const next = mode === 'replace'
            ? records.slice().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
            : self.WCHistory.mergeHistory(existing, records);
          const capped = next.slice(0, HISTORY_MAX);
          await chrome.storage.local.set({ [HISTORY_KEY]: capped });
          sendResponse({ ok: true, history: capped, count: capped.length });
          return;
        }
        case 'CLEAR_HISTORY': {
          await clearHistory();
          sendResponse({ ok: true, history: [] });
          return;
        }
        case 'GET_PROMPT': {
          const prompt = await getOrCreateTodaysPrompt();
          sendResponse({ ok: true, prompt });
          return;
        }
        case 'GET_AI_SUGGESTION': {
          const settings = await getSettings();
          const result = await requestAISuggestion({
            currentWriting: msg.currentWriting || '',
            currentProject: msg.currentProject || '',
            mode: msg.mode || 'new_topic', language: msg.language || settings.language || 'en', ideaSourceId: msg.ideaSourceId || null,
            expectedUserId: msg.expectedUserId || null,
          });
          sendResponse(result);
          return;
        }
        case 'GET_ACTIVE_WRITING': {
          try { sendResponse({ ok: true, text: (await captureActiveEditor()).slice(0, 20000) }); }
          catch (_error) { sendResponse({ ok: false, error: 'no_editor' }); }
          return;
        }
        case 'GET_AI_IDEAS': {
          try {
            const [ideas, options] = await Promise.all([self.WCApi.get('/ai/ideas'), self.WCApi.get('/ai/idea-options')]);
            sendResponse({ ok: true, ideas, options });
          } catch (error) { sendResponse({ ok: false, error: apiErrorCode(error) }); }
          return;
        }
        case 'SAVE_AI_IDEA': {
          try {
            const idea = await self.WCApi.put(`/ai/suggestions/${encodeURIComponent(msg.suggestionId)}/save`, {});
            sendResponse({ ok: true, idea });
          } catch (error) { sendResponse({ ok: false, error: apiErrorCode(error) }); }
          return;
        }
        case 'SEND_AI_FEEDBACK': {
          try {
            const body = { suggestion_id: msg.suggestionId, helpful: !!msg.helpful };
            if (msg.reason) body.reason = msg.reason;
            if (msg.note) body.note = String(msg.note).slice(0, 2000);
            const feedback = await self.WCApi.post('/ai/feedback', body);
            sendResponse({ ok: true, feedback });
          } catch (error) {
            sendResponse({ ok: false, error: apiErrorCode(error) });
          }
          return;
        }
        case 'ANOTHER_PROMPT': {
          const prompt = await requestAnotherPrompt();
          sendResponse({ ok: true, prompt });
          return;
        }
        case 'GET_STATS': {
          const stats = await getStats(msg.range || 'today');
          sendResponse({ ok: true, stats });
          return;
        }
        case 'OPEN_DASHBOARD': {
          // Deprecated: Progress now renders inside the popup. Never open a tab.
          sendResponse({ ok: false, error: 'deprecated_in_popup' });
          return;
        }
        default:
          sendResponse({ ok: false, error: 'unknown_message' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  const state    = await getState();
  const settings = await getSettings();
  await chrome.storage.local.set({
    [STATE_KEY]: state,
    [SETTINGS_KEY]: settings,
    [ACCOUNT_KEY]: await getAccount(),
  });
});
