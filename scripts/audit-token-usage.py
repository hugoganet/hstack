#!/usr/bin/env python3
"""
hstack token audit.

Walks every Claude Code transcript under ~/.claude/projects/ that belongs to
moso-app (the consuming repo) and any of its worktrees, attributes token
usage to hstack Skills / subagents when detectable, and prints a ranked
cost table.

Heuristics:
  - We treat any session whose user messages contain '/hstack:<name>' or a
    <command-name>hstack-<name></command-name> tag as an hstack session and
    bucket the whole session under that Skill name. Earliest invocation wins
    if a session contains multiple (rare; hstack Skills are usually one-per-
    session).
  - Subagent invocations show up as 'Task' tool_use blocks with a
    'subagent_type' field. We bucket the tokens spent inside that subagent
    by walking assistant turns whose isSidechain == True ... but moso-app's
    transcripts so far show isSidechain=False on every record, so subagent
    spend lands in the parent session bucket. We surface this in the report.
  - Tokens billed = input + cache_creation + cache_read + output. For
    "what is this costing me" we report all three so cache impact is visible.
"""
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

PROJECTS_ROOT = Path.home() / ".claude" / "projects"

# Project dirs that map to moso-app + its worktrees.
TARGET_PREFIXES = (
    "-Users-hugoganet-Code-MOSO-moso-app",
    "-Users-hugoganet-conductor-workspaces-moso-app-",
)

HSTACK_SLASH = re.compile(r"/hstack:([a-z][a-z0-9\-]*)")
HSTACK_CMD_TAG = re.compile(r"<command-name>/?hstack:?-?([a-z][a-z0-9\-]*)</command-name>")
SUBAGENT_TYPE = re.compile(r'"subagent_type"\s*:\s*"([a-z][a-z0-9\-]*)"')


def message_text(msg):
    """Flatten a Claude message.content into a single string for regex search."""
    if msg is None:
        return ""
    if isinstance(msg, str):
        return msg
    content = msg.get("content") if isinstance(msg, dict) else None
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        # join text blocks; for non-text blocks dump as JSON so regexes still match
        out = []
        for blk in content:
            if isinstance(blk, dict):
                if blk.get("type") == "text" and isinstance(blk.get("text"), str):
                    out.append(blk["text"])
                else:
                    out.append(json.dumps(blk, default=str))
            else:
                out.append(str(blk))
        return "\n".join(out)
    return json.dumps(content, default=str)


def classify_session(records):
    """Return (skill_name_or_None, subagents_invoked:set)."""
    skill = None
    subagents = set()
    for r in records:
        t = r.get("type")
        if t == "user":
            text = message_text(r.get("message"))
            if skill is None:
                m = HSTACK_CMD_TAG.search(text) or HSTACK_SLASH.search(text)
                if m:
                    skill = m.group(1)
        elif t == "assistant":
            text = message_text(r.get("message"))
            for sa in SUBAGENT_TYPE.findall(text):
                subagents.add(sa)
    return skill, subagents


def tally_usage(records):
    """Sum tokens across all assistant turns in a session."""
    totals = defaultdict(int)
    by_model = defaultdict(lambda: defaultdict(int))
    turns = 0
    for r in records:
        if r.get("type") != "assistant":
            continue
        msg = r.get("message", {})
        usage = msg.get("usage") or {}
        model = msg.get("model", "?")
        turns += 1
        for k in ("input_tokens", "cache_creation_input_tokens",
                  "cache_read_input_tokens", "output_tokens"):
            v = usage.get(k, 0) or 0
            totals[k] += v
            by_model[model][k] += v
    totals["turns"] = turns
    return totals, by_model


def load_session(path):
    out = []
    with open(path, "r", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def discover_files():
    files = []
    if not PROJECTS_ROOT.exists():
        return files
    for d in PROJECTS_ROOT.iterdir():
        if not d.is_dir():
            continue
        name = d.name
        if not any(name.startswith(p) or name == p.rstrip("-") for p in TARGET_PREFIXES):
            continue
        for f in d.glob("*.jsonl"):
            files.append(f)
    return files


def fmt_k(n):
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n/1_000:.0f}k"
    return str(n)


def billed(t):
    """Approximate billable input-equivalent tokens.
    cache_read is ~10% of input price, cache_creation is ~125% of input price,
    output is ~5x input price (Opus). We report raw numbers, but also a
    weighted 'cost score' so ranking is realistic."""
    return (
        t.get("input_tokens", 0)
        + int(t.get("cache_creation_input_tokens", 0) * 1.25)
        + int(t.get("cache_read_input_tokens", 0) * 0.10)
        + t.get("output_tokens", 0) * 5
    )


