#!/usr/bin/env python3
"""hstack-coord — pull-based cross-session / cross-repo coordination scan.

Usage:
    python3 hstack/scripts/coord/coord_scan.py [scan] [--horizon-days N]
    python3 hstack/scripts/coord/coord_scan.py hook
    python3 hstack/scripts/coord/coord_scan.py ack <id> [<id> ...]
    python3 hstack/scripts/coord/coord_scan.py ack --all
    python3 hstack/scripts/coord/coord_scan.py register [--name N] [--path P]
    python3 hstack/scripts/coord/coord_scan.py peers

`scan` (the default) walks every local branch of this repo plus every
registered peer repo's local branches for committed coord-messages
(hstack/coord/messages/*.md) addressed to this repo, filters out acked /
expired / own-sent messages, and prints one line per new message. Silent
with exit 0 when there is nothing — the zero-cost path.

`hook` is the Claude Code hook entry point (SessionStart / UserPromptSubmit,
per ADR-0007 in the hstack dev repo): the same scan, but the output contract
is hook-shaped — a single count-only pointer line when new messages exist
(hook stdout is injected into the session's context), silence otherwise,
and exit 0 no matter what: a coordination failure must never break the
engineer's prompt. Peer-authored content (subjects, ids, bodies) is
deliberately NOT printed by `hook`; surfacing stays in /hstack:coord,
frontmatter-first, per CM-03.

Authoritative state is ONLY committed files (see ADR-0006 in the hstack dev
repo): the messages themselves, and the repo's canonical identity at
hstack/coord/NAME (a committed one-line file — the string senders address
with `to-repo` and receivers filter on; registry names are machine-local
aliases that can diverge between machines and MUST NOT be relied on for
addressing). The two local files this script touches are never authoritative:

    ~/.hstack/registry.yaml              machine config: name -> path -> default-branch
    hstack/.session-state/coord-cursor   per-worktree acked-id list, shared by all
                                         sessions in that worktree (derivative; losing
                                         it re-surfaces messages — at-least-once)
    hstack/.session-state/coord-scan-cache.json
                                         per-worktree scan cache keyed on a refs-state
                                         fingerprint (derivative; losing it costs one
                                         full branch walk). Messages only appear via
                                         commits and commits only move refs, so an
                                         unchanged fingerprint proves the walk would
                                         find the same set — the cache never changes
                                         WHAT surfaces, only how fast.
    hstack/.telemetry/coord/events.jsonl per-worktree usage log (gitignored via the
                                         consumer's `**/.telemetry/` line; measurement
                                         only, never authoritative, safe to delete)

No network calls. Reads git only via `git show` / `git ls-tree` /
`git for-each-ref` — committed state, never a peer's working tree.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

MESSAGES_DIR = "hstack/coord/messages"
NAME_RELPATH = "hstack/coord/NAME"
CURSOR_RELPATH = "hstack/.session-state/coord-cursor"
CACHE_RELPATH = "hstack/.session-state/coord-scan-cache.json"
TELEMETRY_RELPATH = "hstack/.telemetry/coord/events.jsonl"
DEFAULT_HORIZON_DAYS = 30
# Cursor entries older than twice the default horizon are pruned on ack.
CURSOR_PRUNE_DAYS = DEFAULT_HORIZON_DAYS * 2
ID_TS_RE = re.compile(r"^msg-(\d{8}T\d{6})-")


def registry_path() -> Path:
    override = os.environ.get("HSTACK_REGISTRY")
    if override:
        return Path(override)
    return Path.home() / ".hstack" / "registry.yaml"


# ---------------------------------------------------------------- git helpers


def run_git(args: list[str], cwd: str | None = None) -> str:
    out = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.strip()


def try_git(args: list[str], cwd: str | None = None) -> str | None:
    try:
        return run_git(args, cwd=cwd)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def repo_root() -> str:
    root = try_git(["rev-parse", "--show-toplevel"])
    if not root:
        print("hstack-coord: not inside a git repository", file=sys.stderr)
        sys.exit(1)
    return root


def main_worktree(path: str) -> str:
    """Resolve the main working tree for `path` (stable across worktrees)."""
    common = try_git(
        ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd=path
    )
    if common and common.endswith("/.git"):
        return str(Path(common).parent)
    # Bare repo or unusual layout — fall back to the worktree itself.
    return try_git(["rev-parse", "--show-toplevel"], cwd=path) or path


def local_branches(path: str) -> list[str]:
    out = try_git(["for-each-ref", "--format=%(refname:short)", "refs/heads"], cwd=path)
    return [b for b in (out or "").splitlines() if b]


def list_message_paths(path: str, branch: str) -> list[str]:
    out = try_git(
        ["ls-tree", "-r", "--name-only", branch, "--", MESSAGES_DIR], cwd=path
    )
    return [p for p in (out or "").splitlines() if p.endswith(".md")]


def show_file(path: str, branch: str, relpath: str) -> str | None:
    return try_git(["show", f"{branch}:{relpath}"], cwd=path)


# ------------------------------------------------------------- frontmatter


def parse_frontmatter(text: str) -> dict[str, str | None]:
    """Minimal flat `key: value` frontmatter parser (stdlib only)."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    fm: dict[str, str | None] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if ":" not in line or line.startswith((" ", "\t", "#")):
            continue
        key, _, raw = line.partition(":")
        value = raw.split(" #", 1)[0].strip().strip("'\"")
        fm[key.strip()] = None if value in ("", "null", "~") else value
    return fm


