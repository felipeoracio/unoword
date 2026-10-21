/* Canonical profile editor; the onboarding questions remain the shared schema. */
const PROFILE_FIELDS = { goal: 'writingGoal', audience: 'audience', projects: 'currentProjects', avoid: 'avoidTopics', style: 'writingStyle', topics: 'primaryTopics', subjects: 'favoriteSubjects', context: 'personalContext' };
let loadedWritingProfile = null;
let profileEditorOwner = null;
let pendingPlanIntent = null;
function clearWritingProfileEditor() {
  loadedWritingProfile = null; profileEditorOwner = null;
  $('writing-profile-form').reset(); $('writing-profile-form').hidden = true;
}
function fillWritingProfile(profile) {
  for (const [suffix, key] of Object.entries(PROFILE_FIELDS)) $('writing-profile-' + suffix).value = profile[key] || '';
  const themes = $('writing-profile-themes'); themes.replaceChildren();
  for (const theme of new Set([...ALL_THEMES, ...(profile.promptThemes || [])])) {
    const label = document.createElement('label'); const input = document.createElement('input');
    input.type = 'checkbox'; input.value = theme; input.checked = (profile.promptThemes || []).includes(theme); input.disabled = !isPro();
    const text = document.createElement('span'); text.textContent = ALL_THEMES.includes(theme) ? t('theme.' + theme) : theme;
    label.append(input, text); themes.append(label);
  }
  $('writing-profile-theme-note').hidden = isPro(); $('writing-profile-onboard').hidden = !isPro();
}
async function loadWritingProfileEditor() {
  const owner = account.userId;
  $('writing-profile-form').hidden = true; $('writing-profile-login').hidden = !!account.authenticated;
  $('writing-profile-status').textContent = t(account.authenticated ? 'profile.loading' : 'profile.signIn');
  if (!account.authenticated) return;
  const result = await sendMessage({ type: 'LOAD_MY_PROFILE', expectedUserId: owner });
  if (owner !== account.userId) return;
  if (!result.ok) { $('writing-profile-status').textContent = t('profile.loadFailed'); return; }
  settings = result.settings; loadedWritingProfile = structuredClone(result.profile); profileEditorOwner = owner;
  fillWritingProfile(loadedWritingProfile); $('writing-profile-form').hidden = false; $('writing-profile-status').textContent = '';
}
function renderPlanStatus() {
  $('plan-current').textContent = account.authenticated ? t('billing.current', { email: account.email || '', plan: isPro() ? 'Pro' : 'Free' }) : t('billing.signIn');
  $('plan-error').textContent = '';
}
async function beginPlanChange(targetPlan) {
  const latest = await sendMessage({ type: 'GET_ACCOUNT' }); if (latest.ok) updateSuggestionAccount(latest.account);
  if (!account.authenticated) {
    pendingPlanIntent = { targetPlan }; await openSettings(); els.accountEditor.hidden = false;
    els.accountError.textContent = t('billing.signIn'); els.accountError.hidden = false; els.accountEmail.focus(); return;
  }
  const owner = account.userId; pendingPlanIntent = null; openUpgrade();
  showConfirm(t('billing.confirmTitle'), t('billing.confirm', { email: account.email, plan: targetPlan === 'pro' ? 'Pro' : 'Free' }), t('dialog.continue'), async () => {
    els.confirmOk.disabled = true;
    try {
      const result = await sendMessage({ type: 'CHANGE_PLAN', targetPlan, expectedUserId: owner, confirmed: true });
      closeDialogs(); $('plan-error').textContent = t(result.error === 'account_changed' ? 'profile.accountChanged' : 'billing.unavailable');
    } finally { els.confirmOk.disabled = false; }
  }, 'primary');
}
async function resumePendingPlanChange() {
  if (!pendingPlanIntent) return false;
  const { targetPlan } = pendingPlanIntent; pendingPlanIntent = null; await beginPlanChange(targetPlan); return true;
}
function setupProfileAndPlans() {
  for (const suffix of Object.keys(PROFILE_FIELDS)) {
    const source = $('onboard-ai-' + suffix).closest('label').cloneNode(true);
    source.querySelectorAll('[data-testid]').forEach(el => el.removeAttribute('data-testid'));
    source.removeAttribute('data-testid'); source.htmlFor = 'writing-profile-' + suffix;
    source.querySelector('input,textarea').id = 'writing-profile-' + suffix;
    $('writing-profile-fields').append(source);
  }
  $('writing-profile-form').addEventListener('submit', async event => {
    event.preventDefault(); const owner = profileEditorOwner;
    if (owner !== account.userId || !loadedWritingProfile) return;
    const draft = { ...loadedWritingProfile };
    for (const [suffix, key] of Object.entries(PROFILE_FIELDS)) draft[key] = $('writing-profile-' + suffix).value.trim();
    draft.promptThemes = [...$('writing-profile-themes').querySelectorAll('input:checked')].map(el => el.value);
    $('writing-profile-save').disabled = true; $('writing-profile-cancel').disabled = true;
    try {
      const result = await sendMessage({ type: 'SAVE_MY_PROFILE', expectedUserId: owner, profile: draft });
      if (owner !== account.userId) return;
      if (!result.ok) { $('writing-profile-status').textContent = t('profile.saveFailed'); return; }
      settings = result.settings; updateSuggestionAccount(result.account); loadedWritingProfile = structuredClone(result.profile);
      fillWritingProfile(loadedWritingProfile); await renderPrompt(); $('writing-profile-status').textContent = t('profile.saved');
    } finally { $('writing-profile-save').disabled = false; $('writing-profile-cancel').disabled = false; }
  });
  $('writing-profile-cancel').addEventListener('click', () => { if (loadedWritingProfile) fillWritingProfile(loadedWritingProfile); $('writing-profile-status').textContent = ''; });
  $('edit-writing-profile').addEventListener('click', () => openLibrary('profile'));
  $('writing-profile-login').addEventListener('click', async () => { await openSettings(); els.accountEditor.hidden = false; els.accountEmail.focus(); });
  $('writing-profile-onboard').addEventListener('click', startProOnboarding);
  setupAccountSecurity();
}
