"""
Quality checks for LLM-generated Task-Based Simulations (TBS).

Mirrors problem_quality.py for MCQs:
  - validate_tbs():        structural/schema checks the UI and grader depend on
                           (every field has a key, options contain the answer,
                           journal entries balance, ...)
  - recompute_numeric():   re-derives numeric answers from their formula and
                           checks every input actually appears in the exhibits
  - verify_tbs_answer_keys(): optional independent solve; disputed tasks are dropped

Field/answer shapes must stay in sync with src/lib/tbs/schema.ts.
"""

from __future__ import annotations

import ast
import json
import math
import operator
import re

from agno.agent import Agent
from agno.models.anthropic import Claude

from app.pre_generation.problem_quality import DIFFICULTY_LEVELS

MIN_FIELDS = 3
MAX_FIELDS = 8
FIELD_TYPES = {"numeric", "option_list", "journal_entry"}
EXHIBIT_KINDS = {"text", "table"}
# Inputs named const_* (e.g. const_months = 12) are domain constants, not exhibit facts.
CONSTANT_PREFIX = "const_"


# ── Schema validation ──────────────────────────────────────────────────────

def _nonempty_str(v) -> bool:
    return isinstance(v, str) and bool(v.strip())


def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _validate_exhibits(exhibits, errors: list[str]) -> None:
    if not isinstance(exhibits, list) or not exhibits:
        errors.append("at least one exhibit is required")
        return
    ids = set()
    for e in exhibits:
        if not isinstance(e, dict) or not _nonempty_str(e.get("id")) or not _nonempty_str(e.get("title")):
            errors.append("exhibit missing id/title")
            continue
        if e["id"] in ids:
            errors.append(f"duplicate exhibit id {e['id']}")
        ids.add(e["id"])
        if e.get("kind") not in EXHIBIT_KINDS:
            errors.append(f"exhibit {e['id']}: kind must be text|table")
        table = e.get("table")
        if e.get("kind") == "table":
            if not isinstance(table, dict) or not isinstance(table.get("columns"), list) or not isinstance(table.get("rows"), list):
                errors.append(f"exhibit {e['id']}: table needs columns and rows")
                continue
            width = len(table["columns"])
            if any(not isinstance(r, list) or len(r) != width for r in table["rows"]):
                errors.append(f"exhibit {e['id']}: every row must have {width} cells")
        elif not _nonempty_str(e.get("body")):
            errors.append(f"exhibit {e['id']}: text exhibit needs a body")


def _validate_field(field: dict, key, errors: list[str]) -> None:
    fid = field.get("id")
    ftype = field.get("type")
    if ftype not in FIELD_TYPES:
        errors.append(f"field {fid}: unknown type {ftype}")
        return
    if not _nonempty_str(field.get("label")):
        errors.append(f"field {fid}: missing label")
    if not _is_number(field.get("points")) or field["points"] <= 0:
        errors.append(f"field {fid}: points must be > 0")
    if not isinstance(key, dict):
        errors.append(f"field {fid}: has no answer key")
        return
    if key.get("type") != ftype:
        errors.append(f"field {fid}: key type {key.get('type')} != field type {ftype}")
        return

    if ftype == "numeric":
        if not _is_number(key.get("value")):
            errors.append(f"field {fid}: numeric key needs a number value")
        tol = key.get("tolerance", 0)
        if not _is_number(tol) or tol < 0:
            errors.append(f"field {fid}: tolerance must be >= 0")

    elif ftype == "option_list":
        options = field.get("options")
        if not isinstance(options, list) or len(options) < 2 or not all(_nonempty_str(o) for o in options):
            errors.append(f"field {fid}: option_list needs >= 2 options")
        elif len(set(options)) != len(options):
            errors.append(f"field {fid}: duplicate options")
        elif key.get("value") not in options:
            errors.append(f"field {fid}: answer is not one of the options")

    elif ftype == "journal_entry":
        accounts = field.get("accounts")
        if not isinstance(accounts, list) or len(accounts) < 2 or not all(_nonempty_str(a) for a in accounts):
            errors.append(f"field {fid}: journal_entry needs a chart of accounts (>= 2)")
            return
        lines = key.get("lines")
        if not isinstance(lines, list) or len(lines) < 2:
            errors.append(f"field {fid}: journal entry key needs >= 2 lines")
            return
        debits = credits = 0.0
        for ln in lines:
            if not isinstance(ln, dict) or ln.get("account") not in accounts:
                errors.append(f"field {fid}: key account {ln.get('account') if isinstance(ln, dict) else ln!r} not in chart of accounts")
                continue
            if ln.get("side") not in ("debit", "credit"):
                errors.append(f"field {fid}: line side must be debit|credit")
                continue
            if not _is_number(ln.get("amount")) or ln["amount"] <= 0:
                errors.append(f"field {fid}: line amount must be > 0")
                continue
            if ln["side"] == "debit":
                debits += ln["amount"]
            else:
                credits += ln["amount"]
        if round(debits, 2) != round(credits, 2):
            errors.append(f"field {fid}: journal entry does not balance ({debits} != {credits})")


