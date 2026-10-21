"""SSRF-safe webpage retrieval + readable-article extraction for Private Documents.

A user saves a public article/blog URL; this module validates the URL, guards
against SSRF (private/loopback/link-local/metadata addresses, per-redirect-hop
checks), fetches the public HTML with bounded timeout + size, and extracts the
readable title/text/author/canonical-url/date with trafilatura. The extracted
text is treated downstream as untrusted reference material, never instructions.
"""

from __future__ import annotations

import hashlib
import ipaddress
import logging
import socket
from urllib.parse import urlparse, urlunparse

import httpx
import trafilatura

logger = logging.getLogger(__name__)

MAX_BYTES = 2_500_000
TIMEOUT = 12.0
MAX_REDIRECTS = 4
MAX_URL_LEN = 2000
ALLOWED_SCHEMES = {"http", "https"}
BLOCKED_HOSTNAMES = {"localhost", "metadata.google.internal", "metadata"}
USER_AGENT = "UnoWordBot/1.0 (+https://unoword.app private reference ingest)"


class LinkIngestError(Exception):
    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason
        self.message = message


def _ip_is_blocked(ip_str: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        return True
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


def validate_url(raw: str) -> tuple[str, str]:
    """Return (normalized_url, hostname). Raises LinkIngestError('invalid_url', ...)."""
    raw = (raw or "").strip()
    if not raw or len(raw) > MAX_URL_LEN:
        raise LinkIngestError("invalid_url", "Please enter a valid web address.")
    parsed = urlparse(raw)
    if parsed.scheme.lower() not in ALLOWED_SCHEMES:
        raise LinkIngestError("invalid_url", "Only http:// and https:// links are supported.")
    if not parsed.hostname:
        raise LinkIngestError("invalid_url", "That URL is missing a hostname.")
    if parsed.username or parsed.password:
        raise LinkIngestError("invalid_url", "URLs with embedded credentials are not allowed.")
    normalized = urlunparse(
        (parsed.scheme.lower(), parsed.netloc, parsed.path or "/", parsed.params, parsed.query, "")
    )
    return normalized, parsed.hostname


def _check_host_not_internal(host: str) -> None:
    host_l = (host or "").lower().strip(".")
    if (
        not host_l
        or host_l in BLOCKED_HOSTNAMES
        or host_l.endswith(".local")
        or host_l.endswith(".internal")
    ):
        raise LinkIngestError("blocked", "That address points to an internal host and was blocked.")
    try:
        ipaddress.ip_address(host_l)  # literal IP
        if _ip_is_blocked(host_l):
            raise LinkIngestError("blocked", "That address is a private/internal IP and was blocked.")
        return
    except ValueError:
        pass
    try:
        # Managed runtimes may wrap resolver failures or return no address list.
        # Fail closed for every resolver failure instead of leaking a 500 or
        # proceeding to fetch without validating the destination addresses.
        addresses = [info[4][0] for info in socket.getaddrinfo(host_l, None)]
    except Exception as error:
        logger.warning("link_dns_failed host=%s type=%s", host_l, type(error).__name__)
        raise LinkIngestError("unreachable", "Could not resolve that website's address.") from error
    if not addresses:
        raise LinkIngestError("unreachable", "Could not resolve that website's address.")
    for address in addresses:
        if _ip_is_blocked(address):
            raise LinkIngestError(
                "blocked",
                "That website resolves to a private or internal address and was blocked.",
            )


async def _fetch(url: str) -> tuple[httpx.Response, str]:
    current = url
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,text/plain"}
    async with httpx.AsyncClient(follow_redirects=False, timeout=TIMEOUT) as client:
        for _ in range(MAX_REDIRECTS + 1):
            normalized, host = validate_url(current)
            _check_host_not_internal(host)  # re-validate every hop (redirect SSRF)
            try:
                async with client.stream("GET", normalized, headers=headers) as streamed:
                    if streamed.is_redirect:
                        resp = httpx.Response(streamed.status_code, headers=streamed.headers, request=streamed.request)
                    else:
                        content = bytearray()
                        async for piece in streamed.aiter_bytes():
                            content.extend(piece)
                            if len(content) > MAX_BYTES:
                                raise LinkIngestError("too_large", "That page is too large to process.")
                        clean_headers = {k: v for k, v in streamed.headers.items() if k.lower() not in {"content-encoding", "content-length"}}
                        resp = httpx.Response(streamed.status_code, headers=clean_headers, content=bytes(content), request=streamed.request)
            except httpx.TimeoutException as exc:
                raise LinkIngestError("timeout", "The website took too long to respond.") from exc
            except httpx.HTTPError as exc:
                raise LinkIngestError("unreachable", "Could not reach that website.") from exc
            if resp.status_code in (301, 302, 303, 307, 308):
                location = resp.headers.get("location")
                if not location:
                    break
                current = str(httpx.URL(resp.url).join(location))
                continue
            return resp, normalized
    raise LinkIngestError("unreachable", "That link redirected too many times.")


def _extract(html: str, url: str) -> dict:
    # Extraction must be independent across refreshes and users. Trafilatura's
    # deduplicate=True uses a process-wide cache and can suppress repeat reads.
    text = trafilatura.extract(
        html, include_comments=False, include_tables=False, favor_precision=True, deduplicate=False, url=url
    ) or ""
    text = text.strip()
    if not text:
        raise LinkIngestError(
            "no_content",
            "Could not extract readable article text (the page may require JavaScript or sign-in).",
        )
    if len(text.split()) < 80 and any(marker in text.lower() for marker in (
        "sign in to continue", "subscribe to continue", "log in to read", "verify you are human", "checking your browser",
    )):
        raise LinkIngestError("restricted_content", "Only a sign-in, subscription, or access-check page was available. Uno Word cannot read the protected article.")
    title = author = published_at = canonical = None
    try:
        meta = trafilatura.extract_metadata(html, default_url=url)
        if meta is not None:
            title = (meta.title or None)
            author = (meta.author or None)
            published_at = (meta.date or None)
            canonical = (meta.url or None)
    except Exception:
        pass
    return {
        "title": (title or "")[:300] or None,
        "author": (author or "")[:200] or None,
        "published_at": (published_at or "")[:40] or None,
        "canonical_url": (canonical or "")[:2000] or None,
        "text": text,
        "word_count": len(text.split()),
        "content_hash": hashlib.sha256(text.encode("utf-8", "ignore")).hexdigest(),
    }


async def fetch_and_extract(raw_url: str) -> dict:
    """Validate, SSRF-check, fetch and extract. Raises LinkIngestError on failure."""
    normalized, host = validate_url(raw_url)
    _check_host_not_internal(host)
    resp, final_url = await _fetch(normalized)

    if resp.status_code in (401, 403):
        raise LinkIngestError("blocked_by_site", "That website blocked automated access (sign-in or paywall).")
    if resp.status_code in (404, 410):
        raise LinkIngestError("not_found", "That page could not be found.")
    if resp.status_code >= 400:
        raise LinkIngestError("unreachable", f"The website returned an error ({resp.status_code}).")

    ctype = (resp.headers.get("content-type") or "").lower()
    if not any(t in ctype for t in ("text/html", "application/xhtml", "text/plain", "application/xml", "text/xml")):
        raise LinkIngestError("unsupported_type", "That link is not a readable web article (unsupported content type).")

    content = resp.content or b""
    if len(content) > MAX_BYTES:
        raise LinkIngestError("too_large", "That page is too large to process.")

    html = resp.text
    data = _extract(html, final_url)
    data["final_url"] = final_url
    if not data.get("canonical_url"):
        data["canonical_url"] = final_url
    return data
