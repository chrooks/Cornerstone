"""
formula_engine.py — Declarative composite formula evaluator.

Computes raw player composites from a JSON formula definition instead of
hardcoded Python math. The formula structure is documented in the ExecPlan
at ``feature_requests/composite-formula-editor-execplan.md``.

Each composite formula has:
- **factors**: weighted terms. Type ``"skill"`` looks up a tier value;
  type ``"composite"`` references another composite's already-computed raw value.
- **amplifiers**: multiplicative modifiers. Each amplifier computes
  ``mult = max(floor, floor + scale * source_value)`` and multiplies either the
  entire factor sum (when ``applies_to`` is absent/null) or specific factor
  contributions (when ``applies_to`` lists factor indices).
- **depends_on**: composite keys that must be computed before this one.
- **fallback** (optional): ``{"when_missing": [skill, ...], "factors": [...]}``.
  When EVERY skill named in ``when_missing`` is absent from the raw incoming
  profile (captured before ``_with_default_skills`` erases key-absence), the
  fallback factors are evaluated instead of the primary factors.
  All-or-nothing on ``when_missing``; no nested fallbacks. Amplifiers apply
  to whichever factor set ran.
"""

from __future__ import annotations

from typing import Any

from .composites import tier_value, _with_default_skills


def topological_sort(formulas: dict[str, dict[str, Any]]) -> list[str]:
    """Return composite keys in dependency order.

    Raises ``ValueError`` on circular or unknown dependencies.
    """
    visited: set[str] = set()
    temp: set[str] = set()
    order: list[str] = []

    def visit(key: str) -> None:
        if key in visited:
            return
        if key in temp:
            raise ValueError(f"Circular dependency detected involving '{key}'")
        temp.add(key)
        for dep in formulas.get(key, {}).get("depends_on", []):
            if dep not in formulas:
                raise ValueError(
                    f"Unknown dependency '{dep}' in formula for '{key}'"
                )
            visit(dep)
        temp.remove(key)
        visited.add(key)
        order.append(key)

    for key in formulas:
        visit(key)

    return order


def _resolve_amplifier_source(
    amp: dict[str, Any],
    skills: dict[str, str | float],
    tier_values: dict[str, float],
    raw_results: dict[str, float],
) -> float:
    """Resolve the source value for an amplifier.

    ``source`` is either a string (composite key → raw_results lookup) or a dict
    ``{"skills": [...]}`` (sum of skill tier values).
    """
    source = amp["source"]
    if isinstance(source, str):
        return raw_results.get(source, 0.0)
    if isinstance(source, dict) and "skills" in source:
        return sum(
            tier_value(skills, skill_key, tier_values)
            for skill_key in source["skills"]
        )
    return 0.0


def compute_raw_from_formulas(
    skills: dict[str, str | float],
    formulas: dict[str, dict[str, Any]],
    tier_values: dict[str, float],
    *,
    order: list[str] | None = None,
    present_keys: set[str] | None = None,
) -> dict[str, float]:
    """Compute raw composites from declarative formula definitions.

    Args:
        skills: Player skill map (tier strings or pre-boosted numeric values).
        formulas: The ``composite_formulas`` dict from the Evaluation Version.
        tier_values: Maps tier label strings to numeric scores.
        order: Pre-computed topological order. When evaluating many players
            against the same formulas, call ``topological_sort`` once and pass
            the result here to avoid redundant sorting.
        present_keys: Skill keys present in the RAW incoming profile, captured
            before default-fill. Drives ``fallback.when_missing`` — a skill
            rated "None" is present (no fallback), a key-absent skill is not.
            Defaults to the keys of ``skills`` as passed in.

    Returns:
        Dict mapping composite key → raw float value.
    """
    if present_keys is None:
        present_keys = set(skills.keys())
    skills = _with_default_skills(skills)
    if order is None:
        order = topological_sort(formulas)
    raw_results: dict[str, float] = {}

    for composite_key in order:
        formula = formulas[composite_key]
        factors = formula.get("factors", [])
        amplifiers = formula.get("amplifiers", [])

        # Fallback: swap in the fallback factor set only when EVERY skill in
        # when_missing is absent from the raw profile (all-or-nothing).
        fallback = formula.get("fallback")
        if fallback:
            when_missing = fallback.get("when_missing") or []
            if when_missing and all(k not in present_keys for k in when_missing):
                factors = fallback.get("factors", [])

        # Compute each factor's contribution.
        factor_values: list[float] = []
        for factor in factors:
            if factor["type"] == "skill":
                val = tier_value(skills, factor["key"], tier_values)
            elif factor["type"] == "composite":
                val = raw_results.get(factor["key"], 0.0)
            else:
                val = 0.0
            factor_values.append(factor["coefficient"] * val)

        # Apply amplifiers.
        for amp in amplifiers:
            source_val = _resolve_amplifier_source(amp, skills, tier_values, raw_results)
            mult = max(amp["floor"], amp["floor"] + amp["scale"] * source_val)

            applies_to = amp.get("applies_to")
            if applies_to is None:
                # Multiply entire sum.
                factor_values = [v * mult for v in factor_values]
            else:
                # Multiply only specified factor indices.
                for idx in applies_to:
                    if 0 <= idx < len(factor_values):
                        factor_values[idx] *= mult

        raw_results[composite_key] = sum(factor_values)

    return raw_results
