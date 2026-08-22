/**
 * Description-budget scanner — ADR-0011's Option F.
 *
 * A Skill or subagent `description` is a routing trigger, not documentation:
 * it is injected into every session, unconditionally, for every installed
 * Skill and subagent, whether or not anything invokes it. ADR-0011 cut the 52
 * descriptions from 19,234 words to one-sentence triggers under a 40-word
 * budget, and deliberately left the enforcement out of that PR — "a linter for
 * a size that no file currently respects would flag 52 findings on day one,
 * and the rule should be established by the rewrite before it is enforced by a
 * tool". The rewrite shipped in v0.14.0. This is the tool.
 *
 * It scans the PACKAGE's `template/` tree, not the consumer's `hstack/`. The
 * consumer's copies are framework files that `hstack update` overwrites and
 * that `doctor` already diffs against the template — a budget finding there
 * would be a second report of the same drift. The regression this guards
 * against is one made in this repo, so this repo is where it is measured.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * ADR-0011: "Budget: ≤ 40 words / ~250 characters per description."
 *
 * Words are the budget. The character figure carries a tilde in the ADR — it
 * is the size 40 words implies, not a second independent limit — so it is
 * enforced at the next round number above it. Three descriptions in the
 * current template sit at 253 characters inside a 29–37 word trigger; those
 * are the shape the ADR asked for, not the regression it guards against.
 */
export const WORD_BUDGET = 40;
export const CHAR_BUDGET = 300;

/**
 * Named carve-outs. Empty since v0.17.
 *
 * ADR-0011 § Named carve-outs grants three, and only one ever needed a larger
 * budget: `hstack-coord`, the single description that routed with no human
 * typing anything — ADR-0007's hooks injected `HSTACK-COORD: N unread …` and
 * the model had to invoke `check` mode on sight. v0.17 removed coord, and with
 * it the only description that could argue for the exemption. The other two
 * carve-outs (confusable families, status preconditions stated as triggers)
 * always bought a clause rather than a budget: every file in those families is
 * under 40 words.
 *
 * An entry here is a decision with a reason, not a snooze. Adding one means
 * arguing that the description does routing work no body can do.
 */
export const BUDGET_CARVE_OUTS: ReadonlyMap<string, string> = new Map();

export interface DescriptionOverBudget {
  /** `hstack-ship`, `verifier`, … — the routing name, not the path. */
  name: string;
  /** Path relative to the package's `template/` directory. */
  relpath: string;
  kind: "skill" | "agent";
  words: number;
  chars: number;
}

/**
 * Pull the `description:` value out of a frontmatter block.
 *
 * Deliberately not the full YAML subset `validate-spec.mjs` parses: this reads
 * one known scalar out of a framework file whose shape this repo controls. It
 * handles the two forms that occur — a single-line scalar (quoted or not) and
 * a folded/literal block scalar — and returns null for anything else rather
 * than guessing.
 */
export function extractDescription(text: string): string | null {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "---" || t === "...") {
      end = i;
      break;
    }
  }
  if (end === -1) return null;

  for (let i = 1; i < end; i++) {
    const m = /^description:(.*)$/.exec(lines[i]);
    if (!m) continue;
    const rest = m[1].trim();

    if (rest === ">" || rest === "|" || /^[|>][-+]?$/.test(rest)) {
      const out: string[] = [];
      for (let j = i + 1; j < end; j++) {
        const line = lines[j];
        if (line.trim() === "") {
          out.push("");
          continue;
        }
        if (!/^\s/.test(line)) break;
        out.push(line.trim());
      }
      return out.join(" ").trim();
    }

    const unquoted = rest.replace(/^(["'])([\s\S]*)\1$/, "$2");
    return unquoted.trim();
  }
  return null;
}

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Every Skill and subagent description in the package template, measured. */
export function measureDescriptions(
  templateDir: string,
): Array<DescriptionOverBudget & { carveOut: string | null }> {
  const out: Array<DescriptionOverBudget & { carveOut: string | null }> = [];

  const push = (name: string, relpath: string, kind: "skill" | "agent", abs: string) => {
    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      return;
    }
    const desc = extractDescription(text);
    if (desc === null) return;
    out.push({
      name,
      relpath,
      kind,
      words: wordCount(desc),
      chars: desc.length,
      carveOut: BUDGET_CARVE_OUTS.get(name) ?? null,
    });
  };

  const skillsDir = join(templateDir, ".claude", "skills");
  for (const entry of safeReaddir(skillsDir)) {
    const abs = join(skillsDir, entry, "SKILL.md");
    try {
      if (!statSync(abs).isFile()) continue;
    } catch {
      continue;
    }
    push(entry, `.claude/skills/${entry}/SKILL.md`, "skill", abs);
  }

  const agentsDir = join(templateDir, ".claude", "agents");
  for (const entry of safeReaddir(agentsDir)) {
    if (!entry.endsWith(".md")) continue;
    const name = entry.replace(/\.md$/, "");
    push(name, `.claude/agents/${entry}`, "agent", join(agentsDir, entry));
  }

  out.sort((a, b) => b.words - a.words || a.name.localeCompare(b.name));
  return out;
}

/**
 * The descriptions over budget, carve-outs removed. Empty is the healthy
 * state — and is what the current template produces.
 */
export function descriptionsOverBudget(templateDir: string): DescriptionOverBudget[] {
  return measureDescriptions(templateDir)
    .filter((d) => d.carveOut === null && (d.words > WORD_BUDGET || d.chars > CHAR_BUDGET))
    .map(({ carveOut: _carveOut, ...rest }) => rest);
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}
