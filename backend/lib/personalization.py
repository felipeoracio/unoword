"""Canonical account writing preferences, shared by the profile UI and AI."""
from copy import deepcopy

FIELDS = ('writing_goal', 'writing_style', 'audience', 'primary_topics',
          'current_projects', 'favorite_subjects', 'avoid_topics', 'personal_context')
LIST_FIELDS = {'primary_topics', 'current_projects', 'favorite_subjects', 'avoid_topics'}
ALIASES = dict(zip(('writingGoal','writingStyle','audience','primaryTopics','currentProjects','favoriteSubjects','avoidTopics','personalContext'), FIELDS))
ALIASES.update({f: f for f in FIELDS})
ALIASES.update(dict(zip(('onboard-ai-goal','onboard-ai-style','onboard-ai-audience','onboard-ai-topics','onboard-ai-projects','onboard-ai-subjects','onboard-ai-avoid','onboard-ai-context'), FIELDS)))


def effective_profile(profile, answers):
    result = deepcopy(profile)
    if (result.get('ai_preferences') or {}).get('profile_edited'):
        return result
    for answer in answers:
        field = ALIASES.get(answer.get('question_id'))
        if field and not result.get(field) and answer.get('answer'):
            value = answer['answer']
            result[field] = [s.strip() for s in value.replace('\n', ',').split(',') if s.strip()][:50] if field in LIST_FIELDS else value
    return result


def prompt_themes(profile):
    values = (profile.get('ai_preferences') or {}).get('prompt_themes', [])
    return [str(value).strip()[:100] for value in values if isinstance(value, str) and value.strip()][:30] if isinstance(values, list) else []


def contextual_answers(profile, answers):
    # Explicit edits, including clearing a field, supersede old onboarding data.
    return [] if (profile.get('ai_preferences') or {}).get('profile_edited') else answers