# ---------------------------------------------------------------- registry


def load_registry() -> list[dict[str, str]]:
    path = registry_path()
    if not path.exists():
        return []
    repos: list[dict[str, str]] = []
    cur: dict[str, str] | None = None
    for raw in path.read_text().splitlines():
        s = raw.strip()
        if s.startswith("- name:"):
            cur = {"name": s.partition(":")[2].strip().strip("'\"")}
            repos.append(cur)
        elif cur is not None and s.startswith("path:"):
            cur["path"] = s.partition(":")[2].strip().strip("'\"")
        elif cur is not None and s.startswith("default-branch:"):
            cur["default-branch"] = s.partition(":")[2].strip().strip("'\"")
    return [r for r in repos if "path" in r]


def write_registry(repos: list[dict[str, str]]) -> None:
    path = registry_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["schema-version: 1", "repos:"]
    for r in repos:
        lines.append(f"  - name: {r['name']}")
        lines.append(f"    path: {r['path']}")
        lines.append(f"    default-branch: {r.get('default-branch', 'main')}")
    path.write_text("\n".join(lines) + "\n")


def resolve_self_name(root: str, self_main: str, registry: list[dict[str, str]]) -> str:
    """Canonical identity, in precedence order: the committed one-line file
    hstack/coord/NAME (the only source both sender and receiver can resolve
    to the same string), then this machine's registry entry, then basename."""
    name_file = Path(root) / NAME_RELPATH
    if name_file.is_file():
        first = name_file.read_text().strip().splitlines()
        if first and first[0].strip():
            return sanitize(first[0].strip(), 64)
    self_real = os.path.realpath(self_main)
    for r in registry:
        if os.path.realpath(r["path"]) == self_real:
            return r["name"]
    return os.path.basename(self_real)


# ------------------------------------------------------------------ cursor


def cursor_path(root: str) -> Path:
    return Path(root) / CURSOR_RELPATH


def load_acked(root: str) -> set[str]:
    p = cursor_path(root)
    if not p.exists():
        return set()
    return {line.strip() for line in p.read_text().splitlines() if line.strip()}


def id_timestamp(msg_id: str) -> datetime | None:
    m = ID_TS_RE.match(msg_id)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y%m%dT%H%M%S")
    except ValueError:
        return None


