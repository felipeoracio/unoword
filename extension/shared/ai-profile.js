/**
 * Uno Word — local AI profile draft helpers.
 *
 * Shared schema for onboarding and the account-backed Writing Profile.
 * The worker owns explicit network writes; this module only maps values.
 */
(function attach(scope) {
  const TEXT_LIMITS = {
    writingGoal: 2000,
    writingStyle: 500,
    audience: 500,
    primaryTopics: 2000,
    currentProjects: 2000,
    favoriteSubjects: 2000,
    avoidTopics: 1000,
    personalContext: 5000,
  };

  function cleanText(value, max) {
    return String(value == null ? '' : value).trim().slice(0, max);
  }

  function normalizeListInput(value, max) {
    const text = Array.isArray(value) ? value.join(', ') : value;
    return cleanText(text, max);
  }

  function sanitizeDraft(value = {}, updatedAt = null) {
    const source = value && typeof value === 'object' ? value : {};
    const storedUpdatedAt = Number(source.updatedAt);
    return {
      promptThemes: Array.isArray(source.promptThemes) ? [...new Set(source.promptThemes.filter(v => typeof v === 'string').map(v => v.trim().slice(0,100)).filter(Boolean))].slice(0,30) : [],
      writingGoal: cleanText(source.writingGoal, TEXT_LIMITS.writingGoal),
      writingStyle: cleanText(source.writingStyle, TEXT_LIMITS.writingStyle),
      audience: cleanText(source.audience, TEXT_LIMITS.audience),
      primaryTopics: normalizeListInput(source.primaryTopics, TEXT_LIMITS.primaryTopics),
      currentProjects: normalizeListInput(source.currentProjects, TEXT_LIMITS.currentProjects),
      favoriteSubjects: normalizeListInput(source.favoriteSubjects, TEXT_LIMITS.favoriteSubjects),
      avoidTopics: normalizeListInput(source.avoidTopics, TEXT_LIMITS.avoidTopics),
      personalContext: cleanText(source.personalContext, TEXT_LIMITS.personalContext),
      onboardingCompleted: source.onboardingCompleted === true,
      syncStatus: ['local_only', 'pending', 'synced'].includes(source.syncStatus) ? source.syncStatus : 'local_only',
      syncedAt: Number.isFinite(Number(source.syncedAt)) && Number(source.syncedAt) > 0 ? Number(source.syncedAt) : null,
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0
        ? updatedAt
        : (Number.isFinite(storedUpdatedAt) && storedUpdatedAt > 0 ? storedUpdatedAt : null),
    };
  }

  function createDraft(overrides = {}) {
    return sanitizeDraft(overrides);
  }

  function splitList(value) {
    return normalizeListInput(value, 5000)
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 50);
  }

  function hasPersonalization(value) {
    const draft = sanitizeDraft(value);
    return Boolean(
      draft.writingGoal || draft.writingStyle || draft.audience ||
      draft.primaryTopics || draft.currentProjects || draft.favoriteSubjects ||
      draft.avoidTopics || draft.personalContext
    );
  }

  function toApiProfile(value) {
    const draft = sanitizeDraft(value);
    return {
      writing_goal: draft.writingGoal || null,
      writing_style: draft.writingStyle || null,
      audience: draft.audience || null,
      primary_topics: splitList(draft.primaryTopics),
      current_projects: splitList(draft.currentProjects),
      favorite_subjects: splitList(draft.favoriteSubjects),
      avoid_topics: splitList(draft.avoidTopics),
      personal_context: draft.personalContext || null,
      ai_preferences: { source: 'extension_profile', sync_status: draft.syncStatus, prompt_themes: draft.promptThemes },
    };
  }

  function mergeWithCloud(localValue, cloudValue = {}) {
    const local = toApiProfile(localValue);
    const cloud = cloudValue && typeof cloudValue === 'object' ? cloudValue : {};
    // A complete edited profile is authoritative, including explicit clears.
    return { ...local, ai_preferences: { ...(cloud.ai_preferences || {}), ...local.ai_preferences, sync_status: 'synced' } };
  }

  function fromApiProfile(value = {}, existing = {}) {
    return sanitizeDraft({
      ...existing,
      promptThemes: Object.hasOwn(value.ai_preferences || {}, 'prompt_themes') ? value.ai_preferences.prompt_themes : (existing.promptThemes || []),
      writingGoal: value.writing_goal || '',
      writingStyle: value.writing_style || '',
      audience: value.audience || '',
      primaryTopics: value.primary_topics || [],
      currentProjects: value.current_projects || [],
      favoriteSubjects: value.favorite_subjects || [],
      avoidTopics: value.avoid_topics || [],
      personalContext: value.personal_context || '',
      onboardingCompleted: true,
      syncStatus: 'synced',
      syncedAt: Date.now(),
    }, Date.now());
  }

  const api = {
    TEXT_LIMITS, cleanText, sanitizeDraft, createDraft, splitList,
    hasPersonalization, toApiProfile, mergeWithCloud, fromApiProfile,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  scope.WCAIProfile = api;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));