def validate_tbs(task: dict) -> list[str]:
    """Returns a list of problems; empty means structurally valid."""
    errors: list[str] = []
    if not isinstance(task, dict):
        return ["task is not an object"]
    for k in ("title", "instructions", "explanation"):
        if not _nonempty_str(task.get(k)):
            errors.append(f"missing {k}")
    if task.get("difficulty") not in DIFFICULTY_LEVELS:
        errors.append("difficulty must be easy|medium|hard")
    est = task.get("estMinutes")
    if est is not None and (not _is_number(est) or est <= 0):
        errors.append("estMinutes must be > 0")

    _validate_exhibits(task.get("exhibits"), errors)

    fields = task.get("fields")
    answers = task.get("answers") if isinstance(task.get("answers"), dict) else {}
    if not isinstance(fields, list) or not (MIN_FIELDS <= len(fields) <= MAX_FIELDS):
        errors.append(f"needs {MIN_FIELDS}-{MAX_FIELDS} fields")
        return errors
    ids = [f.get("id") if isinstance(f, dict) else None for f in fields]
    if any(not _nonempty_str(i) for i in ids) or len(set(ids)) != len(ids):
        errors.append("field ids must be unique non-empty strings")
        return errors
    for f in fields:
        _validate_field(f, answers.get(f["id"]), errors)
    extra = set(answers) - set(ids)
    if extra:
        errors.append(f"answer keys for unknown fields: {sorted(extra)}")
    return errors


# ── Numeric recomputation ──────────────────────────────────────────────────

_BIN_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}
_UNARY_OPS = {ast.USub: operator.neg, ast.UAdd: operator.pos}
_FUNCS = {"round": round, "min": min, "max": max, "abs": abs}


def safe_eval(expr: str, names: dict[str, float]) -> float:
    """Evaluates + - * / ( ) numbers, input names and round/min/max/abs. Nothing else."""

    def ev(node):
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and _is_number(node.value):
            return node.value
        if isinstance(node, ast.Name):
            if node.id not in names:
                raise ValueError(f"unknown name {node.id}")
            return names[node.id]
        if isinstance(node, ast.BinOp) and type(node.op) in _BIN_OPS:
            return _BIN_OPS[type(node.op)](ev(node.left), ev(node.right))
        if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPS:
            return _UNARY_OPS[type(node.op)](ev(node.operand))
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in _FUNCS
            and not node.keywords
        ):
            return _FUNCS[node.func.id](*(ev(a) for a in node.args))
        raise ValueError(f"disallowed expression: {ast.dump(node)[:60]}")

    return float(ev(ast.parse(expr, mode="eval")))


_NUMBER_RE = re.compile(r"\(?-?\$?\d[\d,]*(?:\.\d+)?%?\)?")


def exhibit_numbers(exhibits: list[dict]) -> set[float]:
    """Every number that appears in the exhibits (tables and text), as absolute values."""
    found: set[float] = set()

    def add_text(text: str) -> None:
        for m in _NUMBER_RE.findall(text):
            pct = m.rstrip(")").endswith("%")
            digits = re.sub(r"[^\d.]", "", m)
            if not digits or digits == ".":
                continue
            try:
                v = float(digits)
            except ValueError:
                continue
            found.add(round(v, 4))
            if pct:
                found.add(round(v / 100, 6))

    for e in exhibits:
        if isinstance(e.get("body"), str):
            add_text(e["body"])
        table = e.get("table") or {}
        for row in table.get("rows", []):
            for cell in row:
                if _is_number(cell):
                    found.add(round(abs(cell), 4))
                elif isinstance(cell, str):
                    add_text(cell)
        for col in table.get("columns", []):
            if isinstance(col, str):
                add_text(col)
    return found