def write_acked(root: str, ids: set[str]) -> None:
    # Ids without a parseable timestamp are pruned too — the scan skips
    # malformed ids (fail-closed), so keeping them would grow the cursor forever.
    prune_before = datetime.now() - timedelta(days=CURSOR_PRUNE_DAYS)
    kept = sorted(
        i for i in ids if (ts := id_timestamp(i)) is not None and ts >= prune_before
    )
    p = cursor_path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    # Atomic replace: concurrent acks from parallel sessions in the same
    # worktree race last-write-wins, never a torn file. A lost ack merely
    # re-surfaces a message next scan (at-least-once).
    tmp = p.with_suffix(".tmp")
    tmp.write_text("\n".join(kept) + ("\n" if kept else ""))
    os.replace(tmp, p)


# --------------------------------------------------------- usage telemetry


def log_usage(root: str, event: str, **fields: object) -> None:
    """Append one usage event to the per-worktree JSONL log.

    Measurement only — same discipline as the `.telemetry/` sidecars:
    gitignored, never authoritative, safe to delete. Best-effort by
    contract: a telemetry failure must never fail the scan, and above all
    never fail the hook path that runs on every prompt.
    """
    try:
        path = Path(root) / TELEMETRY_RELPATH
        path.parent.mkdir(parents=True, exist_ok=True)
        record: dict[str, object] = {
            "schema_version": 1,
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "event": event,
            **fields,
        }
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass


# -------------------------------------------------------------------- scan


def sanitize(text: str, limit: int = 80) -> str:
    clean = "".join(ch for ch in text if ch.isprintable())
    return clean[:limit]


def sanitize_ref(text: str, limit: int = 60) -> str:
    """Identifier fields (ids, repo names, branch names) collapse to a strict
    ref charset — peer-authored punctuation/whitespace cannot mimic this
    tool's own output lines or smuggle shell syntax."""
    return re.sub(r"[^A-Za-z0-9._/-]", "_", text)[:limit]


def resolve_sources(self_name: str, self_main: str) -> list[tuple[str, str]]:
    """Scan sources: this repo plus every reachable registered peer."""
    registry = load_registry()
    sources: list[tuple[str, str]] = [(self_name, self_main)]
    self_real = os.path.realpath(self_main)
    for r in registry:
        if os.path.realpath(r["path"]) == self_real:
            continue
        if not Path(r["path"]).is_dir():
            print(
                f"hstack-coord: registered repo '{r['name']}' missing at {r['path']} — skipped",
                file=sys.stderr,
            )
            continue
        sources.append((r["name"], r["path"]))
    return sources


def collect_messages(
    self_name: str,
    self_main: str,
    current_branch: str,
    horizon_days: int,
    sources: list[tuple[str, str]] | None = None,
) -> list[dict[str, str]]:
    """Return unacked-agnostic candidate messages addressed to this repo."""
    if sources is None:
        sources = resolve_sources(self_name, self_main)

    horizon = datetime.now() - timedelta(days=horizon_days)
    seen_ids: set[str] = set()
    found: list[dict[str, str]] = []

    for source_name, source_path in sources:
        for branch in local_branches(source_path):
            for relpath in list_message_paths(source_path, branch):
                msg_id = Path(relpath).stem
                if msg_id in seen_ids:
                    continue
                ts = id_timestamp(msg_id)
                if ts is None:
                    # Fail closed: an id outside the msg-<ts>-... contract is
                    # skipped, not surfaced — it would bypass the horizon and
                    # pin the cursor forever.
                    print(
                        f"hstack-coord: skipping malformed message id '{sanitize(msg_id, 60)}' "
                        f"on {sanitize(source_name, 40)}:{sanitize(branch, 60)}",
                        file=sys.stderr,
                    )
                    continue
                if ts < horizon:
                    continue
                body = show_file(source_path, branch, relpath)
                if body is None:
                    continue
                fm = parse_frontmatter(body)
                if fm.get("type") != "coord-message":
                    continue
                if fm.get("to-repo") != self_name:
                    continue
                to_branch = fm.get("to-branch")
                if to_branch is not None and to_branch != current_branch:
                    continue
                # Own-sent: never surface a message to the session that wrote it.
                if source_name == self_name and fm.get("from-branch") == current_branch:
                    continue
                expires = fm.get("expires")
                if expires is not None:
                    try:
                        if date.fromisoformat(expires) < date.today():
                            continue
                    except ValueError:
                        # Fail closed: a malformed expiry means the sender's
                        # intent is unknowable — skip rather than surface forever.
                        print(
                            f"hstack-coord: skipping '{sanitize(msg_id, 60)}' — malformed expires",
                            file=sys.stderr,
                        )
                        continue
                seen_ids.add(msg_id)
                # Every frontmatter-derived field below is peer-authored
                # (untrusted) — sanitize before it can reach a session's context:
                # identifiers collapse to a strict ref charset, free text is
                # printable-only and quote-delimited at print time.
                found.append(
                    {
                        "id": sanitize_ref(msg_id, 80),
                        "from-repo": sanitize_ref(fm.get("from-repo") or source_name, 40),
                        "from-branch": sanitize_ref(fm.get("from-branch") or branch, 60),
                        "subject": sanitize(fm.get("subject") or "(no subject)"),
                        "source-path": source_path,
                        "source-branch": branch,
                        "relpath": relpath,
                    }
                )
    found.sort(key=lambda m: m["id"])
    return found


