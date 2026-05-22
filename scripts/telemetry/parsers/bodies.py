"""Extract structured fragments from artifact bodies (Findings, tables, etc.)."""

from __future__ import annotations

import re


SECTION_HEADING = re.compile(r"^##+\s+(?P<heading>.+?)\s*$", re.MULTILINE)


def split_sections(body: str) -> dict[str, str]:
    """Split a markdown body into top-level sections keyed by heading text.

    All `##`-or-deeper sections are flattened — later sections with the same
    heading overwrite earlier ones (rare in our templates)."""
    matches = list(SECTION_HEADING.finditer(body))
    out: dict[str, str] = {}
    for i, m in enumerate(matches):
        heading = m.group("heading").strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        out[heading] = body[start:end].strip()
    return out


# Adversarial-review findings: per-finding subsections like
#   ### F-01
#   **Category.** spec-compliance
#   **What.** ...
#   **Severity rationale.** medium ...
#   **Resolution.** commit:abc123
FINDING_HEADING = re.compile(r"^###\s+(F-\d+)\s*$", re.MULTILINE)
FINDING_FIELD = re.compile(r"\*\*(?P<field>[^.*]+)\.\*\*\s*(?P<value>[^\n]*)")


def parse_findings_section(findings_text: str) -> list[dict]:
    """Parse the Findings section body into per-finding dicts.

    Returns [{id, category, severity, status, resolution, what, why}, ...].
    Only used as a fallback / cross-check; the frontmatter `findings:` array is
    authoritative for category/severity/status/resolution."""
    out = []
    matches = list(FINDING_HEADING.finditer(findings_text))
    for i, m in enumerate(matches):
        fid = m.group(1)
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(findings_text)
        block = findings_text[start:end]
        fields = {}
        for fm in FINDING_FIELD.finditer(block):
            fields[fm.group("field").strip().lower()] = fm.group("value").strip()
        out.append({
            "id": fid,
            "category": fields.get("category"),
            "severity_rationale": fields.get("severity rationale"),
            "what": fields.get("what"),
            "why": fields.get("why it matters"),
            "recommendation": fields.get("recommendation"),
            "resolution": fields.get("resolution"),
        })
    return out


# Plan phase overview: a three-column markdown table.
PHASE_TABLE_LINE = re.compile(r"^\|\s*(?P<step>phase-[a-z0-9-]+)\s*\|")


def parse_phase_overview(plan_body: str) -> list[str]:
    """Return list of phase ids from plan.md's Phase Overview table."""
    out = []
    for line in plan_body.splitlines():
        m = PHASE_TABLE_LINE.match(line)
        if m:
            out.append(m.group("step"))
    return out


def count_bullets(text: str) -> int:
    """Count top-level bullet points (lines starting with `-` or `*`)."""
    return sum(1 for line in text.splitlines() if re.match(r"^[-*]\s+\S", line))


def approx_token_count(text: str) -> int:
    """Crude token estimator: ~4 chars per token. Adequate for ratio metrics."""
    if not text:
        return 0
    return max(1, len(text) // 4)
