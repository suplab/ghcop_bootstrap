"""Composable packs — dependency expansion + conflict detection (eeik/packs.py)."""

from __future__ import annotations

import eeik
from eeik import packs
from eeik.packs import detect_conflicts, expand_dependencies, resolve_packs


def _resolve(**parts) -> list[str]:
    manifest = {
        "schema_version": "1.0",
        "project": {"name": "svc", "domain": "generic", "project_type": "greenfield"},
        "technology": {"backend": {"language": "java"}},
    }
    manifest.update(parts)
    return resolve_packs(manifest, {})


# ── dependency expansion ─────────────────────────────────────────────────────────

def test_expand_pulls_transitive_dependencies():
    existing = {p.name for p in packs.PACKS_DIR.iterdir() if p.is_dir()}
    # agent-harness → ai-engineering, governance; ai-engineering → architecture
    expanded = expand_dependencies({"agent-harness"}, existing)
    assert {"agent-harness", "ai-engineering", "governance", "architecture"} <= expanded


def test_expand_is_a_noop_for_a_pack_without_dependencies():
    existing = {p.name for p in packs.PACKS_DIR.iterdir() if p.is_dir()}
    # core declares no `dependencies:` list — nothing extra is pulled in.
    assert expand_dependencies({"core"}, existing) == {"core"}


def test_expand_skips_absent_dependencies():
    # A declared dependency that is not on disk is not added (default-deny).
    assert expand_dependencies({"agent-harness"}, {"agent-harness"}) == {"agent-harness"}


# ── resolution honours dependencies (trigger mode) ───────────────────────────────

def test_ai_agent_pulls_in_governance_dependency():
    # AI enabled with a basic governance profile: the agent-harness pack's declared
    # dependency on governance is now pulled in even though the profile didn't trigger it.
    packs_out = _resolve(ai={"enabled": True, "pattern": "multi-agent"},
                         governance={"profile": "basic"})
    assert "agent-harness" in packs_out
    assert "governance" in packs_out        # pulled in as a dependency
    assert "ai-engineering" in packs_out


def test_explicit_mode_is_not_expanded():
    # Explicit mode is honoured exactly — java's architecture dependency is NOT pulled in.
    packs_out = _resolve(capability_packs={"explicit": True, "include": ["core", "java"]})
    assert set(packs_out) == {"core", "java"}


def test_exclude_wins_over_a_pulled_in_dependency():
    packs_out = _resolve(ai={"enabled": True, "pattern": "multi-agent"},
                         governance={"profile": "basic"},
                         capability_packs={"exclude": ["governance"]})
    assert "agent-harness" in packs_out
    assert "governance" not in packs_out    # an explicit exclude vetoes the dependency


# ── conflict detection ───────────────────────────────────────────────────────────

def test_no_conflicts_declared_in_shipped_content():
    # No shipped pack declares a `conflicts:`, so a fully-resolved set is conflict-free.
    resolved = _resolve(ai={"enabled": True, "pattern": "multi-agent"},
                        governance={"profile": "regulated"})
    assert detect_conflicts(resolved) == []


def test_detect_conflicts_reports_declared_pairs(monkeypatch):
    # Synthetic: pretend java and python declare a mutual conflict.
    def fake_relations(pack_name: str, key: str):
        if key != "conflicts":
            return []
        return {"java": ["python"], "python": ["java"]}.get(pack_name, [])

    monkeypatch.setattr(packs, "_pack_relations", fake_relations)
    assert detect_conflicts(["core", "java", "python"]) == [("java", "python")]
    # only-one-side-present → no conflict
    assert detect_conflicts(["core", "java"]) == []


def test_sdk_pack_conflicts_surface():
    conflicts = eeik.pack_conflicts(manifest={
        "schema_version": "1.0",
        "project": {"name": "svc", "domain": "generic", "project_type": "greenfield"},
        "technology": {"backend": {"language": "java"}},
        "ai": {"enabled": True, "pattern": "multi-agent"},
    })
    assert conflicts == []