# -------------------------------------------------------- refs-state cache


def scan_fingerprint(
    sources: list[tuple[str, str]],
    self_name: str,
    current_branch: str,
    horizon_days: int,
) -> str:
    """Fingerprint of everything the branch walk's result depends on.

    Messages exist only as committed files, and commits only become visible
    by moving a ref — so if no local ref of any source repo moved, the walk
    would return byte-identical results. The remaining inputs (identity,
    branch, horizon, and today's date for the expires/horizon filters) are
    folded in; the date term bounds cache lifetime at one day.

    The cursor (ack state) is deliberately NOT part of the fingerprint —
    acked-filtering happens after collection, so acks never require a
    re-walk.
    """
    parts = [
        "schema=1",
        f"self={self_name}",
        f"branch={current_branch}",
        f"horizon={horizon_days}",
        f"date={date.today().isoformat()}",
    ]
    for name, path in sources:
        refs = try_git(
            ["for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads"],
            cwd=path,
        )
        parts.append(f"repo={name}:{os.path.realpath(path)}\n{refs or ''}")
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def collect_messages_cached(
    root: str,
    self_name: str,
    self_main: str,
    current_branch: str,
    horizon_days: int,
) -> tuple[list[dict[str, str]], bool]:
    """collect_messages behind the refs-state cache.

    Returns (messages, cache_hit). The cache is derivative in the strict
    sense: deleting it costs one full branch walk and changes nothing else.
    Corrupt or mismatched cache falls through to a full walk (fail open to
    the slow-but-correct path).
    """
    sources = resolve_sources(self_name, self_main)
    fingerprint = scan_fingerprint(sources, self_name, current_branch, horizon_days)
    cache_file = Path(root) / CACHE_RELPATH
    try:
        cached = json.loads(cache_file.read_text())
        if (
            cached.get("schema_version") == 1
            and cached.get("fingerprint") == fingerprint
            and isinstance(cached.get("messages"), list)
        ):
            return cached["messages"], True
    except Exception:
        pass
    found = collect_messages(
        self_name, self_main, current_branch, horizon_days, sources=sources
    )
    try:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        tmp = cache_file.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(
                {"schema_version": 1, "fingerprint": fingerprint, "messages": found},
                ensure_ascii=False,
            )
        )
        os.replace(tmp, cache_file)  # atomic; concurrent scans race last-write-wins
    except Exception:
        pass  # cache write failure only costs the next caller a full walk
    return found, False