def recompute_numeric(task: dict) -> list[str]:
    """
    For numeric keys that carry `formula` + `inputs`, checks that every
    non-constant input appears in the exhibits and that the formula
    reproduces the key value (whole-unit rounding, within tolerance).
    Keys without a formula are skipped (nothing to recompute).
    """
    errors: list[str] = []
    numbers = exhibit_numbers(task.get("exhibits") or [])
    for fid, key in (task.get("answers") or {}).items():
        if not isinstance(key, dict) or key.get("type") != "numeric" or not key.get("formula"):
            continue
        inputs = key.get("inputs") or {}
        if not isinstance(inputs, dict) or not all(_is_number(v) for v in inputs.values()):
            errors.append(f"field {fid}: inputs must be numbers")
            continue
        for name, v in inputs.items():
            if name.startswith(CONSTANT_PREFIX):
                continue
            if round(abs(v), 4) not in numbers and round(abs(v), 6) not in numbers:
                errors.append(f"field {fid}: input {name}={v} does not appear in the exhibits")
        try:
            computed = safe_eval(str(key["formula"]), {k: float(v) for k, v in inputs.items()})
        except (ValueError, SyntaxError, ZeroDivisionError, TypeError) as e:
            errors.append(f"field {fid}: formula error: {e}")
            continue
        tol = key.get("tolerance", 0) or 0
        if not _is_number(key.get("value")) or abs(round(computed) - round(key["value"])) > tol:
            errors.append(f"field {fid}: formula gives {computed:,.2f} but key says {key.get('value')}")
    return errors


def check_tbs(task: dict) -> list[str]:
    """All deterministic checks. Empty list = passes."""
    errors = validate_tbs(task)
    return errors or recompute_numeric(task)


# ── Answer comparison (same rules as src/lib/tbs/grade.ts) ─────────────────

def _je_multiset(lines) -> list[tuple[str, str, int]]:
    out = []
    for ln in lines or []:
        if not isinstance(ln, dict):
            continue
        account = str(ln.get("account", "")).strip().lower()
        if "side" in ln:
            side, amount = ln.get("side"), ln.get("amount")
        else:  # response shape: { account, debit, credit }
            debit, credit = ln.get("debit") or 0, ln.get("credit") or 0
            side, amount = ("debit", debit) if debit else ("credit", credit)
        if _is_number(amount):
            out.append((account, side, round(amount)))
    return sorted(out)


def answers_match(key: dict, answer) -> bool:
    t = key.get("type")
    if t == "numeric":
        return _is_number(answer) and abs(round(answer) - round(key["value"])) <= (key.get("tolerance") or 0)
    if t == "option_list":
        return isinstance(answer, str) and answer.strip() == key["value"]
    if t == "journal_entry":
        return isinstance(answer, list) and _je_multiset(answer) == _je_multiset(key["lines"])
    return False


# ── Independent answer-key check ───────────────────────────────────────────

_tbs_verifier_agent = Agent(
    name="CPA TBS Verifier",
    model=Claude(id="claude-sonnet-4-6"),
    description="You independently solve CPA Exam Task-Based Simulations.",
    instructions=[
        "You are an expert CPA. Solve the task-based simulation independently and carefully using only the exhibits.",
        "Return ONLY a JSON object mapping each field id to your answer:",
        "- numeric: a number (negative for decreases/losses where the label implies it)",
        "- option_list: the exact text of one option",
        "- journal_entry: an array of { account, side: 'debit'|'credit', amount } using only the given accounts",
        "If a field is ambiguous or has no single correct answer, use null for it.",
        "No markdown code fences or extra text.",
    ],
    markdown=False,
)


def public_view(task: dict) -> dict:
    """The task as a candidate sees it (no answers/explanation)."""
    return {
        "title": task["title"],
        "instructions": task["instructions"],
        "exhibits": task["exhibits"],
        "fields": task["fields"],
    }


async def verify_tbs_answer_keys(task: dict, subject_label: str) -> bool | None:
    """
    True if an independent solve agrees with every field's key, False if any
    field is disputed, None if the verifier itself failed (caller decides).
    """
    prompt = f"Section: {subject_label}\nSolve this simulation:\n{json.dumps(public_view(task), indent=2)}"
    try:
        response = await _tbs_verifier_agent.arun(prompt)
        content = response.content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        answers = json.loads(content[content.find("{"):content.rfind("}") + 1])
    except Exception as e:  # noqa: BLE001 — mirror verify_answer_keys: never crash the run
        print(f"  ⚠ TBS verification skipped: {e}", flush=True)
        return None
    if not isinstance(answers, dict):
        return None
    disputed = [fid for fid, key in task["answers"].items() if not answers_match(key, answers.get(fid))]
    if disputed:
        print(f"  ⚠ disputed fields {disputed} in '{task['title'][:60]}'", flush=True)
        return False
    return True
