"""Sanitized, anonymous product information; never resolves a model or user data."""
import os
from urllib.parse import urlsplit
from fastapi import APIRouter
from lib.plans import BILLING_AVAILABLE, FEATURES, plan_features

router = APIRouter(tags=['product'])


def store_listing():
    candidate = os.getenv('PUBLIC_CHROME_STORE_URL', '').strip()
    try:
        parsed = urlsplit(candidate)
    except ValueError:
        return None
    if parsed.scheme == 'https' and parsed.netloc == 'chromewebstore.google.com' and parsed.path.startswith('/detail/'):
        return candidate
    return None


@router.get('/product')
async def product():
    return {
        'name': 'UnoWord', 'billing_available': BILLING_AVAILABLE,
        'chrome_store_url': store_listing(),
        'plans': [{'id': key, 'name': name, 'price': None, 'features': plan_features(key)}
                  for key, name in [('free', 'Free'), ('pro', 'Pro')]],
        'features': [{'id': key, 'label': label} for key, label, _free, _pro in FEATURES],
    }