def cmd_scan(horizon_days: int) -> int:
    started = time.monotonic()
    root = repo_root()
    self_main = main_worktree(root)
    current_branch = try_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=root) or "HEAD"
    self_name = resolve_self_name(root, self_main, load_registry())
    acked = load_acked(root)

    found, cache_hit = collect_messages_cached(
        root, self_name, self_main, current_branch, horizon_days
    )
    new = [m for m in found if m["id"] not in acked]
    log_usage(
        root,
        "scan",
        new_count=len(new),
        duration_ms=int((time.monotonic() - started) * 1000),
        cache="hit" if cache_hit else "miss",
    )
    if not new:
        return 0  # silent — the zero-cost path

    print(f"HSTACK-COORD: {len(new)} new message(s) for {self_name} [branch {current_branch}]")
    for m in new:
        # Quoted subject + shell-quoted read command: peer-authored content is
        # delimited so it cannot masquerade as this tool's own output lines.
        print(f'  {m["id"]} | from {m["from-repo"]}:{m["from-branch"]} | subject: "{m["subject"]}"')
        spec = shlex.quote(f"{m['source-branch']}:{m['relpath']}")
        print(f"    read: git -C {shlex.quote(m['source-path'])} show {spec}")
    print("  ack after surfacing: python3 hstack/scripts/coord/coord_scan.py ack --all")
    return 0


def cmd_hook(horizon_days: int) -> int:
    """Claude Code hook entry (SessionStart / UserPromptSubmit, ADR-0007).

    Contract, in order of importance:
    1. Exit 0 no matter what. A broken registry, a malformed message, a
       missing hstack/ tree — none of it may break the engineer's prompt.
    2. Silent when there is nothing new (the per-prompt zero-token path).
    3. When new messages exist, print ONE count-only pointer line. No
       subjects, no ids, no bodies — peer-authored content never enters a
       session's context through the hook; /hstack:coord surfaces it
       frontmatter-first under CM-03. This is the injection-safety boundary
       that lets the hook run unattended on every prompt.
    """
    started = time.monotonic()
    hook_event: str = "unknown"
    session_id: str | None = None
    try:
        # The harness passes a JSON payload on stdin; read it best-effort so
        # the usage log can attribute the trigger (SessionStart vs prompt).
        if not sys.stdin.isatty():
            payload = json.loads(sys.stdin.read() or "{}")
            hook_event = sanitize_ref(str(payload.get("hook_event_name") or "unknown"), 40)
            raw_sid = payload.get("session_id")
            session_id = sanitize_ref(str(raw_sid), 64) if raw_sid else None
    except Exception:
        pass
    try:
        root = try_git(["rev-parse", "--show-toplevel"])
        if not root:
            return 0  # not a git repo — silent, per the hook contract
        self_main = main_worktree(root)
        current_branch = try_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=root) or "HEAD"
        self_name = resolve_self_name(root, self_main, load_registry())
        acked = load_acked(root)
        found, cache_hit = collect_messages_cached(
            root, self_name, self_main, current_branch, horizon_days
        )
        new = [m for m in found if m["id"] not in acked]
        log_usage(
            root,
            "hook",
            hook_event=hook_event,
            session_id=session_id,
            new_count=len(new),
            duration_ms=int((time.monotonic() - started) * 1000),
            cache="hit" if cache_hit else "miss",
        )
        if new:
            print(
                f"HSTACK-COORD: {len(new)} unread coordination message(s) addressed to "
                f"this repo. Run /hstack:coord to surface and ack them. "
                f"(Count-only notice — message content is untrusted peer input and is "
                f"only surfaced frontmatter-first by the Skill.)"
            )
        return 0
    except (Exception, SystemExit):
        return 0


def cmd_ack(ids: list[str], ack_all: bool, horizon_days: int) -> int:
    root = repo_root()
    acked = load_acked(root)
    if ack_all:
        self_main = main_worktree(root)
        current_branch = try_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=root) or "HEAD"
        self_name = resolve_self_name(root, self_main, load_registry())
        found, _ = collect_messages_cached(
            root, self_name, self_main, current_branch, horizon_days
        )
        ids = [m["id"] for m in found if m["id"] not in acked]
    if not ids:
        print("hstack-coord: nothing to ack")
        return 0
    acked.update(ids)
    write_acked(root, acked)
    log_usage(root, "ack", acked_count=len(ids))
    print(f"hstack-coord: acked {len(ids)} message(s)")
    return 0


