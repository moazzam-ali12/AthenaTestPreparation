import asyncio

from app.pre_generation import problem_quality
from app.pre_generation.practice_generator import band_targets


def test_band_targets_default_is_2_2_1():
    assert band_targets(5) == {"easy": 2, "medium": 2, "hard": 1}


def test_band_targets_sum_to_requested():
    for n in range(1, 12):
        assert sum(band_targets(n).values()) == n


class _Broken:
    async def arun(self, _prompt):
        raise RuntimeError("verifier down")


def test_strict_verification_drops_unchecked(monkeypatch):
    monkeypatch.setattr(problem_quality, "_verifier_agent", _Broken())
    probs = [{"questionText": "q", "options": ["a", "b", "c", "d"], "correctOption": 0}]
    assert asyncio.run(problem_quality.verify_answer_keys(probs, "AUD", strict=True)) == []
    # Non-strict keeps the old fail-open behaviour for the existing seeders.
    assert asyncio.run(problem_quality.verify_answer_keys(probs, "AUD")) == probs
