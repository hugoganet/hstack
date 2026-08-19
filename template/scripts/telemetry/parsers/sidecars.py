"""Load the per-change telemetry sidecars written by the five emitting Skills.

Sidecars live at `hstack/specs/changes/<change-id>/.telemetry/*.json` and are
derivative, gitignored, and never authoritative (ADR-0001). This parser only
reads them; a malformed or absent sidecar is skipped, never repaired.

Schema versions (see `templates/telemetry-sidecar.md`):
  1 — no phase window. Reads as *unmeasured*: `phase_usage` returns None.
  2 — carries `session_id`, `phase_opened_at`, `phase_closed_at` (ADR-0009).
"""

from __future__ import annotations

import json
from pathlib import Path


def load_sidecars(hstack_root: Path) -> list[dict]:
    """Every sidecar under every change folder, sorted by change then filename.

    Each entry: {path, change_id, file, skill, phase_id, schema_version, data}.
    `skill` and `phase_id` fall back to the filename when the payload omits them
    (`implement-<phase-id>.json`), so a hand-truncated sidecar still groups.
    """
    out: list[dict] = []
    changes_dir = hstack_root / "specs" / "changes"
    if not changes_dir.is_dir():
        return out
    for change_dir in sorted(changes_dir.iterdir()):
        if not change_dir.is_dir():
            continue
        telemetry_dir = change_dir / ".telemetry"
        if not telemetry_dir.is_dir():
            continue
        for f in sorted(telemetry_dir.glob("*.json")):
            data = _read_json(f)
            if data is None:
                continue
            stem = f.stem
            skill = data.get("skill") or f"hstack-{stem.split('-')[0]}"
            phase_id = data.get("phase_id")
            if phase_id is None and stem.startswith("implement-"):
                phase_id = stem[len("implement-"):]
            out.append({
                "path": f,
                "file": f.name,
                "change_id": data.get("change_id") or change_dir.name,
                "skill": skill,
                "phase_id": phase_id,
                "schema_version": data.get("schema_version"),
                "data": data,
            })
    return out


def _read_json(path: Path) -> dict | None:
    try:
        loaded = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, json.JSONDecodeError):
        return None
    return loaded if isinstance(loaded, dict) else None
