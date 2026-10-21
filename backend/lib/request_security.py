"""Browser origin checks and a bounded burst limiter, in addition to GoTrue limits."""
import os
import time
from collections import OrderedDict
from urllib.parse import urlsplit
from fastapi import HTTPException, Request

_bursts = OrderedDict()

def trusted_origin(request: Request):
    origin = request.headers.get('origin', '')
    allowed = {os.getenv('PUBLIC_APP_URL', 'https://unoword.vercel.app').rstrip('/')}
    allowed.update(x.strip().rstrip('/') for x in os.getenv('AUTH_ALLOWED_ORIGINS', '').split(',') if x.strip())
    parsed = urlsplit(origin)
    extension = parsed.scheme == 'chrome-extension' and bool(parsed.netloc) and not parsed.path and not parsed.query
    if origin in allowed or extension:
        return
    # Non-browser clients explicitly using bearer authentication are not subject
    # to cookie CSRF. A browser cannot forge its Origin header.
    if not origin and request.headers.get('authorization', '').startswith('Bearer '):
        return
    raise HTTPException(403, 'untrusted_origin')

def limit_sensitive(key: str, maximum: int = 5, seconds: int = 300):
    now = time.monotonic()
    entries = [at for at in _bursts.pop(key, []) if now - at < seconds]
    if len(entries) >= maximum:
        _bursts[key] = entries
        raise HTTPException(429, 'security_rate_limited', headers={'Retry-After': str(seconds)})
    _bursts[key] = entries + [now]
    while len(_bursts) > 4096:
        _bursts.popitem(last=False)
