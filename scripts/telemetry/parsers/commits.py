"""Parse git log of the consuming repo for hstack-style auto-commits."""

from __future__ import annotations

import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path


# Auto-commit subject regex confirmed against moso-app's real git log.
# Examples (from exploration):
#   change-spec(2026-05-knowledge-resolve-icon-map-duplication-cross-module): shipped
#   tech-debt(TD-0102): resolved (resolved-by: 2026-05-knowledge-resolve-icon-map-duplication-cross-module)
#   implement(2026-05-knowledge-kg-ui-bucket-and-entity-rendering) phase-7-fixture-cast-cleanup + plan completed
#   adversarial-review(2026-05-knowledge-kg-ui-bucket-and-entity-rendering): findings-resolved + change-spec ready-to-ship
#   verification(2026-05-knowledge-kg-ui-bucket-and-entity-rendering): passed
ARTIFACT_TYPES = (
    "change-spec", "tech-debt", "implement", "adversarial-review",
    "verification", "test-plan", "plan", "security-review",
    "ui-brief", "figma-handoff", "story", "data-review",
    "module-spec", "adr",
)

COMMIT_SUBJECT = re.compile(
    r"^(?P<atype>" + "|".join(ARTIFACT_TYPES) + r")"
    r"\((?P<id>[^)]+)\)"
    r"(?P<rest>.*)$"
)

# Implement commits use `(<id>) <phase-id>` instead of `(<id>): <status>`.
IMPLEMENT_PHASE = re.compile(r"^\s*(?P<phase>phase-[a-z0-9-]+)")

# Halt sentinel — emitted into commit body or kernel-defined convention line.
HALT_SENTINEL = re.compile(r"HSTACK-HALT:\s*reason=(?P<reason>[a-z-]+)", re.IGNORECASE)


def run_git(repo: Path, *args: str) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True, text=True, check=False,
        )
    except FileNotFoundError:
        return ""
    return result.stdout


def parse_commits(repo: Path, since_days: int | None = None) -> list[dict]:
    """Return a list of commit dicts: subject parsed, files-touched, timestamp.

    Implementation: two queries to git. The first pulls metadata with a record
    separator so multi-line bodies survive. The second pulls per-commit file
    lists keyed by SHA. Merging the two avoids the `--pretty=format` +
    `--name-only` interaction that mangled multi-line bodies in v1.

    `--no-walk=unsorted` is intentionally not used; we keep author-date sort.
    Conductor checkpoint commits are filtered post-parse by subject prefix.
    """
    # --- pass 1: metadata ---
    sep = "\x1f"
    rec_sep = "\x1e"
    args = [
        "log", "--all",
        f"--pretty=format:%H{sep}%cI{sep}%an{sep}%s{sep}%b{rec_sep}",
    ]
    if since_days is not None:
        args.append(f"--since={since_days}.days.ago")
    raw = run_git(repo, *args)
    metadata: dict[str, dict] = {}
    for record in raw.split(rec_sep):
        record = record.strip("\n")
        if not record:
            continue
        parts = record.split(sep, 4)
        if len(parts) < 5:
            continue
        sha, iso_ts, author, subject, body = parts
        # Skip Conductor auto-checkpoint commits; they spam the log and carry
        # no hstack signal.
        if subject.startswith("checkpoint:"):
            continue
        metadata[sha] = {
            "sha": sha,
            "timestamp": _parse_iso(iso_ts),
            "author": author,
            "subject": subject,
            "body": body,
        }

    if not metadata:
        return []

    # --- pass 2: file lists for the SHAs we kept ---
    # Use a separate query keyed by SHA to avoid the `--name-only` interaction.
    files_by_sha = _files_by_sha(repo, list(metadata.keys()))

    out: list[dict] = []
    for sha, md in metadata.items():
        subject = md["subject"]
        body = md["body"]
        m = COMMIT_SUBJECT.match(subject)
        atype = m.group("atype") if m else None
        artifact_id = m.group("id") if m else None
        rest = m.group("rest") if m else ""
        phase_id = None
        action = None
        if atype == "implement":
            pm = IMPLEMENT_PHASE.search(rest)
            if pm:
                phase_id = pm.group("phase")
        else:
            action = rest.lstrip(":").strip() or None
        halts = HALT_SENTINEL.findall(body)
        out.append({
            **md,
            "artifact_type": atype,
            "artifact_id": artifact_id,
            "phase_id": phase_id,
            "action": action,
            "files": files_by_sha.get(sha, []),
            "halt_reasons": halts,
        })
    return out


def _files_by_sha(repo: Path, shas: list[str]) -> dict[str, list[str]]:
    """Run `git log --name-only --pretty=format:%H` filtered to the SHAs we care
    about; chunk the SHA list to avoid command-line length limits."""
    out: dict[str, list[str]] = {}
    if not shas:
        return out
    chunk_size = 200
    for start in range(0, len(shas), chunk_size):
        chunk = shas[start:start + chunk_size]
        args = ["log", "--no-walk", "--name-only", "--pretty=format:\x1eCOMMIT\x1f%H", *chunk]
        raw = run_git(repo, *args)
        if not raw:
            continue
        current_sha: str | None = None
        files: list[str] = []
        for line in raw.split("\n"):
            if line.startswith("\x1eCOMMIT\x1f"):
                if current_sha:
                    out[current_sha] = files
                current_sha = line.split("\x1f", 1)[1].strip()
                files = []
            elif line.strip() and current_sha:
                files.append(line.strip())
        if current_sha:
            out[current_sha] = files
    return out


def _parse_iso(s: str) -> datetime | None:
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None


def diff_line_count(repo: Path, sha: str) -> tuple[int, int]:
    """Return (added, removed) line counts for a commit."""
    raw = run_git(repo, "show", "--stat", "--format=", sha)
    added = removed = 0
    for line in raw.splitlines():
        if not line.strip():
            continue
        # final summary line: " N files changed, M insertions(+), K deletions(-)"
        m = re.search(r"(\d+) insertion", line)
        if m:
            added = int(m.group(1))
        m = re.search(r"(\d+) deletion", line)
        if m:
            removed = int(m.group(1))
    return added, removed


def commits_by_change(commits: list[dict]) -> dict[str, list[dict]]:
    """Group commits by change-id (artifact_id when artifact_type relates to a change)."""
    out: dict[str, list[dict]] = {}
    for c in commits:
        aid = c.get("artifact_id")
        atype = c.get("artifact_type")
        if not aid or atype is None:
            continue
        if atype == "tech-debt":
            # Tech-debt commits also reference a resolving change-spec in the body.
            # Surface the TD itself; resolving-change correlation is downstream.
            continue
        out.setdefault(aid, []).append(c)
    return out


def commits_touching_test_files(commits: list[dict]) -> list[dict]:
    """Filter commits that touch test files."""
    test_re = re.compile(r"(\.test\.|\.spec\.|/__tests__/|/__snapshots__/|^e2e/|_test\.go$)")
    out = []
    for c in commits:
        if any(test_re.search(f) for f in c.get("files", [])):
            out.append(c)
    return out


def commits_with_test_immutability_authorization(commits: list[dict]) -> list[dict]:
    """Commits whose body carries one of the canonical authorization phrases."""
    auth_re = re.compile(
        r"Ok to (change|delete) test\s+\S+"
        r"|Ok to update snapshot\s+\S+"
        r"|Ok to refresh fixture\s+\S+"
    )
    out = []
    for c in commits:
        if auth_re.search(c.get("body", "")):
            out.append(c)
    return out
