#!/usr/bin/env python3
"""Fixture tests for the ADR-0009 telemetry parsers. No dependencies, no pytest.

    python3 scripts/test-telemetry-parsers.py

Covers the two pieces that have a contract rather than a shape:
  - `transcripts.phase_usage` — bounded summation, and null (never zero) on a
    missing transcript, a null session id, or a pre-ADR-0009 sidecar.
  - `transcripts.classify_session` — structured markers only; prose that merely
    names a Skill classifies as unattributed.

The dev repo is not a consumer (no `hstack/` tree), so these fixtures are the
only place the parsers run against known-answer input. The counterpart check is
running `report.py` against a real consuming repo.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "template" / "scripts"))

from telemetry.parsers import sidecars as S  # noqa: E402
from telemetry.parsers import transcripts as T  # noqa: E402
from telemetry import session_id as SID  # noqa: E402


FAILURES: list[str] = []


def check(label: str, actual, expected) -> None:
    if actual == expected:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}\n         expected: {expected!r}\n         actual:   {actual!r}")
        FAILURES.append(label)


def assistant(ts: str, inp: int, cc: int, cr: int, out: int) -> dict:
    return {
        "type": "assistant",
        "timestamp": ts,
        "message": {
            "role": "assistant",
            "usage": {
                "input_tokens": inp,
                "cache_creation_input_tokens": cc,
                "cache_read_input_tokens": cr,
                "output_tokens": out,
            },
        },
    }


def write_transcript(root: Path, session: str, records: list[dict]) -> Path:
    d = root / "-Users-jane-code-moso"
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{session}.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in records) + "\n", encoding="utf-8")
    return path


# --------------------------------------------------------------------------
# phase_usage
# --------------------------------------------------------------------------

def test_phase_usage(root: Path) -> None:
    print("phase_usage")
    session = "062b8fe8-649f-4d73-b4fb-b0a28a800552"
    write_transcript(root, session, [
        # before the window — excluded
        assistant("2026-08-15T09:00:00.000Z", 100, 100, 100, 100),
        # inside — counted
        assistant("2026-08-15T09:30:00.000Z", 10, 20, 30, 40),
        assistant("2026-08-15T10:15:30.000Z", 1, 2, 3, 4),
        # a user record inside the window carries no usage — not a turn
        {"type": "user", "timestamp": "2026-08-15T10:20:00.000Z",
         "message": {"role": "user", "content": "hi"}},
        # exactly on the closing bound — counted (closed interval)
        assistant("2026-08-15T11:03:07.000Z", 1000, 0, 0, 0),
        # after the window — excluded
        assistant("2026-08-15T11:04:00.000Z", 500, 500, 500, 500),
    ])
    sidecar = {
        "schema_version": 2,
        "skill": "hstack-implement",
        "change_id": "2026-08-phase-instrumentation",
        "session_id": session,
        "phase_opened_at": "2026-08-15T09:12:44Z",
        "phase_closed_at": "2026-08-15T11:03:07Z",
    }
    usage = T.phase_usage(sidecar, projects_root=root)
    check("sums only turns inside the window", usage["total_tokens"], 1110)
    check("input_tokens bounded", usage["input_tokens"], 1011)
    check("cache_creation bounded", usage["cache_creation_input_tokens"], 22)
    check("cache_read bounded", usage["cache_read_input_tokens"], 33)
    check("output bounded", usage["output_tokens"], 44)
    check("turns counts assistant records only", usage["turns"], 3)
    check("wall clock is the window, not the turns", usage["wall_clock_s"], 6623.0)

    check("null session_id → unmeasured",
          T.phase_usage({**sidecar, "session_id": None}, projects_root=root), None)
    check("missing transcript → unmeasured",
          T.phase_usage({**sidecar, "session_id": "no-such-session"}, projects_root=root), None)
    check("fallback session id → unmeasured",
          T.phase_usage({**sidecar, "session_id": "fallback-a3f9"}, projects_root=root), None)
    check("no phase window (schema_version 1) → unmeasured",
          T.phase_usage({"schema_version": 1, "session_id": session}, projects_root=root), None)
    check("half-open window → unmeasured",
          T.phase_usage({**sidecar, "phase_closed_at": None}, projects_root=root), None)
    check("inverted window → unmeasured",
          T.phase_usage({**sidecar, "phase_closed_at": "2026-08-15T08:00:00Z"},
                        projects_root=root), None)
    check("unparseable stamp → unmeasured",
          T.phase_usage({**sidecar, "phase_opened_at": "yesterday"}, projects_root=root), None)
    check("empty window on a real transcript is zero, not null",
          T.phase_usage({**sidecar,
                         "phase_opened_at": "2026-08-15T12:00:00Z",
                         "phase_closed_at": "2026-08-15T12:30:00Z"},
                        projects_root=root)["total_tokens"], 0)


# --------------------------------------------------------------------------
# classify_session
# --------------------------------------------------------------------------

def user_text(text: str) -> dict:
    return {"type": "user", "timestamp": "2026-08-15T09:00:00Z",
            "message": {"role": "user", "content": text}}


def assistant_skill(name: str) -> dict:
    return {"type": "assistant", "timestamp": "2026-08-15T09:01:00Z",
            "message": {"role": "assistant", "content": [
                {"type": "tool_use", "id": "t1", "name": "Skill", "input": {"skill": name}}]}}


def test_classify_session() -> None:
    print("classify_session")
    prose = user_text("Run `/hstack:coord` at session start, then fix the billing banner.")
    check("prose naming a Skill does not attribute",
          T.classify_session([prose])[0], None)
    check("hook pointer line does not attribute",
          T.classify_session([user_text("HSTACK-COORD: 2 unread coordination message(s) — /hstack:coord")])[0],
          None)
    check("<command-name> tag attributes",
          T.classify_session([user_text("<command-name>/hstack-init</command-name>")])[0], "init")
    check("colon spelling of the tag attributes",
          T.classify_session([user_text("<command-name>/hstack:verify</command-name>")])[0], "verify")
    check("Skill tool_use attributes",
          T.classify_session([prose, assistant_skill("hstack-implement")])[0], "implement")
    check("plugin-namespaced Skill attributes",
          T.classify_session([assistant_skill("hstack:adversarial-review")])[0], "adversarial-review")
    check("non-hstack Skill does not attribute",
          T.classify_session([assistant_skill("Melvyn:commit")])[0], None)
    check("first structured marker wins",
          T.classify_session([assistant_skill("hstack-test-plan"), assistant_skill("hstack-verify")])[0],
          "test-plan")
    subagents = T.classify_session([
        {"type": "assistant", "timestamp": "2026-08-15T09:02:00Z",
         "message": {"role": "assistant", "content": [
             {"type": "tool_use", "name": "Task", "input": {"subagent_type": "implementer"}}]}}])[1]
    check("subagent detection unchanged", sorted(subagents), ["implementer"])


# --------------------------------------------------------------------------
# sidecar loading + session-id resolution
# --------------------------------------------------------------------------

def test_sidecars(root: Path) -> None:
    print("load_sidecars")
    hstack_root = root / "hstack"
    change = hstack_root / "specs" / "changes" / "2026-08-phase-instrumentation" / ".telemetry"
    change.mkdir(parents=True)
    (change / "implement-phase-3-component.json").write_text(json.dumps({
        "schema_version": 2, "skill": "hstack-implement",
        "change_id": "2026-08-phase-instrumentation",
        "session_id": None, "phase_opened_at": None, "phase_closed_at": None,
    }), encoding="utf-8")
    (change / "verify.json").write_text("{ not json", encoding="utf-8")
    loaded = S.load_sidecars(hstack_root)
    check("malformed sidecar is skipped, not fatal", len(loaded), 1)
    check("phase id falls back to the filename", loaded[0]["phase_id"], "phase-3-component")
    check("change id resolves", loaded[0]["change_id"], "2026-08-phase-instrumentation")
    check("no sidecars in an empty tree", S.load_sidecars(root / "nope"), [])


def test_session_id(root: Path) -> None:
    print("session_id")
    check("encoded cwd", SID.encoded_cwd("/tmp"), str(Path("/tmp").resolve()).replace("/", "-"))
    check("unresolvable session is null, not a guess",
          SID.resolve_session(cwd="/nonexistent-dir-xyz", projects_root=root)["session_id"], None)
    check("transcript lookup by unknown id is null",
          SID.transcript_for_session("no-such-session", projects_root=root), None)
    check("null session id is null", SID.transcript_for_session(None, projects_root=root), None)
    stamp = SID.utc_now_iso()
    check("timestamp format is sidecar-shaped",
          (len(stamp), stamp[4], stamp[10], stamp[-1]), (20, "-", "T", "Z"))


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        test_phase_usage(root)
        test_classify_session()
        test_sidecars(root)
        test_session_id(root)
    print()
    if FAILURES:
        print(f"{len(FAILURES)} failure(s): " + ", ".join(FAILURES))
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