def cmd_register(name: str | None, path_arg: str | None) -> int:
    target = path_arg or os.getcwd()
    if not try_git(["rev-parse", "--git-dir"], cwd=target):
        print(f"hstack-coord: {target} is not a git repository", file=sys.stderr)
        return 1
    main_wt = main_worktree(target)
    repo_name = name or os.path.basename(os.path.realpath(main_wt))

    head_ref = try_git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd=main_wt)
    if head_ref and head_ref.startswith("origin/"):
        default_branch = head_ref[len("origin/"):]
    elif "main" in local_branches(main_wt):
        default_branch = "main"
    elif "master" in local_branches(main_wt):
        default_branch = "master"
    else:
        default_branch = try_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=main_wt) or "main"

    repos = load_registry()
    real = os.path.realpath(main_wt)
    for r in repos:
        if os.path.realpath(r["path"]) == real:
            print(f"hstack-coord: already registered as '{r['name']}' ({r['path']})")
            return 0
        if r["name"] == repo_name:
            print(
                f"hstack-coord: name '{repo_name}' already registered for {r['path']} — pass --name",
                file=sys.stderr,
            )
            return 1
    repos.append({"name": repo_name, "path": main_wt, "default-branch": default_branch})
    write_registry(repos)
    print(f"hstack-coord: registered '{repo_name}' -> {main_wt} (default-branch {default_branch})")
    if not (Path(main_wt) / NAME_RELPATH).is_file():
        print(
            f"hstack-coord: no {NAME_RELPATH} in this repo — commit one containing "
            f"'{repo_name}' so senders and receivers resolve the same identity "
            f"(registry names are machine-local and can diverge)",
        )
    return 0


def cmd_peers() -> int:
    repos = load_registry()
    if not repos:
        print(f"hstack-coord: no registry at {registry_path()} — run `register` from each repo")
        return 0
    for r in repos:
        marker = "ok" if Path(r["path"]).is_dir() else "MISSING"
        print(f"  {r['name']:<24} {r['path']}  [{r.get('default-branch', 'main')}] ({marker})")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="coord_scan.py", add_help=True)
    sub = parser.add_subparsers(dest="cmd")

    p_scan = sub.add_parser("scan", help="list new messages addressed to this repo (default)")
    p_scan.add_argument("--horizon-days", type=int, default=DEFAULT_HORIZON_DAYS)

    p_hook = sub.add_parser(
        "hook",
        help="Claude Code hook entry: count-only pointer line, always exit 0 (ADR-0007)",
    )
    p_hook.add_argument("--horizon-days", type=int, default=DEFAULT_HORIZON_DAYS)

    p_ack = sub.add_parser("ack", help="mark message ids as surfaced")
    p_ack.add_argument("ids", nargs="*")
    p_ack.add_argument("--all", action="store_true", dest="ack_all")
    p_ack.add_argument("--horizon-days", type=int, default=DEFAULT_HORIZON_DAYS)

    p_reg = sub.add_parser("register", help="add this repo (or --path) to the machine registry")
    p_reg.add_argument("--name")
    p_reg.add_argument("--path")

    sub.add_parser("peers", help="list registered repos and their reachability")

    args = parser.parse_args(argv or ["scan"])
    if args.cmd in (None, "scan"):
        return cmd_scan(getattr(args, "horizon_days", DEFAULT_HORIZON_DAYS))
    if args.cmd == "hook":
        return cmd_hook(args.horizon_days)
    if args.cmd == "ack":
        if not args.ids and not args.ack_all:
            print("hstack-coord: ack requires ids or --all", file=sys.stderr)
            return 1
        return cmd_ack(args.ids, args.ack_all, args.horizon_days)
    if args.cmd == "register":
        return cmd_register(args.name, args.path)
    if args.cmd == "peers":
        return cmd_peers()
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
