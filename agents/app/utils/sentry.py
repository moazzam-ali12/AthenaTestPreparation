"""Sentry for the agents backend (FastAPI).

Disabled when SENTRY_DSN is unset (local dev). Same env pattern as the web app:
SENTRY_DSN, SENTRY_ENVIRONMENT, SENTRY_RELEASE (git SHA), SENTRY_SAMPLE_RATE (default 1.0),
SENTRY_TRACES_SAMPLE_RATE (default 0.1).

Privacy: send_default_pii=False, no request bodies, no local variables, and
before_send masks emails / tokens / Stripe data / learner content.
Mirrors src/lib/sentry/scrub.ts.
"""

from __future__ import annotations

import os
import re
import subprocess
from typing import Any

FILTERED = "[Filtered]"

SENSITIVE_KEY = re.compile(
    r"pass(word|wd)?|secret|token|auth|cookie|session|api[-_]?key|signature|stripe|card|cvc|iban|"
    r"email|e-mail|phone|address|answer|question|option|solution|explanation|prompt|content|message|"
    r"history|transcript|body|payload|svix|dsn|jwt|credential|private",
    re.I,
)

SAFE_HEADERS = {
    "accept", "accept-language", "content-type", "content-length", "host",
    "user-agent", "x-forwarded-proto", "sentry-trace", "baggage",
}

SAFE_CONTEXTS = {"os", "browser", "runtime", "device", "app", "trace", "culture", "cloud_resource"}

STRING_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I), "[email]"),
    (re.compile(r"\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+"), r"\1 [Filtered]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*"), "[jwt]"),
    (re.compile(r"\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]+"), "[stripe-key]"),
    (re.compile(r"\bwhsec_[A-Za-z0-9]+"), FILTERED),
    (re.compile(r"\b(cus|sub|pi|ch|cs_(live|test)|in|pm|seti|evt|price|prod|bps)_[A-Za-z0-9]{8,}"), "[stripe-id]"),
    (re.compile(r"\b(sb_secret|sb_publishable|sk-ant|sk-proj|re)_[A-Za-z0-9_-]{10,}"), FILTERED),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{20,}"), FILTERED),
    (
        re.compile(
            r"([?&](?:token|code|key|secret|signature|sig|password|email|access_token|refresh_token)=)[^&#\s]*",
            re.I,
        ),
        r"\1[Filtered]",
    ),
]


def scrub_string(value: str) -> str:
    for pattern, repl in STRING_RULES:
        value = pattern.sub(repl, value)
    return value


def scrub_value(value: Any, depth: int = 0) -> Any:
    if depth > 8:
        return FILTERED
    if isinstance(value, str):
        return scrub_string(value)
    if isinstance(value, (list, tuple)):
        return [scrub_value(v, depth + 1) for v in value]
    if isinstance(value, dict):
        return {
            k: (FILTERED if SENSITIVE_KEY.search(str(k)) else scrub_value(v, depth + 1))
            for k, v in value.items()
        }
    return value


def scrub_breadcrumb(crumb: dict, _hint: Any = None) -> dict:
    if isinstance(crumb.get("message"), str):
        crumb["message"] = scrub_string(crumb["message"])
    if crumb.get("data"):
        crumb["data"] = scrub_value(crumb["data"])
    return crumb


def scrub_event(event: dict, _hint: Any = None) -> dict:
    user = event.get("user")
    if user is not None:
        uid = user.get("id") if isinstance(user, dict) else None
        if uid is not None:
            event["user"] = {"id": str(uid)}
        else:
            event.pop("user", None)

    req = event.get("request")
    if isinstance(req, dict):
        for k in ("data", "cookies", "env"):
            req.pop(k, None)
        headers = req.get("headers") or {}
        req["headers"] = {
            k: scrub_string(v) if isinstance(v, str) else v
            for k, v in headers.items()
            if str(k).lower() in SAFE_HEADERS
        }
        for k in ("url", "query_string"):
            if isinstance(req.get(k), str):
                req[k] = scrub_string(req[k])

    for k in ("message", "transaction"):
        if isinstance(event.get(k), str):
            event[k] = scrub_string(event[k])
    for k in ("logentry", "extra", "tags"):
        if event.get(k):
            event[k] = scrub_value(event[k])

    if isinstance(event.get("contexts"), dict):
        event["contexts"] = {
            k: (v if k in SAFE_CONTEXTS else scrub_value(v)) for k, v in event["contexts"].items()
        }

    for ex in (event.get("exception") or {}).get("values") or []:
        if isinstance(ex.get("value"), str):
            ex["value"] = scrub_string(ex["value"])
        for frame in (ex.get("stacktrace") or {}).get("frames") or []:
            frame.pop("vars", None)

    crumbs = event.get("breadcrumbs")
    if isinstance(crumbs, dict):
        crumbs["values"] = [scrub_breadcrumb(c) for c in crumbs.get("values") or []]
    elif isinstance(crumbs, list):
        event["breadcrumbs"] = [scrub_breadcrumb(c) for c in crumbs]

    for span in event.get("spans") or []:
        if isinstance(span.get("description"), str):
            span["description"] = scrub_string(span["description"])
        if span.get("data"):
            span["data"] = scrub_value(span["data"])

    return event


def _rate(name: str, default: float) -> float:
    try:
        value = float(os.environ.get(name, ""))
        return value if 0 <= value <= 1 else default
    except ValueError:
        return default


def _release() -> str | None:
    release = os.environ.get("SENTRY_RELEASE") or os.environ.get("GIT_SHA")
    if release:
        return release
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, timeout=2
        ).decode().strip() or None
    except Exception:
        return None


def environment() -> str:
    return os.environ.get("SENTRY_ENVIRONMENT") or "development"


def init_sentry() -> bool:
    """Initialise Sentry if SENTRY_DSN is set. Returns True when enabled."""
    dsn = os.environ.get("SENTRY_DSN")
    if not dsn:
        return False

    import sentry_sdk

    sentry_sdk.init(
        dsn=dsn,
        environment=environment(),
        release=_release(),
        sample_rate=_rate("SENTRY_SAMPLE_RATE", 1.0),
        traces_sample_rate=_rate("SENTRY_TRACES_SAMPLE_RATE", 0.1),
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        before_send=scrub_event,
        before_send_transaction=scrub_event,
        before_breadcrumb=scrub_breadcrumb,
    )
    return True


def set_user_id(user_id: str | None) -> None:
    """Tag events in the current scope with the internal user id only."""
    if not os.environ.get("SENTRY_DSN"):
        return
    import sentry_sdk

    sentry_sdk.set_user({"id": str(user_id)} if user_id else None)
