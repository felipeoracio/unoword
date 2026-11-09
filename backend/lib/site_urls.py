"""Production URL defaults and the bounded legacy-domain compatibility window."""
import os

PRIMARY_ORIGIN = 'https://unoword.app'
LEGACY_ORIGINS = ('https://unoword.vercel.app', 'https://www.unoword.app')


def public_app_url():
    """Keep explicit staging URLs; old production settings resolve to primary."""
    configured = os.getenv('PUBLIC_APP_URL', PRIMARY_ORIGIN).strip().rstrip('/')
    return PRIMARY_ORIGIN if configured in LEGACY_ORIGINS else configured


def webhook_urls(path):
    """Existing signed destinations stay valid until their owner updates Stripe."""
    origin = public_app_url()
    urls = [origin + path]
    if origin == PRIMARY_ORIGIN:
        urls.extend(legacy + path for legacy in LEGACY_ORIGINS)
    return urls
