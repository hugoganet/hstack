"""Walk hstack artifacts and parse their YAML frontmatter."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterator

try:
    import yaml
except ImportError:
    yaml = None


FRONTMATTER_DELIM = "---"


def _split_frontmatter(text: str) -> tuple[dict, str]:
    """Return (frontmatter_dict, body_text). Empty dict if no frontmatter."""
    if not text.startswith(FRONTMATTER_DELIM):
        return {}, text
    parts = text.split(FRONTMATTER_DELIM, 2)
    if len(parts) < 3:
        return {}, text
    raw = parts[1]
    body = parts[2].lstrip("\n")
    if yaml is None:
        return _parse_simple_yaml(raw), body
    try:
        loaded = yaml.safe_load(raw) or {}
        if not isinstance(loaded, dict):
            return {}, body
        return loaded, body
    except yaml.YAMLError:
        return _parse_simple_yaml(raw), body


def _coerce_scalar(value: str):
    value = value.strip()
    if not value:
        return None
    if value.startswith('"') and value.endswith('"'):
        return value[1:-1]
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1]
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        return [_coerce_scalar(v) for v in _split_inline_list(inner)]
    if value.startswith("{") and value.endswith("}"):
        # inline dict — rare in hstack frontmatter; treat as string fallback
        return value
    lower = value.lower()
    if lower in ("true", "false"):
        return lower == "true"
    if lower in ("null", "~"):
        return None
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        pass
    return value


def _split_inline_list(inner: str) -> list[str]:
    """Split a comma-separated inline list, respecting nested brackets."""
    out = []
    depth = 0
    current = []
    for ch in inner:
        if ch in "[{":
            depth += 1
            current.append(ch)
        elif ch in "]}":
            depth -= 1
            current.append(ch)
        elif ch == "," and depth == 0:
            out.append("".join(current).strip())
            current = []
        else:
            current.append(ch)
    if current:
        out.append("".join(current).strip())
    return out


def _indent_of(line: str) -> int:
    n = 0
    for ch in line:
        if ch == " ":
            n += 1
        else:
            break
    return n


def _parse_simple_yaml(raw: str) -> dict:
    """Indent-aware fallback parser for the YAML subset hstack frontmatter uses:
    top-level scalars, top-level inline arrays, nested dicts (one level),
    and arrays of dicts (one level). Sufficient for every artifact template.
    """
    lines = [ln for ln in raw.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    out: dict = {}
    i = 0
    while i < len(lines):
        line = lines[i]
        if _indent_of(line) != 0 or ":" not in line:
            i += 1
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value_inline = value.strip()
        if value_inline:
            out[key] = _coerce_scalar(value_inline)
            i += 1
            continue
        # Multi-line value; look at next-line indent and shape
        if i + 1 >= len(lines):
            out[key] = None
            break
        nxt = lines[i + 1]
        nxt_indent = _indent_of(nxt)
        if nxt_indent == 0:
            out[key] = None
            i += 1
            continue
        if nxt.lstrip().startswith("- "):
            # Array — items may be inline scalars or block dicts.
            items, consumed = _parse_block_sequence(lines, i + 1, nxt_indent)
            out[key] = items
            i = i + 1 + consumed
        else:
            # Block mapping (nested dict)
            sub, consumed = _parse_block_mapping(lines, i + 1, nxt_indent)
            out[key] = sub
            i = i + 1 + consumed
    return out


def _parse_block_mapping(lines: list[str], start: int, base_indent: int) -> tuple[dict, int]:
    out: dict = {}
    i = start
    consumed = 0
    while i < len(lines):
        line = lines[i]
        ind = _indent_of(line)
        if ind < base_indent:
            break
        if ind > base_indent:
            i += 1
            consumed += 1
            continue
        stripped = line.strip()
        if ":" not in stripped:
            i += 1
            consumed += 1
            continue
        key, _, value = stripped.partition(":")
        key = key.strip()
        value_inline = value.strip()
        if value_inline:
            out[key] = _coerce_scalar(value_inline)
            i += 1
            consumed += 1
            continue
        # Possible nested structure — limited support: keep as None for now
        if i + 1 < len(lines) and _indent_of(lines[i + 1]) > base_indent:
            sub, sub_consumed = _parse_block_mapping(lines, i + 1, _indent_of(lines[i + 1]))
            out[key] = sub
            i = i + 1 + sub_consumed
            consumed += 1 + sub_consumed
        else:
            out[key] = None
            i += 1
            consumed += 1
    return out, consumed


def _parse_block_sequence(lines: list[str], start: int, base_indent: int) -> tuple[list, int]:
    items: list = []
    i = start
    consumed = 0
    while i < len(lines):
        line = lines[i]
        ind = _indent_of(line)
        if ind < base_indent:
            break
        stripped = line.strip()
        if not stripped.startswith("- "):
            # Continuation of previous item that we already consumed
            i += 1
            consumed += 1
            continue
        rest = stripped[2:]
        if ":" in rest:
            # First key of an inline dict item; merge any indented continuation
            key, _, value = rest.partition(":")
            item: dict = {key.strip(): _coerce_scalar(value)}
            i += 1
            consumed += 1
            # Continuation lines at indent > base_indent (e.g. base_indent + 4)
            while i < len(lines):
                cont = lines[i]
                cont_ind = _indent_of(cont)
                if cont_ind <= base_indent:
                    break
                cont_stripped = cont.strip()
                if cont_stripped.startswith("- "):
                    break
                if ":" in cont_stripped:
                    k, _, v = cont_stripped.partition(":")
                    item[k.strip()] = _coerce_scalar(v)
                i += 1
                consumed += 1
            items.append(item)
        else:
            items.append(_coerce_scalar(rest))
            i += 1
            consumed += 1
    return items, consumed


def _parse_simple_yaml_old(raw: str) -> dict:
    """Deprecated — retained for the smoke-test fallback path. Not exported."""
    out: dict = {}
    for line in raw.splitlines():
        line = line.split("#", 1)[0].rstrip()
        if not line or ":" not in line or line.startswith((" ", "\t")):
            continue
        key, _, value = line.partition(":")
        out[key.strip()] = _coerce_scalar(value)
    return out


def read_artifact(path: Path) -> tuple[dict, str] | None:
    """Read one artifact file. Returns (frontmatter, body) or None on error."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    return _split_frontmatter(text)


