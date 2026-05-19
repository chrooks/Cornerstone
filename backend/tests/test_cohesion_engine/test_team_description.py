"""
Tests for Phase 6 cohesion-engine team narratives.
"""

from __future__ import annotations

from types import SimpleNamespace

from backend.services.cohesion_engine import team_description
from backend.services.cohesion_engine.types import LineupCohesion, Note, PlayerComposites, RosterEvaluation


def make_composite(
    player_id: str,
    name: str,
    *,
    spacing: float = 0.0,
    paint_touch: float = 0.0,
    shot_creation: float = 0.0,
    transition: float = 0.0,
    perimeter_defense: float = 0.0,
    interior_defense: float = 0.0,
) -> PlayerComposites:
    return PlayerComposites(
        player_id=player_id,
        name=name,
        spacing=spacing,
        finishing=paint_touch,
        paint_touch=paint_touch,
        post_game=0.0,
        pnr_screener=0.0,
        off_ball_impact=0.0,
        shot_creation=shot_creation,
        ball_security=0.0,
        defensive_rebounding=0.0,
        offensive_rebounding=0.0,
        transition=transition,
        perimeter_defense=perimeter_defense,
        interior_defense=interior_defense,
        bell_amplitude=0.0,
        bell_peak=78,
        bell_range_down=0,
        bell_range_up=0,
        bell_flat_down=0,
        bell_flat_up=0,
    )


def make_evaluation() -> RosterEvaluation:
    return RosterEvaluation(
        star_rating=4.1,
        star_breakdown={
            "starting_5": 0.8,
            "depth": 0.7,
            "archetype_diversity": 0.75,
            "floor": 0.6,
        },
        starting_lineup=LineupCohesion(
            score=3.9,
            subscores={
                "spacing_creation_ratio": 8.6,
                "paint_touch_total": 7.1,
                "defensive_coverage": 6.8,
                "rebounding": 2.2,
                "defensive_gaps": 1.4,
            },
            synergies_applied=["OFF-28", "DEF-12"],
            accentuation_strength=2.0,
            accentuation_weakness=1.0,
        ),
        player_composites=[
            make_composite(
                "p1",
                "Ada Ace",
                spacing=8.9,
                shot_creation=8.2,
                transition=5.0,
            ),
            make_composite(
                "p2",
                "Blake Board",
                paint_touch=7.7,
                interior_defense=6.8,
            ),
        ],
        lineup_summary={
            "total_lineups": 1,
            "viable_lineups": 1,
            "median_score": 3.9,
            "archetype_labels": ["offensive", "defensive"],
        },
        notes=[
            Note(
                type="weakness",
                category="rebounding",
                severity=0.8,
                raw_value=2.2,
                text="The group needs another glass presence.",
            )
        ],
        team_description=None,
    )


class FakeAnthropic:
    last_instance: "FakeAnthropic | None" = None

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.messages = SimpleNamespace(create=self.create)
        self.calls: list[dict] = []
        FakeAnthropic.last_instance = self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            content=[SimpleNamespace(text="This roster has a clear identity.")]
        )


def test_build_prompt_uses_composites_subscores_archetypes_and_notes():
    evaluation = make_evaluation()
    players = [
        {"id": "p1", "name": "Ada Ace", "slot": 1},
        {"id": "p2", "name": "Blake Board", "slot": 6},
    ]

    prompt = team_description._build_prompt(evaluation, players)

    assert "Ada Ace (starter): spacing (elite), shot creation (elite)" in prompt
    assert "Blake Board (bench): finishing (strong), rim pressure (strong), interior defense (strong)" in prompt
    assert "Roster archetypes: offensive, defensive" in prompt
    assert "Starting-lineup synergies: OFF-28, DEF-12" in prompt
    assert "spacing-to-creation balance: elite" in prompt
    assert "defensive gap management: missing" in prompt
    assert "weakness / rebounding: The group needs another glass presence." in prompt
    assert "8.9" not in prompt
    assert "4.1" not in prompt


def test_build_prompt_requires_first_sentence_saved_team_card_summary():
    prompt = team_description._build_prompt(make_evaluation())

    assert "Start with exactly one standalone summary sentence suitable for a Saved Team card." in prompt
    assert "After that first sentence, continue with the longer evaluation detail." in prompt


def test_generate_team_description_calls_anthropic_with_expected_model(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(team_description.anthropic, "Anthropic", FakeAnthropic)

    result = team_description.generate_team_description(make_evaluation())

    assert result == "This roster has a clear identity."
    fake_client = FakeAnthropic.last_instance
    assert fake_client is not None
    assert fake_client.api_key == "test-key"
    call = fake_client.calls[0]
    assert call["model"] == team_description._HAIKU_MODEL
    assert call["max_tokens"] == team_description._MAX_TOKENS
    assert call["messages"][0]["role"] == "user"
    assert "Player composite identities" in call["messages"][0]["content"]


def test_generate_team_description_returns_none_without_api_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    result = team_description.generate_team_description(make_evaluation())

    assert result is None


def test_generate_team_description_returns_none_on_api_failure(monkeypatch):
    class FailingAnthropic:
        def __init__(self, api_key: str):
            self.messages = SimpleNamespace(create=self.create)

        def create(self, **kwargs):
            raise RuntimeError("API unavailable")

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(team_description.anthropic, "Anthropic", FailingAnthropic)

    result = team_description.generate_team_description(make_evaluation())

    assert result is None


def test_generate_team_description_returns_none_for_empty_response(monkeypatch):
    class EmptyAnthropic:
        def __init__(self, api_key: str):
            self.messages = SimpleNamespace(create=self.create)

        def create(self, **kwargs):
            return SimpleNamespace(content=[])

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(team_description.anthropic, "Anthropic", EmptyAnthropic)

    result = team_description.generate_team_description(make_evaluation())

    assert result is None
