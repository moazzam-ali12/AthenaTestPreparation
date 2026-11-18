import json

from app.utils.sentry import FILTERED, scrub_event


def test_scrub_event_removes_pii_and_secrets():
    event = scrub_event({
        "message": "failed for bob@example.com",
        "user": {"id": "u_1", "email": "bob@example.com", "ip_address": "1.2.3.4"},
        "request": {
            "url": "http://x/debug?token=abc",
            "data": {"question": "Q", "student_answer": 2},
            "cookies": {"s": "1"},
            "headers": {"Authorization": "Bearer xyz", "User-Agent": "UA"},
        },
        "extra": {"history": ["hi"], "count": 1},
        "breadcrumbs": {"values": [{"message": "sk_live_abc123 a@b.co", "data": {"content": "x"}}]},
        "exception": {"values": [{"value": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig", "stacktrace": {"frames": [{"vars": {"p": 1}}]}}]},
    })
    dumped = json.dumps(event)
    assert event["user"] == {"id": "u_1"}
    assert "data" not in event["request"] and "cookies" not in event["request"]
    assert event["request"]["headers"] == {"User-Agent": "UA"}
    assert event["extra"] == {"history": FILTERED, "count": 1}
    for leak in ("bob@example.com", "a@b.co", "sk_live_abc123", "eyJhbGci", "token=abc", "Bearer xyz", '"vars"'):
        assert leak not in dumped, leak
