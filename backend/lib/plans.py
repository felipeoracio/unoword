"""Public capabilities shared by entitlement enforcement and the plan comparison.

Billing offer configuration lives in lib.billing.
Per-account usage remains available only through the authenticated usage API.
"""
PAID_PLANS = frozenset({'pro', 'premium'})
FEATURES = (
    ('writing_editor', 'Full writing editor & private document library', False, True),
    ('editor_ai', 'Personalized AI writing tools', False, True),
    ('session_tracking', 'Writing session tracking', True, True),
    ('quick_prompt', 'Quick Prompt', True, True),
    ('basic_history', 'Recent writing history (24 hours)', True, True),
    ('writing_profile', 'Editable Writing Profile', True, True),
    ('new_topic', 'New Topic AI suggestions', False, True),
    ('expand_idea', 'Expand an Idea AI suggestions', False, True),
    ('connect_dots', 'Connect the Dots AI suggestions', False, True),
    ('knowledge_sources', 'AI document, website & writing knowledge', False, True),
    ('goals_analytics', 'Writing goals & extended history', False, True),
)


def plan_features(plan: str) -> dict[str, bool]:
    paid = plan in PAID_PLANS
    return {key: pro if paid else free for key, _label, free, pro in FEATURES}