def walk_artifacts(hstack_root: Path, pattern: str) -> Iterator[tuple[Path, dict, str]]:
    """Yield (path, frontmatter, body) for every file under hstack_root matching pattern.

    pattern is a glob relative to hstack_root, e.g. 'specs/changes/*/spec.md'.
    """
    for p in sorted(hstack_root.glob(pattern)):
        if not p.is_file():
            continue
        parsed = read_artifact(p)
        if parsed is None:
            continue
        fm, body = parsed
        yield p, fm, body


def load_change_artifacts(hstack_root: Path) -> dict[str, dict]:
    """For every change folder under hstack/specs/changes/, load every artifact's
    frontmatter. Returns {change_id: {artifact_type: {path, fm, body}}}."""
    out: dict[str, dict] = {}
    changes_dir = hstack_root / "specs" / "changes"
    if not changes_dir.is_dir():
        return out
    for change_dir in sorted(changes_dir.iterdir()):
        if not change_dir.is_dir():
            continue
        change_id = change_dir.name
        bucket: dict[str, dict] = {}
        for f in sorted(change_dir.iterdir()):
            if not f.is_file() or not f.name.endswith(".md"):
                continue
            parsed = read_artifact(f)
            if parsed is None:
                continue
            fm, body = parsed
            atype = fm.get("type") or f.stem
            bucket[atype] = {"path": f, "fm": fm, "body": body}
        if bucket:
            out[change_id] = bucket
    return out


def load_tech_debt(hstack_root: Path) -> list[dict]:
    """Load every tech-debt artifact's frontmatter + body."""
    out = []
    for path, fm, body in walk_artifacts(hstack_root, "tech-debt/*.md"):
        out.append({"path": path, "fm": fm, "body": body})
    return out


def load_adrs(hstack_root: Path) -> list[dict]:
    out = []
    for path, fm, body in walk_artifacts(hstack_root, "adr/ADR-*.md"):
        out.append({"path": path, "fm": fm, "body": body})
    return out


def load_module_specs(hstack_root: Path) -> list[dict]:
    """Module specs live at hstack/specs/<module>/spec.md (excluding changes/)."""
    out = []
    specs_dir = hstack_root / "specs"
    if not specs_dir.is_dir():
        return out
    for module_dir in sorted(specs_dir.iterdir()):
        if not module_dir.is_dir() or module_dir.name == "changes":
            continue
        spec = module_dir / "spec.md"
        if not spec.is_file():
            continue
        parsed = read_artifact(spec)
        if parsed is None:
            continue
        fm, body = parsed
        out.append({"path": spec, "fm": fm, "body": body, "module": module_dir.name})
    return out