def main():
    files = discover_files()
    print(f"# hstack token audit — {len(files)} sessions across moso-app + worktrees\n")

    per_skill = defaultdict(lambda: defaultdict(int))
    per_skill_sessions = defaultdict(int)
    per_subagent_appearance = defaultdict(int)
    unclassified = defaultdict(int)
    unclassified_sessions = 0
    grand = defaultdict(int)
    per_model = defaultdict(lambda: defaultdict(int))
    session_rows = []  # for top-N heavy sessions

    for f in files:
        recs = load_session(f)
        skill, subagents = classify_session(recs)
        totals, by_model = tally_usage(recs)
        if totals["turns"] == 0:
            continue
        for k, v in totals.items():
            grand[k] += v
        for m, mt in by_model.items():
            for k, v in mt.items():
                per_model[m][k] += v
        key = skill or "(non-hstack or pre-Skill turn)"
        if skill:
            per_skill_sessions[skill] += 1
            for k, v in totals.items():
                per_skill[skill][k] += v
            for sa in subagents:
                per_subagent_appearance[(skill, sa)] += 1
        else:
            unclassified_sessions += 1
            for k, v in totals.items():
                unclassified[k] += v
        session_rows.append({
            "file": f.name,
            "project": f.parent.name,
            "skill": skill,
            "subagents": sorted(subagents),
            "totals": dict(totals),
            "cost_score": billed(totals),
        })

    # --- grand totals ---
    print("## Grand totals (all moso-app sessions)\n")
    print(f"- sessions analyzed: {len(session_rows)}")
    print(f"- assistant turns:   {grand['turns']:,}")
    print(f"- input tokens:      {grand['input_tokens']:,}")
    print(f"- cache creation:    {grand['cache_creation_input_tokens']:,}")
    print(f"- cache read:        {grand['cache_read_input_tokens']:,}")
    print(f"- output tokens:     {grand['output_tokens']:,}")
    total_raw = sum(grand[k] for k in (
        "input_tokens", "cache_creation_input_tokens",
        "cache_read_input_tokens", "output_tokens"))
    print(f"- raw token volume:  {total_raw:,}\n")

    # --- per model ---
    print("## By model\n")
    print(f"{'model':<30} {'turns':>8} {'input':>10} {'cache-cr':>10} {'cache-rd':>10} {'output':>10}")
    for m, mt in sorted(per_model.items(), key=lambda x: -sum(x[1].values())):
        # 'turns' isn't tracked per-model in our tally; compute total bytes
        print(f"{m:<30} {'-':>8} "
              f"{fmt_k(mt['input_tokens']):>10} "
              f"{fmt_k(mt['cache_creation_input_tokens']):>10} "
              f"{fmt_k(mt['cache_read_input_tokens']):>10} "
              f"{fmt_k(mt['output_tokens']):>10}")
    print()

    # --- per skill ---
    print("## By hstack Skill (when detectable)\n")
    print(f"{'skill':<28} {'sessions':>8} {'turns':>6} {'input':>8} {'cache-cr':>9} {'cache-rd':>9} {'output':>8} {'cost-score':>11}")
    rows = []
    for skill, t in per_skill.items():
        rows.append((skill, per_skill_sessions[skill], t, billed(t)))
    rows.sort(key=lambda r: -r[3])
    for skill, sess, t, cost in rows:
        print(f"{skill:<28} {sess:>8} {t['turns']:>6} "
              f"{fmt_k(t['input_tokens']):>8} "
              f"{fmt_k(t['cache_creation_input_tokens']):>9} "
              f"{fmt_k(t['cache_read_input_tokens']):>9} "
              f"{fmt_k(t['output_tokens']):>8} "
              f"{fmt_k(cost):>11}")
    # unclassified
    print(f"{'(unclassified)':<28} {unclassified_sessions:>8} {unclassified['turns']:>6} "
          f"{fmt_k(unclassified['input_tokens']):>8} "
          f"{fmt_k(unclassified['cache_creation_input_tokens']):>9} "
          f"{fmt_k(unclassified['cache_read_input_tokens']):>9} "
          f"{fmt_k(unclassified['output_tokens']):>8} "
          f"{fmt_k(billed(unclassified)):>11}")
    print()
    print("note: 'cost-score' = input + 1.25*cache_creation + 0.10*cache_read + 5*output")
    print("      it ranks sessions by their effective $ weight, not by raw token count.\n")

    # --- subagent appearances by skill ---
    if per_subagent_appearance:
        print("## Subagent invocations (count, by skill)\n")
        by_skill = defaultdict(list)
        for (skill, sa), n in per_subagent_appearance.items():
            by_skill[skill].append((sa, n))
        for skill in sorted(by_skill):
            sas = ", ".join(f"{sa}×{n}" for sa, n in sorted(by_skill[skill], key=lambda x: -x[1]))
            print(f"- {skill}: {sas}")
        print()

    # --- top heavy sessions ---
    print("## Top 15 heaviest individual sessions (by cost-score)\n")
    session_rows.sort(key=lambda r: -r["cost_score"])
    print(f"{'skill':<22} {'project':<48} {'turns':>5} {'cost-score':>11}  file")
    for r in session_rows[:15]:
        proj = r["project"]
        if len(proj) > 47:
            proj = "…" + proj[-46:]
        print(f"{(r['skill'] or '-'):<22} {proj:<48} "
              f"{r['totals']['turns']:>5} {fmt_k(r['cost_score']):>11}  {r['file']}")
    print()

    # --- "duplicate context load" indicator ---
    # If cache_read >> cache_creation, caching is doing its job.
    # If cache_creation is a huge share, we're rebuilding context every session.
    cr = grand["cache_creation_input_tokens"]
    rd = grand["cache_read_input_tokens"]
    if cr + rd > 0:
        ratio = rd / (cr + rd)
        print(f"## Cache effectiveness\n")
        print(f"- cache_read / (cache_read + cache_creation) = {ratio:.2%}")
        if ratio < 0.5:
            print("  → low: a lot of context is being re-built per session, not reused.")
            print("  → suspect: each subagent / Skill loading fresh context from scratch.")
        elif ratio < 0.8:
            print("  → moderate: caching helps within sessions but breaks between them.")
        else:
            print("  → good: cross-session context reuse is working.")
        print()


if __name__ == "__main__":
    main()
