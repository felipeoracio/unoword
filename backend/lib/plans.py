"""Public capabilities shared by entitlement enforcement and the plan comparison.

Billing offer configuration lives in lib.billing.
Per-account usage remains available only through the authenticated usage API.
"""
PAID_PLANS = frozenset({'pro', 'premium'})
FEATURES = (
    ('writing_editor', 'Full writing editor & private document library', False, True),
    ('rich_text_formatting', 'Rich-text formatting', False, True),
    ('document_library', 'Private document library', False, True),
    ('document_folders', 'Document folders', False, True),
    ('unlimited_writing_streaks', 'Unlimited visible writing streaks', False, True),
    ('full_streak_history', 'Full qualifying streak history', False, True),
    ('personalized_ai_suggestions', 'Personalized AI writing suggestions', False, True),
    ('ai_writing_guidance', 'AI Writing Guidance', False, True),
    ('personalized_writing_profile', 'Personalized Writing Profile', False, True),
    ('editor_ai', 'Personalized AI writing tools', False, True),
    ('session_tracking', 'Writing session tracking', True, True),
    ('quick_prompt', 'Quick Prompt', True, True),
    ('basic_history', 'Recent writing history (24 hours)', True, True),
    ('writing_profile', 'Personalized Writing Profile', False, True),
    ('new_topic', 'New Topic AI suggestions', False, True),
    ('expand_idea', 'Expand an Idea AI suggestions', False, True),
    ('connect_dots', 'Connect the Dots AI suggestions', False, True),
    ('knowledge_sources', 'AI document, website & writing knowledge', False, True),
    ('writing_goals', 'Daily writing goals & streaks', True, True),
    ('goals_analytics', 'Extended writing history & analytics', False, True),
)


def plan_features(plan: str) -> dict[str, bool]:
    paid = plan in PAID_PLANS
    return {key: pro if paid else free for key, _label, free, pro in FEATURES}
