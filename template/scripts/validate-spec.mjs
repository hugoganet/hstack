#!/usr/bin/env node
/**
 * hstack artifact validator — the mechanical contract check every Skill runs
 * after a direct write, and the thing `{{TODO-SCRIPT: validate-spec.ts}}` stood
 * in for since ADR-0001.
 *
 *   node hstack/scripts/validate-spec.mjs                    # every artifact under hstack/
 *   node hstack/scripts/validate-spec.mjs <path> [<path>...] # named artifacts
 *   node hstack/scripts/validate-spec.mjs --json             # machine-readable
 *   node hstack/scripts/validate-spec.mjs --strict           # warnings fail too
 *   node hstack/scripts/validate-spec.mjs --rules            # print the registry
 *
 * Exit codes: 0 clean, 1 findings, 2 usage/environment error.
 *
 * ## Why .mjs and not .ts
 *
 * Consuming repos have no `node_modules` for hstack — the framework is copied
 * files. A `.ts` entrypoint would impose a runtime on every consumer: node
 * >= 22.6 with `--experimental-strip-types`, or `npx tsx` (network + install).
 * Plain ESM runs on the node the consumer already has (hstack installs via
 * npx; package.json declares `engines.node >= 18`), needs no build step, and
 * stays importable from `src/commands/doctor.ts` and a future CI gate. The
 * dependency-free precedent is `scripts/telemetry/` and `scripts/coord/`.
 *
 * ## The registry is the inventory
 *
 * `RULES` carries one entry per mechanizable rule id named in the repo, and
 * `DEFERRED_RULES` names every rule that is NOT mechanized in v1 together with
 * the reason. Nothing disappears: a rule is either checked here or listed as
 * deferred with a stated cause. `template/KERNEL.md` and the templates are the
 * authority for what each id means; where a repo source states no rule text,
 * the entry carries `inferred: true` and says so.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative, dirname, basename, sep } from "node:path";

// ---------------------------------------------------------------------------
// 1. Minimal YAML frontmatter parser
// ---------------------------------------------------------------------------
//
// hstack frontmatter is a deliberately small YAML subset: scalars, `null`,
// booleans, integers, flow and block sequences, one or two levels of nested
// map, and folded block scalars. That subset is worth ~150 lines; a YAML
// dependency is worth a node_modules tree in every consuming repo.

/** Strip a trailing `# comment`, respecting quotes. */
function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "#" && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i);
    }
  }
  return line;
}

/** Split a flow collection body on top-level commas. */
function splitFlow(body) {
  const out = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let cur = "";
  for (const c of body) {
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble) {
      if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") depth--;
      else if (c === "," && depth === 0) {
        out.push(cur);
        cur = "";
        continue;
      }
    }
    cur += c;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

const BLOCK_SCALAR = /^[|>][-+]?$/;

function parseScalar(raw) {
  const s = raw.trim();
  if (s === "") return null;
  if (s === "null" || s === "~" || s === "Null" || s === "NULL") return null;
  if (s === "true" || s === "True" || s === "TRUE") return true;
  if (s === "false" || s === "False" || s === "FALSE") return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  if (s.startsWith("[") && s.endsWith("]")) {
    const body = s.slice(1, -1).trim();
    return body === "" ? [] : splitFlow(body).map((x) => parseScalar(x));
  }
  if (s.startsWith("{") && s.endsWith("}")) {
    const body = s.slice(1, -1).trim();
    const out = {};
    if (body === "") return out;
    for (const part of splitFlow(body)) {
      const idx = part.indexOf(":");
      if (idx === -1) {
        out[part.trim()] = null;
      } else {
        out[part.slice(0, idx).trim()] = parseScalar(part.slice(idx + 1));
      }
    }
    return out;
  }
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length > 1) ||
    (s.startsWith("'") && s.endsWith("'") && s.length > 1)
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Parse the YAML frontmatter block of a markdown file.
 *
 * Returns `{ found, data, keyLines, endLine, error }`. `keyLines` maps a
 * top-level key to its 1-indexed source line so findings can point at it.
 * `rawScalars` keeps the pre-coercion text of top-level scalars — FM-01 needs
 * it to tell a YAML array from a comma-separated string.
 */
export function parseFrontmatter(text) {
  const allLines = text.split("\n");
  if (allLines[0]?.trim() !== "---") {
    return { found: false, data: {}, keyLines: {}, rawScalars: {}, endLine: 0 };
  }
  let end = -1;
  for (let i = 1; i < allLines.length; i++) {
    if (allLines[i].trim() === "---" || allLines[i].trim() === "...") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return {
      found: false,
      data: {},
      keyLines: {},
      rawScalars: {},
      endLine: 0,
      error: "frontmatter opened with `---` but never closed",
    };
  }

  // Significant lines only, with indent and source line number retained.
  const lines = [];
  for (let i = 1; i < end; i++) {
    const raw = allLines[i];
    const noComment = stripComment(raw).replace(/\s+$/, "");
    if (noComment.trim() === "") continue;
    lines.push({
      text: noComment,
      indent: noComment.length - noComment.trimStart().length,
      n: i + 1,
      raw,
    });
  }

  const keyLines = {};
  const rawScalars = {};
  const [data] = parseBlock(lines, 0, lines.length > 0 ? lines[0].indent : 0, {
    keyLines,
    rawScalars,
    depth: 0,
  });
  return {
    found: true,
    data: data ?? {},
    keyLines,
    rawScalars,
    endLine: end + 1,
  };
}

/** Parse a mapping or sequence starting at `i` with the given indent. */
function parseBlock(lines, i, indent, ctx) {
  if (i >= lines.length) return [null, i];
  const head = lines[i].text.trim();
  if (head.startsWith("[") || head.startsWith("{")) {
    // A flow collection written across several lines under its key.
    const [text, ni] = collectFlow(lines, i);
    return [parseScalar(text), ni];
  }
  if (lines[i].text.trimStart().startsWith("- ") || lines[i].text.trim() === "-") {
    return parseSequence(lines, i, indent, ctx);
  }
  return parseMapping(lines, i, indent, ctx);
}

/** True when a flow collection opened in `s` is still unclosed. */
function flowUnbalanced(s) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (const c of s) {
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") depth--;
    }
  }
  return depth > 0;
}

/**
 * Consume a flow collection that spans several lines, returning the joined
 * text and the index after it. Real artifacts write long `refs:` and
 * `steps-completed:` arrays this way.
 */
function collectFlow(lines, i) {
  let text = lines[i].text.trim();
  i++;
  while (flowUnbalanced(text) && i < lines.length) {
    text += " " + lines[i].text.trim();
    i++;
  }
  // A trailing comma before the closer is legal in the wild and harmless here.
  return [text.replace(/,\s*([\]}])/g, "$1"), i];
}

function parseMapping(lines, i, indent, ctx) {
  const out = {};
  while (i < lines.length && lines[i].indent === indent) {
    const line = lines[i];
    const body = line.text.trimStart();
    const colon = findKeyColon(body);
    if (colon === -1) {
      // Not a `key: value` line at this level — stop rather than guess.
      break;
    }
    const key = body.slice(0, colon).trim().replace(/^["']|["']$/g, "");
    const rest = body.slice(colon + 1).trim();
    if (ctx.depth === 0) {
      ctx.keyLines[key] = line.n;
      if (rest !== "") ctx.rawScalars[key] = rest;
    }
    i++;
    if (rest === "") {
      // Nested block, a same-indent sequence, or an explicit empty value.
      const next = lines[i];
      if (next && next.indent > indent) {
        const [val, ni] = parseBlock(lines, i, next.indent, {
          ...ctx,
          depth: ctx.depth + 1,
        });
        out[key] = val;
        i = ni;
      } else if (
        next &&
        next.indent === indent &&
        (next.text.trimStart().startsWith("- ") || next.text.trim() === "-")
      ) {
        const [val, ni] = parseSequence(lines, i, indent, {
          ...ctx,
          depth: ctx.depth + 1,
        });
        out[key] = val;
        i = ni;
      } else {
        out[key] = null;
      }
    } else if (BLOCK_SCALAR.test(rest)) {
      const parts = [];
      while (i < lines.length && lines[i].indent > indent) {
        parts.push(lines[i].text.trim());
        i++;
      }
      out[key] = parts.join(" ");
    } else if (flowUnbalanced(rest)) {
      const [text, ni] = collectFlow([{ text: rest }, ...lines.slice(i)], 0);
      out[key] = parseScalar(text);
      i += ni - 1;
    } else {
      out[key] = parseScalar(rest);
    }
  }
  return [out, i];
}

function parseSequence(lines, i, indent, ctx) {
  const out = [];
  while (i < lines.length && lines[i].indent === indent) {
    const body = lines[i].text.trimStart();
    if (!body.startsWith("- ") && body !== "-") break;
    const rest = body === "-" ? "" : body.slice(2).trim();
    i++;
    const colon = rest === "" ? -1 : findKeyColon(rest);
    if (rest === "") {
      const next = lines[i];
      if (next && next.indent > indent) {
        const [val, ni] = parseBlock(lines, i, next.indent, {
          ...ctx,
          depth: ctx.depth + 1,
        });
        out.push(val);
        i = ni;
      } else {
        out.push(null);
      }
    } else if (colon !== -1 && !rest.startsWith("{") && !rest.startsWith("[")) {
      // `- key: value` — an inline map item, possibly with continuation lines.
      const itemIndent = lines[i - 1].indent + 2;
      const synthetic = [
        { text: " ".repeat(itemIndent) + rest, indent: itemIndent, n: lines[i - 1].n },
      ];
      while (i < lines.length && lines[i].indent >= itemIndent) {
        synthetic.push(lines[i]);
        i++;
      }
      const [val] = parseMapping(synthetic, 0, itemIndent, {
        ...ctx,
        depth: ctx.depth + 1,
      });
      out.push(val);
    } else {
      out.push(parseScalar(rest));
    }
  }
  return [out, i];
}

/** Index of the `key:` colon, skipping colons inside quotes or flow braces. */
function findKeyColon(s) {
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") depth--;
      else if (c === ":" && depth === 0) {
        if (i + 1 >= s.length || /\s/.test(s[i + 1])) return i;
      }
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// 2. Markdown body / section parser
// ---------------------------------------------------------------------------

/**
 * Split a markdown body into sections keyed by heading text.
 * Fenced code blocks are skipped so a `## ` inside a fence is not a heading.
 */
export function parseSections(body, startLine = 1) {
  const lines = body.split("\n");
  const sections = [];
  let fence = null;
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0];
      else if (line.trimStart().startsWith(fence)) fence = null;
    }
    const h = fence === null ? /^(#{1,6})\s+(.*?)\s*$/.exec(line) : null;
    if (h) {
      current = {
        level: h[1].length,
        title: h[2].trim(),
        line: startLine + i,
        lines: [],
      };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  // `deep` is the section plus everything under its subsections. A parent
  // heading whose content all lives in `###` children is filled in, not empty.
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    s.deep = [...s.lines];
    for (let j = i + 1; j < sections.length && sections[j].level > s.level; j++) {
      s.deep.push("#".repeat(sections[j].level) + " " + sections[j].title);
      s.deep.push(...sections[j].lines);
    }
  }
  return sections;
}

/**
 * Find a section by heading text. Ignores a leading ordinal (`2. `,
 * `Section 2 — `) and inline markup, so a repo that numbers its headings still
 * matches the template's canonical name.
 */
export function findSection(sections, title, level = 2) {
  const want = normalizeHeading(title);
  return (
    sections.find((s) => s.level === level && normalizeHeading(s.title) === want) ??
    null
  );
}

function normalizeHeading(t) {
  return t
    .replace(/[`_*]/g, "")
    .replace(/^\s*(section\s+)?\d+\s*[.:\-—–]*\s*/i, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The section's full text, including its subsections. Used by containment checks. */
export function sectionText(section) {
  return section ? (section.deep ?? section.lines).join("\n") : "";
}

/**
 * Lines in a section that carry real content.
 *
 * Templates ship with italic guidance (`_..._`), bare `-` bullet stubs, and
 * empty table rows. A section that still holds only those is "not filled in",
 * which is exactly what the non-empty rules are asking about. This is a
 * heuristic and is documented as one — it cannot tell thin prose from good.
 */
export function substantiveLines(section) {
  if (!section) return [];
  return (section.deep ?? section.lines).filter((l) => {
    const t = l.trim();
    if (t === "") return false;
    if (t === "-" || t === "*" || t === "- " ) return false;
    if (/^_.*_$/.test(t)) return false; // whole-line italic guidance
    if (/^<!--/.test(t)) return false;
    if (/^\|[\s|:-]*\|$/.test(t)) return false; // empty or separator table row
    if (/^#{1,6}\s/.test(t)) return false; // nested heading, counted on its own
    return true;
  });
}

/** Bullet items in a section that carry content. */
export function bulletItems(section) {
  return substantiveLines(section).filter((l) => /^\s*[-*]\s+\S/.test(l));
}

// ---------------------------------------------------------------------------
// 3. Per-type schemas — derived from template/templates/*.md
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The shared floor from KERNEL.md § Frontmatter contract. */
const FLOOR_FIELDS = ["id", "type", "status", "owner", "created", "updated"];

/** Fields that must be YAML arrays wherever they appear. */
const ARRAY_FIELDS = new Set([
  "surfaces",
  "user-stories",
  "related-adrs",
  "creates-tech-debt",
  "resolves-tech-debt",
  "children",
  "revisits-change",
  "enables",
  "enabled-by",
  "in-scope",
  "out-of-scope",
  "paths",
  "related-modules",
  "related-change-specs",
  "promoted-from-kernel-fit",
  "linked-change-specs",
  "reused-components",
  "new-components",
  "figma-frame-urls",
  "tenant-isolation-tests",
  "invariants-mapped",
  "steps-completed",
  "findings",
  "evidence-rows",
  "related-findings",
  "refs",
  "derived-from",
  "downstream",
  "surfaces-covered",
]);

/** Date-typed fields, validated as ISO 8601 calendar dates. */
const DATE_FIELDS = new Set([
  "created",
  "updated",
  "decision-date",
  "last-refreshed",
  "reviewed-on",
  "reviewed-quarterly-on",
  "last-quarterly-review",
  "schema-snapshot-date",
  "resolution-attempted-at",
  "stale-verified-at",
  "expires",
]);

const SURFACES = ["ui", "api", "db", "infra", "agent"];

/**
 * Per-type status enums and type-local enum fields. Case-sensitive by kernel
 * rule ("controlled enums are case-sensitive").
 */
export const TYPE_SCHEMAS = {
  "change-spec": {
    status: [
      "draft",
      "ready-to-plan",
      "ready-for-implementation",
      "ready-for-review",
      "ready-to-ship",
      "shipped",
      "archived",
    ],
    enums: {},
    idShape: "kebab",
  },
  "module-spec": {
    status: ["drafted", "current", "needs-refresh", "archived"],
    idShape: "kebab",
  },
  "tech-debt": {
    status: [
      "open",
      "in-progress",
      "resolved",
      "wontfix",
      "stale-no-longer-reproducible",
      "archived",
    ],
    enums: {
      severity: ["critical", "high", "medium", "low"],
      cost: ["small", "medium", "large"],
      "fix-sketch-effort": ["small", "medium", "large"],
    },
    idShape: "td",
  },
  adr: {
    status: ["proposed", "accepted", "deprecated", "superseded"],
    idShape: "adr",
  },
  "test-plan": {
    status: [
      "draft",
      "in-progress",
      "passed",
      "concerns-acknowledged",
      "failed",
      "superseded",
    ],
    enums: { "scoring-mode": ["llm-strategized", "executed"] },
    idShape: "kebab",
  },
  "security-review": {
    status: [
      "draft",
      "in-progress",
      "passed",
      "concerns-acknowledged",
      "failed",
      "superseded",
    ],
    enums: { "scoring-mode": ["llm-scored", "executed"] },
    idShape: "kebab",
  },
  "data-review": {
    status: [
      "draft",
      "in-progress",
      "passed",
      "concerns-acknowledged",
      "failed",
      "superseded",
    ],
    enums: {
      "migration-safety": ["safe", "needs-backfill", "risky"],
      "rag-impact": ["scoped", "broadened", "narrowed", "none"],
    },
    idShape: "kebab",
  },
  plan: {
    status: ["draft", "ready", "in-progress", "completed", "archived"],
    idShape: "kebab",
  },
  verification: {
    status: ["draft", "ran", "passed", "failed", "superseded"],
    idShape: "kebab",
  },
  "adversarial-review": {
    status: [
      "draft",
      "in-progress",
      "findings-open",
      "findings-resolved",
      "superseded",
    ],
    idShape: "kebab",
  },
  "ui-brief": {
    status: ["draft", "drafted", "superseded"],
    idShape: "kebab",
  },
  "figma-handoff": {
    status: ["draft", "ready", "superseded"],
    idShape: "kebab",
  },
  story: {
    status: ["drafted", "ready", "in-flight", "shipped", "archived"],
    idShape: "store",
  },
  persona: {
    status: ["drafted", "current", "needs-refresh", "archived"],
    idShape: "kebab",
  },
  "kernel-fit-finding": {
    status: [
      "open",
      "acknowledged",
      "dismissed",
      "promoted",
      "superseded",
      "archived",
    ],
    enums: {
      confidence: ["high", "medium", "low"],
      "detected-via": ["detector", "flag"],
    },
    idShape: "kf",
    ownerNullable: true,
  },
  "kernel-fit-flag": {
    status: ["pending", "processed"],
    enums: {
      classification: [
        "friction",
        "missing-guardrail",
        "kernel-vs-practice-mismatch",
        "not-actionable",
        "transcript-truncated",
      ],
    },
    idShape: "free",
    floorExempt: ["owner"],
  },
  "coord-message": {
    status: ["sent"],
    idShape: "free",
  },
  infrastructure: {
    status: ["drafted", "current", "needs-refresh", "archived"],
    idShape: "kebab",
  },
  "product-brief": {
    status: ["draft", "current", "needs-refresh", "archived"],
    enums: {
      "technique-used": ["brainstorm", "forcing-questions", "project-brief"],
    },
    idShape: "kebab",
  },
  "data-architecture": {
    status: ["draft", "current", "needs-refresh", "archived"],
    idShape: "kebab",
  },
  "app-architecture": {
    status: ["draft", "current", "needs-refresh", "archived"],
    idShape: "kebab",
  },
  roadmap: {
    status: ["drafted", "current", "needs-refresh", "archived"],
    enums: { source: ["local", "rhizome"] },
    idShape: "kebab",
  },
  vision: {
    status: ["drafted", "current", "needs-refresh", "archived"],
    idShape: "kebab",
  },
  glossary: {
    status: ["drafted", "current", "needs-refresh", "archived"],
    idShape: "kebab",
  },
  "tech-stack": {
    status: ["drafted", "current", "needs-refresh", "archived"],
    idShape: "kebab",
  },
  "ci-cd": {
    status: ["drafted", "current", "needs-refresh", "archived"],
    idShape: "kebab",
  },
  "threat-model": {
    status: ["drafted", "current", "needs-refresh", "archived"],
    idShape: "kebab",
  },
  "hardening-checklist": {
    status: ["drafted", "current", "needs-refresh", "archived"],
    idShape: "kebab",
  },
  "incident-runbook": {
    status: ["drafted", "current", "needs-refresh", "archived"],
    idShape: "kebab",
  },
};

const ID_SHAPES = {
  kebab: { re: KEBAB, label: "kebab-case" },
  td: { re: /^TD-\d{4}-[a-z0-9]+(-[a-z0-9]+)*$/, label: "TD-NNNN-<kebab-slug>" },
  adr: { re: /^ADR-\d{4}-[a-z0-9]+(-[a-z0-9]+)*$/, label: "ADR-NNNN-<kebab-slug>" },
  kf: { re: /^KF-\d{4}-[a-z0-9]+(-[a-z0-9]+)*$/, label: "KF-NNNN-<kebab-slug>" },
  store: {
    re: /^(NOTION|LINEAR|GH|REPO):.+$/,
    label: "<STORE>:<store-native-id> (NOTION | LINEAR | GH | REPO)",
  },
  free: { re: null, label: null },
};

/** Statuses at or past which a change-spec's contract must be complete. */
const CHANGE_SPEC_BEYOND_DRAFT = (status) => status !== "draft" && status !== "archived";

// ---------------------------------------------------------------------------
// 4. Rule registry
// ---------------------------------------------------------------------------
//
// Each entry: { id, type, description, severity?, inferred?, check(a, world) }
// `check` returns an array of `{ message, line? }` (or a falsy value).
// `type` is the artifact type the rule applies to, `"*"` for every artifact.

const F = (message, line, severity) => ({ message, line, severity });

/** Non-null and non-empty-string. */
const present = (v) => v !== null && v !== undefined && String(v).trim() !== "";

const arr = (v) => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]);

export const RULES = [
  // -- Shared frontmatter floor ---------------------------------------------
  {
    id: "FM-01",
    type: "*",
    description:
      "Shared frontmatter floor (KERNEL.md § Frontmatter contract): id / type / status / owner / created / updated present and non-null; id matches its type's shape and is kebab-case where the schema says so; dates are ISO 8601; controlled enums are case-sensitive; array fields are YAML arrays, never comma-separated strings.",
    check(a) {
      const out = [];
      const schema = TYPE_SCHEMAS[a.type];
      const exempt = new Set(schema?.floorExempt ?? []);
      if (schema?.ownerNullable) exempt.add("owner");
      for (const field of FLOOR_FIELDS) {
        if (exempt.has(field)) continue;
        if (!present(a.fm[field])) {
          out.push(F(`missing or null required floor field \`${field}\``, a.lineOf(field)));
        }
      }
      // id shape
      const shape = ID_SHAPES[schema?.idShape ?? "kebab"];
      if (shape?.re && present(a.fm.id) && !shape.re.test(String(a.fm.id))) {
        out.push(
          F(
            `id \`${a.fm.id}\` does not match the ${a.type} id shape (${shape.label})`,
            a.lineOf("id"),
          ),
        );
      }
      // status enum, case-sensitive
      if (schema?.status && present(a.fm.status)) {
        const s = String(a.fm.status);
        if (!schema.status.includes(s)) {
          const hint = schema.status.find((v) => v.toLowerCase() === s.toLowerCase());
          out.push(
            F(
              `status \`${s}\` is not in the ${a.type} enum` +
                (hint ? ` — enums are case-sensitive, did you mean \`${hint}\`?` : "") +
                ` (allowed: ${schema.status.join(" | ")})`,
              a.lineOf("status"),
            ),
          );
        }
      }
      // type-local enums
      for (const [field, allowed] of Object.entries(schema?.enums ?? {})) {
        const v = a.fm[field];
        if (v === null || v === undefined) continue;
        if (!allowed.includes(String(v))) {
          const hint = allowed.find((x) => x.toLowerCase() === String(v).toLowerCase());
          out.push(
            F(
              `${field} \`${v}\` is not in the controlled enum` +
                (hint ? ` — enums are case-sensitive, did you mean \`${hint}\`?` : "") +
                ` (allowed: ${allowed.join(" | ")})`,
              a.lineOf(field),
            ),
          );
        }
      }
      // dates
      for (const field of DATE_FIELDS) {
        const v = a.fm[field];
        if (v === null || v === undefined) continue;
        if (!ISO_DATE.test(String(v)) || !isRealDate(String(v))) {
          out.push(
            F(`${field} \`${v}\` is not an ISO 8601 date (YYYY-MM-DD)`, a.lineOf(field)),
          );
        }
      }
      // arrays are arrays
      for (const field of ARRAY_FIELDS) {
        if (!(field in a.fm)) continue;
        const v = a.fm[field];
        if (v === null || Array.isArray(v)) continue;
        const raw = a.rawScalars[field];
        const commaHint =
          typeof raw === "string" && raw.includes(",")
            ? " — write a YAML array (`[a, b]` or a `- ` block), never a comma-separated string"
            : " — expected a YAML array";
        out.push(F(`${field} is a ${typeof v}, not an array${commaHint}`, a.lineOf(field)));
      }
      // surfaces enum
      if (Array.isArray(a.fm.surfaces)) {
        for (const s of a.fm.surfaces) {
          if (!SURFACES.includes(String(s))) {
            out.push(
              F(
                `surfaces entry \`${s}\` is not in the enum (${SURFACES.join(" | ")})`,
                a.lineOf("surfaces"),
              ),
            );
          }
        }
      }
      return out;
    },
  },

  // -- SP: change-spec -------------------------------------------------------
  {
    id: "SP-04",
    type: "change-spec",
    description:
      "The Invariants section names at least three invariants. Below three, the change is either too narrow to need a spec or the author skipped the challenge.",
    check(a) {
      if (!CHANGE_SPEC_BEYOND_DRAFT(a.fm.status)) return [];
      const sec = findSection(a.sections, "Invariants");
      if (!sec) return [F("no `## Invariants` section")];
      const n = bulletItems(sec).length;
      if (n < 3) {
        return [F(`Invariants has ${n} bullet(s); SP-04 requires at least 3`, sec.line)];
      }
      return [];
    },
  },
  {
    id: "SP-05",
    type: "change-spec",
    description:
      "`in-scope` is a non-empty file allowlist once the spec is past draft. The implementer's write boundary and the CI scope gate both read this array.",
    check(a) {
      if (!CHANGE_SPEC_BEYOND_DRAFT(a.fm.status)) return [];
      if (arr(a.fm["in-scope"]).length === 0) {
        return [F("`in-scope` is empty; SP-05 requires a non-empty allowlist past `draft`", a.lineOf("in-scope"))];
      }
      return [];
    },
  },
  {
    id: "SP-06",
    type: "change-spec",
    description:
      "The Scope Boundaries body section is filled in once the spec is past draft, and `out-of-scope` is declared (it may be an empty array, but the key must exist). Repo sources name SP-05/SP-06 jointly as \"Scope Boundaries is non-empty\"; the frontmatter half is SP-05 here and the body half is SP-06.",
    inferred: true,
    check(a) {
      if (!CHANGE_SPEC_BEYOND_DRAFT(a.fm.status)) return [];
      const out = [];
      const sec = findSection(a.sections, "Scope Boundaries");
      if (!sec) out.push(F("no `## Scope Boundaries` section"));
      else if (substantiveLines(sec).length === 0) {
        out.push(F("`## Scope Boundaries` carries no content", sec.line));
      }
      if (!("out-of-scope" in a.fm)) {
        out.push(F("`out-of-scope` key is missing (it may be an empty array, but it is required)"));
      }
      return out;
    },
  },
  {
    id: "SP-09",
    type: "change-spec",
    description:
      "A change-spec past draft has a driving user story, or declares exactly one of the three no-story carve-outs: Category A `internal-tooling: true`, Category B non-empty `enables`, Category C `area: bootstrap`.",
    check(a) {
      if (!CHANGE_SPEC_BEYOND_DRAFT(a.fm.status)) return [];
      const stories = arr(a.fm["user-stories"]).filter(present);
      if (stories.length > 0) return [];
      if (a.fm["internal-tooling"] === true) return [];
      if (arr(a.fm.enables).filter(present).length > 0) return [];
      if (String(a.fm.area) === "bootstrap") return [];
      return [
        F(
          "`user-stories` is empty and no carve-out is declared — set `internal-tooling: true` (A), a non-empty `enables` (B), or `area: bootstrap` (C)",
          a.lineOf("user-stories"),
        ),
      ];
    },
  },
  {
    id: "SP-13",
    type: "change-spec",
    description:
      "The three no-story categories are mutually exclusive: a change is Category A, B, or C — never two.",
    check(a) {
      const declared = [];
      if (a.fm["internal-tooling"] === true) declared.push("internal-tooling: true (A)");
      if (arr(a.fm.enables).filter(present).length > 0) declared.push("enables non-empty (B)");
      if (String(a.fm.area) === "bootstrap") declared.push("area: bootstrap (C)");
      if (declared.length > 1) {
        return [
          F(
            `categories are mutually exclusive but this spec declares ${declared.length}: ${declared.join(", ")}`,
            a.lineOf("internal-tooling"),
          ),
        ];
      }
      return [];
    },
  },
  {
    id: "SP-14",
    type: "change-spec",
    description:
      "Reciprocity `change-spec.enables ↔ change-spec.enabled-by`: every id in `enables` names a change-spec that exists on disk and lists this change-id in its `enabled-by`. Both halves must be in the same state on disk — the pair lands in one commit.",
    check(a, world) {
      const out = [];
      for (const target of arr(a.fm.enables).filter(present)) {
        const other = world.byId.get(String(target));
        if (!other || other.type !== "change-spec") {
          out.push(
            F(
              `enables \`${target}\` names no change-spec on disk (forward references are legal only at authoring time)`,
              a.lineOf("enables"),
            ),
          );
          continue;
        }
        if (!arr(other.fm["enabled-by"]).map(String).includes(String(a.fm.id))) {
          out.push(
            F(
              `enables \`${target}\` but ${other.relpath} does not list \`${a.fm.id}\` in \`enabled-by\` — the reciprocal half is missing`,
              a.lineOf("enables"),
            ),
          );
        }
      }
      for (const source of arr(a.fm["enabled-by"]).filter(present)) {
        const other = world.byId.get(String(source));
        if (!other || other.type !== "change-spec") {
          out.push(
            F(`enabled-by \`${source}\` names no change-spec on disk`, a.lineOf("enabled-by")),
          );
          continue;
        }
        if (!arr(other.fm.enables).map(String).includes(String(a.fm.id))) {
          out.push(
            F(
              `enabled-by \`${source}\` but ${other.relpath} does not list \`${a.fm.id}\` in \`enables\``,
              a.lineOf("enabled-by"),
            ),
          );
        }
      }
      return out;
    },
  },

  // -- TD: tech-debt ---------------------------------------------------------
  {
    id: "TD-01",
    type: "tech-debt",
    description:
      "Reciprocity `tech-debt.introduced-by ↔ change-spec.creates-tech-debt`: when a TD names an originating change-spec, that spec exists and lists this TD.",
    check(a, world) {
      const introducedBy = a.fm["introduced-by"];
      if (!present(introducedBy)) return [];
      const spec = world.byId.get(String(introducedBy));
      if (!spec || spec.type !== "change-spec") {
        return [
          F(
            `introduced-by \`${introducedBy}\` names no change-spec on disk`,
            a.lineOf("introduced-by"),
          ),
        ];
      }
      if (!arr(spec.fm["creates-tech-debt"]).map(String).includes(String(a.fm.id))) {
        return [
          F(
            `introduced-by \`${introducedBy}\` but ${spec.relpath} does not list \`${a.fm.id}\` in \`creates-tech-debt\` — the reciprocal half is missing`,
            a.lineOf("introduced-by"),
          ),
        ];
      }
      return [];
    },
  },
  {
    id: "TD-02",
    type: "tech-debt",
    description:
      "`severity: critical` requires a `target-resolve-by` date. Documented as surfacing-only in v1, so this reports as a warning.",
    severity: "warn",
    check(a) {
      if (String(a.fm.severity) !== "critical") return [];
      if (present(a.fm["target-resolve-by"])) return [];
      return [
        F(
          "severity is `critical` but `target-resolve-by` is null",
          a.lineOf("target-resolve-by") ?? a.lineOf("severity"),
        ),
      ];
    },
  },
  {
    id: "TD-04",
    type: "tech-debt",
    description:
      "Reciprocity `tech-debt.resolved-by ↔ change-spec.resolves-tech-debt`: a resolved TD's `resolved-by` names a change-spec that lists it back. Checked from both directions so a one-sided write is caught wherever the validator is pointed.",
    check(a, world) {
      const resolvedBy = a.fm["resolved-by"];
      if (!present(resolvedBy)) return [];
      const spec = world.byId.get(String(resolvedBy));
      if (!spec || spec.type !== "change-spec") {
        return [
          F(`resolved-by \`${resolvedBy}\` names no change-spec on disk`, a.lineOf("resolved-by")),
        ];
      }
      if (!arr(spec.fm["resolves-tech-debt"]).map(String).includes(String(a.fm.id))) {
        return [
          F(
            `resolved-by \`${resolvedBy}\` but ${spec.relpath} does not list \`${a.fm.id}\` in \`resolves-tech-debt\` — the reciprocal half is missing`,
            a.lineOf("resolved-by"),
          ),
        ];
      }
      return [];
    },
  },
  {
    id: "TD-04",
    variant: "change-spec-half",
    type: "change-spec",
    description:
      "Reciprocity from the change-spec side: every id in `resolves-tech-debt` names a tech-debt artifact on disk, and once the change is `shipped` that TD carries `resolved-by: <this change>`.",
    check(a, world) {
      const out = [];
      for (const tdId of arr(a.fm["resolves-tech-debt"]).filter(present)) {
        const td = world.byId.get(String(tdId));
        if (!td || td.type !== "tech-debt") {
          out.push(
            F(
              `resolves-tech-debt \`${tdId}\` names no tech-debt artifact on disk`,
              a.lineOf("resolves-tech-debt"),
            ),
          );
          continue;
        }
        if (String(a.fm.status) === "shipped") {
          if (String(td.fm["resolved-by"] ?? "") !== String(a.fm.id)) {
            out.push(
              F(
                `change-spec is \`shipped\` and resolves \`${tdId}\`, but ${td.relpath} has \`resolved-by: ${td.fm["resolved-by"]}\` — run /hstack:finalize`,
                a.lineOf("resolves-tech-debt"),
              ),
            );
          }
        }
      }
      return out;
    },
  },
  {
    id: "TD-05",
    type: "tech-debt",
    description: "`status: resolved` requires `resolved-by` non-null.",
    check(a) {
      if (String(a.fm.status) !== "resolved") return [];
      if (present(a.fm["resolved-by"])) return [];
      return [F("status is `resolved` but `resolved-by` is null", a.lineOf("resolved-by") ?? a.lineOf("status"))];
    },
  },
  {
    id: "TD-06",
    type: "tech-debt",
    description:
      "`status: wontfix` requires both `wontfix-reason` and `wontfix-accepted-alternative` non-null.",
    check(a) {
      if (String(a.fm.status) !== "wontfix") return [];
      const out = [];
      for (const field of ["wontfix-reason", "wontfix-accepted-alternative"]) {
        if (!present(a.fm[field])) {
          out.push(F(`status is \`wontfix\` but \`${field}\` is null`, a.lineOf(field) ?? a.lineOf("status")));
        }
      }
      return out;
    },
  },
  {
    id: "TD-07",
    type: "tech-debt",
    description:
      "`status: stale-no-longer-reproducible` requires both `stale-verified-at` and `stale-verification-method` non-null.",
    check(a) {
      if (String(a.fm.status) !== "stale-no-longer-reproducible") return [];
      const out = [];
      for (const field of ["stale-verified-at", "stale-verification-method"]) {
        if (!present(a.fm[field])) {
          out.push(F(`status is \`stale-no-longer-reproducible\` but \`${field}\` is null`, a.lineOf(field) ?? a.lineOf("status")));
        }
      }
      return out;
    },
  },

  // -- AD: ADR ---------------------------------------------------------------
  {
    id: "AD-01",
    type: "adr",
    description:
      "ADR ids are sequential with no gaps. Reported once against the lowest-numbered ADR in the set so a gap does not fan out into a finding per file.",
    check(a, world) {
      const adrs = (world.byType.get("adr") ?? [])
        .map((x) => ({ x, n: adrNumber(x.fm.id) }))
        .filter((e) => e.n !== null)
        .sort((p, q) => p.n - q.n);
      if (adrs.length === 0 || adrs[0].x !== a) return []; // report once
      const out = [];
      const seen = new Map();
      for (const { x, n } of adrs) {
        if (seen.has(n)) {
          out.push(F(`ADR number ${pad4(n)} is used twice: ${seen.get(n)} and ${x.relpath}`));
        } else {
          seen.set(n, x.relpath);
        }
      }
      const nums = [...seen.keys()].sort((p, q) => p - q);
      const gaps = [];
      for (let n = nums[0]; n < nums[nums.length - 1]; n++) {
        if (!seen.has(n)) gaps.push(pad4(n));
      }
      if (gaps.length > 0) {
        out.push(
          F(
            `ADR ids are not sequential — missing ${gaps.join(", ")} between ADR-${pad4(nums[0])} and ADR-${pad4(nums[nums.length - 1])}`,
          ),
        );
      }
      return out;
    },
  },
  {
    id: "AD-02",
    type: "adr",
    description:
      "Reciprocity `ADR.supersedes ↔ ADR.superseded-by`: the superseded ADR names this one back, and its status is `superseded`.",
    check(a, world) {
      const out = [];
      const supersedes = a.fm.supersedes;
      if (present(supersedes)) {
        const other = world.byId.get(String(supersedes));
        if (!other || other.type !== "adr") {
          out.push(F(`supersedes \`${supersedes}\` names no ADR on disk`, a.lineOf("supersedes")));
        } else {
          if (String(other.fm["superseded-by"] ?? "") !== String(a.fm.id)) {
            out.push(
              F(
                `supersedes \`${supersedes}\` but ${other.relpath} has \`superseded-by: ${other.fm["superseded-by"]}\` — the reciprocal half is missing`,
                a.lineOf("supersedes"),
              ),
            );
          }
          if (String(other.fm.status) !== "superseded") {
            out.push(
              F(
                `supersedes \`${supersedes}\` but ${other.relpath} is at \`status: ${other.fm.status}\`, not \`superseded\``,
                a.lineOf("supersedes"),
              ),
            );
          }
        }
      }
      const supersededBy = a.fm["superseded-by"];
      if (present(supersededBy)) {
        const other = world.byId.get(String(supersededBy));
        if (!other || other.type !== "adr") {
          out.push(
            F(`superseded-by \`${supersededBy}\` names no ADR on disk`, a.lineOf("superseded-by")),
          );
        } else if (String(other.fm.supersedes ?? "") !== String(a.fm.id)) {
          out.push(
            F(
              `superseded-by \`${supersededBy}\` but ${other.relpath} does not carry \`supersedes: ${a.fm.id}\``,
              a.lineOf("superseded-by"),
            ),
          );
        }
      }
      return out;
    },
  },
  {
    id: "AD-03",
    type: "adr",
    description:
      "Fixed Nygard section structure: Title, Status, Context, Decision, Consequences, Alternatives Considered, Forecloses / Enables — all present and non-empty.",
    check(a) {
      const required = [
        "Title",
        "Status",
        "Context",
        "Decision",
        "Consequences",
        "Alternatives Considered",
        "Forecloses / Enables",
      ];
      return requireSections(a, required);
    },
  },
  {
    id: "AD-04",
    type: "adr",
    description: "`status: superseded` requires `superseded-by` non-null.",
    check(a) {
      if (String(a.fm.status) !== "superseded") return [];
      if (present(a.fm["superseded-by"])) return [];
      return [
        F("status is `superseded` but `superseded-by` is null", a.lineOf("superseded-by") ?? a.lineOf("status")),
      ];
    },
  },
  {
    id: "KF-04",
    variant: "adr-half",
    type: "adr",
    description:
      "Reciprocity from the ADR side: every id in `promoted-from-kernel-fit` names a kernel-fit finding whose `promoted-to` points back at this ADR.",
    check(a, world) {
      const out = [];
      for (const kfId of arr(a.fm["promoted-from-kernel-fit"]).filter(present)) {
        const kf = world.byId.get(String(kfId));
        if (!kf || kf.type !== "kernel-fit-finding") {
          out.push(
            F(
              `promoted-from-kernel-fit \`${kfId}\` names no kernel-fit finding on disk`,
              a.lineOf("promoted-from-kernel-fit"),
            ),
          );
          continue;
        }
        if (String(kf.fm["promoted-to"] ?? "") !== `adr:${a.fm.id}`) {
          out.push(
            F(
              `promoted-from-kernel-fit \`${kfId}\` but ${kf.relpath} has \`promoted-to: ${kf.fm["promoted-to"]}\` (expected \`adr:${a.fm.id}\`)`,
              a.lineOf("promoted-from-kernel-fit"),
            ),
          );
        }
      }
      return out;
    },
  },

  // -- Per-change artifacts: parent linkage ---------------------------------
  {
    id: "TS-01",
    type: "test-plan",
    description:
      "`parent-change` names the change-spec that owns the enclosing change folder.",
    check: parentChangeMatches,
  },
  {
    id: "PL-01",
    type: "plan",
    description:
      "`parent-change` names the change-spec that owns the enclosing change folder.",
    check: parentChangeMatches,
  },
  {
    id: "SR-01",
    type: "security-review",
    description:
      "`parent-change` names the change-spec that owns the enclosing change folder, and the scores map covers every hardening layer. No repo source states SR-01's text; implemented by analogy with TS-01 / PL-01 and the security-reviewer's Definition of Done, and flagged as inferred.",
    inferred: true,
    check(a, world) {
      const out = parentChangeMatches(a, world);
      const scores = a.fm.scores;
      if (scores === null || typeof scores !== "object" || Array.isArray(scores)) {
        out.push(F("`scores` is not a map of hardening layers", a.lineOf("scores")));
        return out;
      }
      const allowed = ["pass", "concerns", "fail", "not-applicable"];
      for (const layer of HARDENING_LAYERS) {
        if (!(layer in scores)) {
          out.push(F(`\`scores\` is missing hardening layer \`${layer}\``, a.lineOf("scores")));
        } else if (!allowed.includes(String(scores[layer]))) {
          out.push(
            F(
              `scores.${layer} \`${scores[layer]}\` is not in the enum (${allowed.join(" | ")})`,
              a.lineOf("scores"),
            ),
          );
        }
      }
      return out;
    },
  },
  {
    id: "DR-01",
    type: "data-review",
    severity: "warn",
    description:
      "Every new table named in the Schema Changes section appears in `rls-coverage.new-tables`. The section is prose, so table extraction is a heuristic (an identifier immediately following a \"new table\" phrase) and this reports as a warning.",
    check(a) {
      const cov = a.fm["rls-coverage"]?.["new-tables"];
      const covered = cov && typeof cov === "object" ? Object.keys(cov) : [];
      const declared = newTablesFromSchemaChanges(a);
      const out = [];
      for (const t of declared) {
        if (!covered.includes(t)) {
          out.push(
            F(
              `new table \`${t}\` is named in Schema Changes but absent from \`rls-coverage.new-tables\``,
              a.lineOf("rls-coverage"),
            ),
          );
        }
      }
      return out;
    },
  },
  {
    id: "V-01",
    type: "verification",
    description:
      "`phase-coverage` keys equal the parent plan's `steps-completed`. A verification that covers a different phase set than the implementer completed is not evidence.",
    check(a, world) {
      const out = parentChangeMatches(a, world);
      const plan = siblingOfType(a, world, "plan");
      if (!plan) return out;
      const completed = arr(plan.fm["steps-completed"]).map(String).sort();
      const cov = a.fm["phase-coverage"];
      const covKeys =
        cov && typeof cov === "object" && !Array.isArray(cov) ? Object.keys(cov).sort() : [];
      if (completed.length === 0 && covKeys.length === 0) return out;
      if (JSON.stringify(completed) !== JSON.stringify(covKeys)) {
        out.push(
          F(
            `phase-coverage keys [${covKeys.join(", ")}] do not equal ${plan.relpath} steps-completed [${completed.join(", ")}]`,
            a.lineOf("phase-coverage"),
          ),
        );
      }
      return out;
    },
  },
  {
    id: "AR-01",
    type: "adversarial-review",
    description:
      "A review that reaches a findings status with an EMPTY `findings` array carries `findings-fewer-than-floor: true`, a non-null `justification-when-fewer`, and a filled Findings Floor Justification section. Reading a change cold and reporting nothing is a claim, and the artifact defends it. The count above zero is not gated (ADR-0014): `findings-floor` is the area's expectation, measured by the telemetry sidecar, and whether a finding is real is the reviewer's judgment, not the validator's arithmetic.",
    check(a, world) {
      const out = parentChangeMatches(a, world);
      const findings = arr(a.fm.findings);
      const empty = findings.length === 0 && isTerminal(a, ["findings-open", "findings-resolved"]);
      if (empty && a.fm["findings-fewer-than-floor"] !== true) {
        out.push(
          F(
            `status is \`${a.fm.status}\` with no findings; set \`findings-fewer-than-floor: true\` and defend the empty result, or file what you found`,
            a.lineOf("findings"),
          ),
        );
      }
      if (a.fm["findings-fewer-than-floor"] === true) {
        if (!present(a.fm["justification-when-fewer"])) {
          out.push(
            F(
              "`findings-fewer-than-floor: true` but `justification-when-fewer` is null",
              a.lineOf("justification-when-fewer"),
            ),
          );
        }
        const sec = findSection(a.sections, "Findings Floor Justification");
        if (!sec || substantiveLines(sec).length === 0) {
          out.push(F("`findings-fewer-than-floor: true` but the Findings Floor Justification section is empty"));
        }
      }
      return out;
    },
  },
  {
    id: "AR-02",
    type: "adversarial-review",
    description:
      "Every finding record carries id (F-01..F-N, sequential), category (controlled enum), severity, status, and a resolution of the shape `commit:<hash>` | `tech-debt:<id>` | `justified-in-prose`. `findings-resolved` additionally requires every finding at `status: resolved` with a resolution.",
    check(a) {
      const out = [];
      const findings = arr(a.fm.findings).filter((f) => f && typeof f === "object");
      findings.forEach((f, idx) => {
        const want = `F-${String(idx + 1).padStart(2, "0")}`;
        if (String(f.id ?? "") !== want) {
          out.push(F(`finding ${idx + 1} has id \`${f.id}\`; ids are sequential F-01..F-N (expected \`${want}\`)`, a.lineOf("findings")));
        }
        if (!AR_CATEGORIES.includes(String(f.category))) {
          out.push(
            F(
              `finding ${f.id ?? idx + 1} category \`${f.category}\` is not in the enum (${AR_CATEGORIES.join(" | ")})`,
              a.lineOf("findings"),
            ),
          );
        }
        if (!AR_SEVERITIES.includes(String(f.severity))) {
          out.push(
            F(
              `finding ${f.id ?? idx + 1} severity \`${f.severity}\` is not in the enum (${AR_SEVERITIES.join(" | ")})`,
              a.lineOf("findings"),
            ),
          );
        }
        if (!["open", "resolved"].includes(String(f.status))) {
          out.push(
            F(`finding ${f.id ?? idx + 1} status \`${f.status}\` is not \`open\` or \`resolved\``, a.lineOf("findings")),
          );
        }
        if (present(f.resolution) && !isValidResolution(String(f.resolution))) {
          out.push(
            F(
              `finding ${f.id ?? idx + 1} resolution \`${f.resolution}\` is not \`commit:<hash>\`, \`tech-debt:<id>\`, or \`justified-in-prose\``,
              a.lineOf("findings"),
            ),
          );
        }
      });
      if (String(a.fm.status) === "findings-resolved") {
        for (const f of findings) {
          if (String(f.status) !== "resolved" || !present(f.resolution)) {
            out.push(
              F(
                `status is \`findings-resolved\` but finding ${f.id} is \`${f.status}\` with resolution \`${f.resolution}\``,
                a.lineOf("status"),
              ),
            );
          }
        }
      }
      return out;
    },
  },
  {
    id: "AR-05",
    type: "adversarial-review",
    description:
      "A finding resolved as `tech-debt:<id>` references a tech-debt artifact that exists and, at write time, is at `open` or `in-progress`. A missing artifact is an error; a TD that has since reached a terminal status is the expected end-state of a shipped change and reports as a warning.",
    check(a, world) {
      const out = [];
      for (const f of arr(a.fm.findings).filter((x) => x && typeof x === "object")) {
        const res = String(f.resolution ?? "");
        if (!res.startsWith("tech-debt:")) continue;
        const tdId = res.slice("tech-debt:".length).trim();
        const td = world.byId.get(tdId);
        if (!td || td.type !== "tech-debt") {
          out.push(F(`finding ${f.id} resolves to \`${res}\` but no such tech-debt artifact exists`, a.lineOf("findings")));
        } else if (!["open", "in-progress"].includes(String(td.fm.status))) {
          out.push(
            F(
              `finding ${f.id} resolves to \`${res}\` but ${td.relpath} is at \`status: ${td.fm.status}\` (AR-05 wants open or in-progress at write time)`,
              a.lineOf("findings"),
              "warn",
            ),
          );
        }
      }
      return out;
    },
  },
  {
    id: "AR-06",
    type: "adversarial-review",
    description:
      "`findings-floor` is 3 by default and 5 when the parent change-spec's `area` is in {agent, auth, billing}. Since ADR-0014 the value gates nothing — it is the area's expected finding count, and this rule keeps the declared number honest so the telemetry sidecar's `findings_floor` / `findings_count` pair aggregates to something.",
    check(a, world) {
      const parent = parentSpec(a, world);
      if (!parent) return [];
      const want = ["agent", "auth", "billing"].includes(String(parent.fm.area)) ? 5 : 3;
      const got = Number(a.fm["findings-floor"]);
      if (!Number.isFinite(got)) {
        return [F("`findings-floor` is not a number", a.lineOf("findings-floor"))];
      }
      // A stricter floor than the area demands is a choice, not a violation.
      if (got < want) {
        return [
          F(
            `findings-floor is ${got} but the parent change-spec's area is \`${parent.fm.area}\`, which requires at least ${want}`,
            a.lineOf("findings-floor"),
          ),
        ];
      }
      return [];
    },
  },
  {
    id: "AR-07",
    type: "adversarial-review",
    description:
      "When the parent change-spec's `resolves-tech-debt` is non-empty, the Methodology section carries an explicit \"Acceptance Satisfied\" subsection. Presence is mechanical; whether the confirmation is honest is a judgment the reviewer owns.",
    check(a, world) {
      const parent = parentSpec(a, world);
      if (!parent) return [];
      if (arr(parent.fm["resolves-tech-debt"]).filter(present).length === 0) return [];
      const hit = a.sections.find((s) => /acceptance[- ]satisfied/i.test(s.title));
      if (!hit) {
        return [
          F(
            `parent change-spec resolves tech-debt but no "Acceptance Satisfied" subsection is present`,
          ),
        ];
      }
      if (substantiveLines(hit).length === 0) {
        return [F(`"Acceptance Satisfied" subsection is empty`, hit.line)];
      }
      return [];
    },
  },

  // -- TS: test-plan ---------------------------------------------------------
  {
    id: "TS-02",
    type: "test-plan",
    description: "`challenge-prompts-answered` equals 3, and each of the three prompts carries an answer.",
    check(a) {
      const out = [];
      if (Number(a.fm["challenge-prompts-answered"]) !== 3) {
        out.push(
          F(
            `challenge-prompts-answered is ${a.fm["challenge-prompts-answered"]}; must equal 3`,
            a.lineOf("challenge-prompts-answered"),
          ),
        );
      }
      if (isTerminal(a, ["passed", "concerns-acknowledged"])) {
        const prompts = a.sections.filter(
          (s) => s.level === 3 && /^\((a|b|c)\)/.test(s.title),
        );
        const answered = prompts.filter((s) => substantiveLines(s).length > 0);
        if (answered.length < 3) {
          out.push(
            F(
              `${answered.length} of 3 challenge prompts carry an answer under \`## Challenge Prompts\``,
            ),
          );
        }
      }
      return out;
    },
  },
  {
    id: "TS-03",
    type: "test-plan",
    description:
      "`tenant-isolation-tests` is non-empty when the parent change-spec's `surfaces` includes db, api, or agent.",
    check(a, world) {
      const parent = parentSpec(a, world);
      if (!parent) return [];
      const surfaces = arr(parent.fm.surfaces).map(String);
      if (!surfaces.some((s) => ["db", "api", "agent"].includes(s))) return [];
      if (arr(a.fm["tenant-isolation-tests"]).filter(present).length > 0) return [];
      return [
        F(
          `parent surfaces are [${surfaces.join(", ")}] but \`tenant-isolation-tests\` is empty`,
          a.lineOf("tenant-isolation-tests"),
        ),
      ];
    },
  },
  {
    id: "TS-04",
    type: "test-plan",
    description:
      "Status gating on partial layers: a `partial` coverage layer blocks `passed`; `concerns-acknowledged` requires `concerns-acknowledged-by` non-null and a filled Open Concerns section.",
    check(a) {
      const out = [];
      const layers = a.fm["coverage-layers"] ?? {};
      const allowed = ["addressed", "partial", "not-applicable"];
      const partial = Object.entries(layers).filter(([, v]) => String(v) === "partial");
      for (const [k, v] of Object.entries(layers)) {
        if (!allowed.includes(String(v))) {
          out.push(
            F(`coverage-layers.${k} \`${v}\` is not in the enum (${allowed.join(" | ")})`, a.lineOf("coverage-layers")),
          );
        }
      }
      if (String(a.fm.status) === "passed" && partial.length > 0) {
        out.push(
          F(
            `status is \`passed\` but ${partial.map(([k]) => k).join(", ")} coverage is \`partial\` — the terminal state for a deferred layer is \`concerns-acknowledged\``,
            a.lineOf("status"),
          ),
        );
      }
      if (String(a.fm.status) === "concerns-acknowledged") {
        if (!present(a.fm["concerns-acknowledged-by"])) {
          out.push(
            F(
              "status is `concerns-acknowledged` but `concerns-acknowledged-by` is null",
              a.lineOf("concerns-acknowledged-by"),
            ),
          );
        }
        const sec = findSection(a.sections, "Open Concerns");
        if (!sec || substantiveLines(sec).length === 0) {
          out.push(F("status is `concerns-acknowledged` but the Open Concerns section is empty"));
        }
      }
      return out;
    },
  },
  {
    id: "TS-05",
    type: "test-plan",
    description: "`fixture-strategy-declared` is true before `status: passed`.",
    check(a) {
      if (String(a.fm.status) !== "passed") return [];
      if (a.fm["fixture-strategy-declared"] === true) return [];
      return [
        F(
          "status is `passed` but `fixture-strategy-declared` is not true",
          a.lineOf("fixture-strategy-declared"),
        ),
      ];
    },
  },
  {
    id: "TS-06",
    type: "test-plan",
    severity: "warn",
    description:
      "Every change-spec invariant has a mapped test in `invariants-mapped`. The change-spec template gives invariants no ids, so the mechanizable proxy is count parity against the parent's Invariants bullets — reported as a warning because the proxy can disagree with a correct plan.",
    check(a, world) {
      if (!isTerminal(a, ["passed", "concerns-acknowledged"])) return [];
      const parent = parentSpec(a, world);
      if (!parent) return [];
      const sec = findSection(parent.sections, "Invariants");
      const want = sec ? bulletItems(sec).length : 0;
      const got = arr(a.fm["invariants-mapped"]).filter(present).length;
      if (want === 0) return [];
      if (got < want) {
        return [
          F(
            `invariants-mapped has ${got} entr(ies) against ${want} invariant bullet(s) in ${parent.relpath}`,
            a.lineOf("invariants-mapped"),
          ),
        ];
      }
      return [];
    },
  },

  // -- SR: security-review ---------------------------------------------------
  {
    id: "SR-02",
    type: "security-review",
    description:
      "`challenge-prompts-answered` equals 3, and the Challenge Prompts section carries three answers.",
    check(a) {
      const out = [];
      if (Number(a.fm["challenge-prompts-answered"]) !== 3) {
        out.push(
          F(
            `challenge-prompts-answered is ${a.fm["challenge-prompts-answered"]}; must equal 3`,
            a.lineOf("challenge-prompts-answered"),
          ),
        );
      }
      if (isTerminal(a, ["passed", "concerns-acknowledged"])) {
        const sec = findSection(a.sections, "Challenge Prompts");
        if (!sec || substantiveLines(sec).length === 0) {
          const subs = a.sections.filter(
            (s) => s.level === 3 && /^\((a|b|c)\)/.test(s.title) && substantiveLines(s).length > 0,
          );
          if (subs.length < 3) {
            out.push(F("the Challenge Prompts section carries fewer than three answers"));
          }
        }
      }
      return out;
    },
  },
  {
    id: "SR-03",
    type: "security-review",
    description:
      "`threat-model-delta-required` is true when the parent change-spec's surfaces touch agent / auth / api / db, and the Threat-Model Delta section is then non-empty.",
    check(a, world) {
      const parent = parentSpec(a, world);
      const out = [];
      if (parent) {
        const surfaces = arr(parent.fm.surfaces).map(String);
        const triggers = surfaces.some((s) => ["agent", "auth", "api", "db"].includes(s));
        if (triggers && a.fm["threat-model-delta-required"] !== true) {
          out.push(
            F(
              `parent surfaces are [${surfaces.join(", ")}] but \`threat-model-delta-required\` is not true`,
              a.lineOf("threat-model-delta-required"),
            ),
          );
        }
      }
      if (a.fm["threat-model-delta-required"] === true && isTerminal(a, ["passed", "concerns-acknowledged"])) {
        const sec = findSection(a.sections, "Threat-Model Delta");
        if (!sec || substantiveLines(sec).length === 0) {
          out.push(F("`threat-model-delta-required: true` but the Threat-Model Delta section is empty"));
        }
      }
      return out;
    },
  },
  {
    id: "SR-04",
    type: "security-review",
    description:
      "`status: concerns-acknowledged` requires `concerns-acknowledged-by` non-null and an Open Concerns section that enumerates each open concern.",
    check(a) {
      if (String(a.fm.status) !== "concerns-acknowledged") return [];
      const out = [];
      if (!present(a.fm["concerns-acknowledged-by"])) {
        out.push(
          F(
            "status is `concerns-acknowledged` but `concerns-acknowledged-by` is null",
            a.lineOf("concerns-acknowledged-by"),
          ),
        );
      }
      const sec = findSection(a.sections, "Open Concerns");
      if (!sec || substantiveLines(sec).length === 0) {
        out.push(F("status is `concerns-acknowledged` but the Open Concerns section is empty"));
      }
      return out;
    },
  },
  {
    id: "SR-05",
    type: "security-review",
    description:
      "`status: passed` is impossible when any hardening score is `concerns` or `fail`.",
    check(a) {
      if (String(a.fm.status) !== "passed") return [];
      const scores = a.fm.scores;
      if (!scores || typeof scores !== "object") return [];
      const bad = Object.entries(scores).filter(([, v]) =>
        ["concerns", "fail"].includes(String(v)),
      );
      if (bad.length === 0) return [];
      return [
        F(
          `status is \`passed\` but ${bad.map(([k, v]) => `${k}: ${v}`).join(", ")}`,
          a.lineOf("status"),
        ),
      ];
    },
  },

  // -- DR: data-review -------------------------------------------------------
  {
    id: "DR-02",
    type: "data-review",
    description:
      "`status: passed` requires every value in `rls-coverage.new-tables` to be `covered`.",
    check(a) {
      const cov = a.fm["rls-coverage"]?.["new-tables"];
      if (!cov || typeof cov !== "object") return [];
      const out = [];
      const allowed = ["covered", "partial", "missing"];
      for (const [table, v] of Object.entries(cov)) {
        if (!allowed.includes(String(v))) {
          out.push(
            F(
              `rls-coverage.new-tables.${table} \`${v}\` is not in the enum (${allowed.join(" | ")})`,
              a.lineOf("rls-coverage"),
            ),
          );
        }
      }
      if (String(a.fm.status) === "passed") {
        const bad = Object.entries(cov).filter(([, v]) => String(v) !== "covered");
        if (bad.length > 0) {
          out.push(
            F(
              `status is \`passed\` but RLS coverage is ${bad.map(([k, v]) => `${k}: ${v}`).join(", ")}`,
              a.lineOf("status"),
            ),
          );
        }
      }
      return out;
    },
  },
  {
    id: "DR-03",
    type: "data-review",
    description:
      "When any pgvector RPC is modified, `pgvector-changes.tenant-id-arg-present` must be true. A dropped tenant argument is a kernel-level stop condition, not a style note.",
    check(a) {
      const pg = a.fm["pgvector-changes"];
      if (!pg || typeof pg !== "object") return [];
      if (arr(pg["rpcs-modified"]).filter(present).length === 0) return [];
      if (pg["tenant-id-arg-present"] === true) return [];
      return [
        F(
          `pgvector RPCs are modified (${arr(pg["rpcs-modified"]).join(", ")}) but \`tenant-id-arg-present\` is ${pg["tenant-id-arg-present"]}`,
          a.lineOf("pgvector-changes"),
        ),
      ];
    },
  },
  {
    id: "DR-04",
    type: "data-review",
    description:
      "`migration-safety: risky` requires the Migration Safety section to enumerate locking behavior and mitigation. Presence and non-emptiness are mechanical; the adequacy of the mitigation is the data-specialist's judgment.",
    check(a) {
      if (String(a.fm["migration-safety"]) !== "risky") return [];
      const sec = findSection(a.sections, "Migration Safety");
      if (!sec || substantiveLines(sec).length === 0) {
        return [F("`migration-safety: risky` but the Migration Safety section is empty")];
      }
      return [];
    },
  },
  {
    id: "DR-05",
    type: "data-review",
    description:
      "Every table in `rls-coverage.new-tables` has an entry in the RLS Coverage section.",
    check(a) {
      const cov = a.fm["rls-coverage"]?.["new-tables"];
      if (!cov || typeof cov !== "object" || Object.keys(cov).length === 0) return [];
      const sec = findSection(a.sections, "RLS Coverage");
      if (!sec) return [F("`rls-coverage.new-tables` is populated but there is no RLS Coverage section")];
      const text = sectionText(sec);
      const out = [];
      for (const table of Object.keys(cov)) {
        if (!text.includes(table)) {
          out.push(F(`table \`${table}\` has no entry in the RLS Coverage section`, sec.line));
        }
      }
      return out;
    },
  },
  {
    id: "DR-06",
    type: "data-review",
    description: "`data-lifecycle` is one of the controlled values.",
    check(a) {
      const v = a.fm["data-lifecycle"];
      if (v === null || v === undefined) return [];
      const s = String(v);
      if (s === "retained-indefinitely" || s === "ephemeral" || /^retained-\d+-days$/.test(s)) {
        return [];
      }
      return [
        F(
          `data-lifecycle \`${s}\` is not in the enum (retained-indefinitely | retained-N-days | ephemeral)`,
          a.lineOf("data-lifecycle"),
        ),
      ];
    },
  },

  // -- PL: plan --------------------------------------------------------------
  {
    id: "PL-02",
    type: "plan",
    description:
      "A plan with more than 12 phases requires `oversized-plan-justification`; the Phase Overview table and the Per-Phase Detail subsections must name the same phase set.",
    check(a) {
      const out = [];
      const phases = planPhases(a);
      if (phases.detail.length > 12 && !present(a.fm["oversized-plan-justification"])) {
        out.push(
          F(
            `${phases.detail.length} phases exceed the 12-phase norm but \`oversized-plan-justification\` is null`,
            a.lineOf("oversized-plan-justification"),
          ),
        );
      }
      if (phases.overview.length > 0 && phases.detail.length > 0) {
        const missing = phases.overview.filter((p) => !phases.detail.includes(p));
        const extra = phases.detail.filter((p) => !phases.overview.includes(p));
        for (const p of missing) {
          out.push(F(`phase \`${p}\` is in the Phase Overview table but has no Per-Phase Detail subsection`));
        }
        for (const p of extra) {
          out.push(F(`phase \`${p}\` has a Per-Phase Detail subsection but is not in the Phase Overview table`));
        }
      }
      return out;
    },
  },
  {
    id: "PL-03",
    type: "plan",
    description: "Every `steps-completed` entry matches a phase id declared in the plan body.",
    check(a) {
      const phases = planPhases(a);
      const known = new Set([...phases.overview, ...phases.detail]);
      if (known.size === 0) return [];
      const out = [];
      for (const step of arr(a.fm["steps-completed"]).filter(present)) {
        if (!known.has(String(step))) {
          out.push(
            F(
              `steps-completed entry \`${step}\` matches no phase id in the plan body (known: ${[...known].join(", ")})`,
              a.lineOf("steps-completed"),
            ),
          );
        }
      }
      return out;
    },
  },
  {
    id: "PL-04",
    type: "plan",
    description:
      "Every Files Touched path is inside the parent change-spec's `in-scope` allowlist.",
    check(a, world) {
      const parent = parentSpec(a, world);
      if (!parent) return [];
      const inScope = arr(parent.fm["in-scope"]).filter(present).map(String);
      if (inScope.length === 0) return [];
      const out = [];
      for (const { phase, path, line } of filesTouched(a)) {
        if (!inScope.some((g) => globMatches(g, path))) {
          out.push(
            F(
              `phase \`${phase}\` touches \`${path}\`, which no \`in-scope\` glob in ${parent.relpath} covers`,
              line,
            ),
          );
        }
      }
      return out;
    },
  },
  {
    id: "PL-05",
    type: "plan",
    description:
      "Plan status gating: `ready` requires all five sections filled; `completed` requires `steps-completed` to cover every phase in the body and `blocked-on` to be null.",
    check(a) {
      const status = String(a.fm.status);
      const out = [];
      if (["ready", "in-progress", "completed"].includes(status)) {
        out.push(
          ...requireSections(a, [
            "Roadmap Alignment",
            "Phase Overview",
            "Per-Phase Detail",
            "Cross-Phase Risks",
            "Rollback",
          ]),
        );
      }
      if (status === "completed") {
        const phases = planPhases(a);
        const known = phases.detail.length > 0 ? phases.detail : phases.overview;
        const done = new Set(arr(a.fm["steps-completed"]).map(String));
        const missing = known.filter((p) => !done.has(p));
        if (missing.length > 0) {
          out.push(
            F(
              `status is \`completed\` but steps-completed omits ${missing.join(", ")}`,
              a.lineOf("steps-completed"),
            ),
          );
        }
        if (present(a.fm["blocked-on"])) {
          out.push(
            F(`status is \`completed\` but \`blocked-on\` is \`${a.fm["blocked-on"]}\``, a.lineOf("blocked-on")),
          );
        }
      }
      return out;
    },
  },

  // -- V: verification -------------------------------------------------------
  {
    id: "V-02",
    type: "verification",
    description: "Any `fail` in `test-results` blocks `status: passed`.",
    check(a) {
      const results = a.fm["test-results"];
      if (!results || typeof results !== "object") return [];
      const out = [];
      const allowed = ["pass", "fail", "pending", "not-run"];
      for (const [k, v] of Object.entries(results)) {
        if (!allowed.includes(String(v))) {
          out.push(
            F(`test-results.${k} \`${v}\` is not in the enum (${allowed.join(" | ")})`, a.lineOf("test-results")),
          );
        }
      }
      if (String(a.fm.status) === "passed") {
        const failed = Object.entries(results).filter(([, v]) => String(v) === "fail");
        if (failed.length > 0) {
          out.push(
            F(
              `status is \`passed\` but ${failed.map(([k]) => k).join(", ")} failed`,
              a.lineOf("status"),
            ),
          );
        }
      }
      return out;
    },
  },
  {
    id: "V-03",
    type: "verification",
    description:
      "`status: passed` requires `test-plan-coverage.tenant-isolation` to be `all-observed` or `not-applicable`; a `partial` or `missing` tenant-isolation observation is escalated, never passed.",
    check(a) {
      const cov = a.fm["test-plan-coverage"];
      if (!cov || typeof cov !== "object") return [];
      const out = [];
      const allowed = ["all-observed", "partial", "missing", "not-applicable", "pending"];
      const v = String(cov["tenant-isolation"]);
      if (cov["tenant-isolation"] !== undefined && !allowed.includes(v)) {
        out.push(
          F(
            `test-plan-coverage.tenant-isolation \`${v}\` is not in the enum (${allowed.join(" | ")})`,
            a.lineOf("test-plan-coverage"),
          ),
        );
      }
      if (String(a.fm.status) === "passed" && ["partial", "missing", "pending"].includes(v)) {
        out.push(
          F(
            `status is \`passed\` but test-plan-coverage.tenant-isolation is \`${v}\``,
            a.lineOf("status"),
          ),
        );
      }
      return out;
    },
  },
  {
    id: "V-04",
    type: "verification",
    description:
      "`status: passed` requires `test-plan-coverage.performance-budgets` to be `all-within-budget` or `not-applicable`.",
    check(a) {
      const cov = a.fm["test-plan-coverage"];
      if (!cov || typeof cov !== "object") return [];
      const out = [];
      const allowed = [
        "all-within-budget",
        "regressed",
        "missing",
        "not-applicable",
        "pending",
      ];
      const v = String(cov["performance-budgets"]);
      if (cov["performance-budgets"] !== undefined && !allowed.includes(v)) {
        out.push(
          F(
            `test-plan-coverage.performance-budgets \`${v}\` is not in the enum (${allowed.join(" | ")})`,
            a.lineOf("test-plan-coverage"),
          ),
        );
      }
      if (String(a.fm.status) === "passed" && ["regressed", "missing", "pending"].includes(v)) {
        out.push(
          F(
            `status is \`passed\` but test-plan-coverage.performance-budgets is \`${v}\``,
            a.lineOf("status"),
          ),
        );
      }
      return out;
    },
  },
  {
    id: "V-05",
    type: "verification",
    description:
      "A suite recorded as `not-run` is not evidence: `status: passed` requires unit / integration / e2e to be `pass` or `not-run` *with* a Discrepancies entry. The observed-test-count confirmation itself is the verifier's judgment and stays out of the validator.",
    check(a) {
      if (String(a.fm.status) !== "passed") return [];
      const results = a.fm["test-results"] ?? {};
      const notRun = ["unit", "integration", "e2e"].filter(
        (k) => String(results[k]) === "not-run",
      );
      const pending = Object.entries(results).filter(([, v]) => String(v) === "pending");
      const out = [];
      if (pending.length > 0) {
        out.push(
          F(
            `status is \`passed\` but ${pending.map(([k]) => k).join(", ")} is still \`pending\``,
            a.lineOf("test-results"),
          ),
        );
      }
      if (notRun.length > 0) {
        const sec = findSection(a.sections, "Discrepancies");
        if (!sec || substantiveLines(sec).length === 0) {
          out.push(
            F(
              `${notRun.join(", ")} recorded as \`not-run\` at \`status: passed\` with no Discrepancies entry`,
              a.lineOf("test-results"),
            ),
          );
        }
      }
      return out;
    },
  },

  // -- KF: kernel-fit findings ----------------------------------------------
  {
    id: "KF-01",
    type: "kernel-fit-finding",
    description:
      "`evidence-row-count` equals `len(evidence-rows)` and is at least 1. No finding without cited evidence.",
    check(a) {
      const rows = arr(a.fm["evidence-rows"]);
      const count = Number(a.fm["evidence-row-count"]);
      const out = [];
      if (rows.length !== count) {
        out.push(
          F(
            `evidence-row-count is ${a.fm["evidence-row-count"]} but evidence-rows has ${rows.length} entr(ies)`,
            a.lineOf("evidence-row-count"),
          ),
        );
      }
      if (rows.length < 1) {
        out.push(F("evidence-rows is empty; a finding needs at least one cited row", a.lineOf("evidence-rows")));
      }
      return out;
    },
  },
  {
    id: "KF-02",
    type: "kernel-fit-finding",
    description:
      "`confidence: high` requires `evidence-row-count >= 3` and at least two distinct change-specs cited in `evidence-rows`.",
    check(a) {
      if (String(a.fm.confidence) !== "high") return [];
      const rows = arr(a.fm["evidence-rows"]).filter((r) => r && typeof r === "object");
      const out = [];
      if (Number(a.fm["evidence-row-count"]) < 3) {
        out.push(
          F(
            `confidence is \`high\` but evidence-row-count is ${a.fm["evidence-row-count"]} (needs >= 3)`,
            a.lineOf("confidence"),
          ),
        );
      }
      const changes = new Set(rows.map((r) => r.change).filter(present).map(String));
      if (changes.size < 2) {
        out.push(
          F(
            `confidence is \`high\` but evidence-rows cite ${changes.size} distinct change-spec(s) (needs >= 2)`,
            a.lineOf("confidence"),
          ),
        );
      }
      return out;
    },
  },
  {
    id: "KF-03",
    type: "kernel-fit-finding",
    description:
      "The mandatory Counter-explanations section carries two entries; fewer means `confidence` must be `low`.",
    check(a) {
      const sec = a.sections.find((s) => /^counter-explanations/i.test(s.title));
      if (!sec) return [F("no Counter-explanations section (challenge prompt is mandatory)")];
      const items = substantiveLines(sec).filter((l) => /^\s*(\d+\.|[-*])\s+\S/.test(l));
      if (items.length >= 2) return [];
      if (String(a.fm.confidence) === "low") return [];
      return [
        F(
          `Counter-explanations has ${items.length} entr(y|ies); fewer than two auto-downgrades confidence to \`low\` (currently \`${a.fm.confidence}\`)`,
          sec.line,
        ),
      ];
    },
  },
  {
    id: "KF-04",
    type: "kernel-fit-finding",
    description:
      "`status: promoted` requires `promoted-to` non-null pointing at an ADR or tech-debt that exists and carries the reciprocal back-reference; at terminal-write (any other status) `promoted-to` stays null.",
    check(a, world) {
      const status = String(a.fm.status);
      const target = a.fm["promoted-to"];
      if (status !== "promoted") {
        if (present(target)) {
          return [
            F(
              `promoted-to is \`${target}\` but status is \`${status}\` — promotion is downstream of the analyst's terminal write`,
              a.lineOf("promoted-to"),
            ),
          ];
        }
        return [];
      }
      if (!present(target)) {
        return [F("status is `promoted` but `promoted-to` is null", a.lineOf("promoted-to"))];
      }
      const s = String(target);
      const m = /^(adr|tech-debt):(.+)$/.exec(s);
      if (!m) {
        return [
          F(
            `promoted-to \`${s}\` is not \`adr:<ADR-NNNN-slug>\` or \`tech-debt:<TD-NNNN-slug>\``,
            a.lineOf("promoted-to"),
          ),
        ];
      }
      const other = world.byId.get(m[2]);
      if (!other) {
        return [F(`promoted-to \`${s}\` names no artifact on disk`, a.lineOf("promoted-to"))];
      }
      if (m[1] === "adr") {
        if (!arr(other.fm["promoted-from-kernel-fit"]).map(String).includes(String(a.fm.id))) {
          return [
            F(
              `promoted-to \`${s}\` but ${other.relpath} does not list \`${a.fm.id}\` in \`promoted-from-kernel-fit\` — the reciprocal half is missing`,
              a.lineOf("promoted-to"),
            ),
          ];
        }
      }
      return [];
    },
  },
  {
    id: "KF-05",
    type: "kernel-fit-finding",
    description:
      "`status: dismissed` requires a non-null `dismissed-reason`; at any other status `dismissed-reason` stays null. Presence is mechanical. Whether the reason says something a reader could re-evaluate in six months is `/hstack:kernel-fit-triage`'s judgment — the old `>= 50 characters` clause measured length where it meant substance (ADR-0014).",
    check(a) {
      const status = String(a.fm.status);
      const reason = a.fm["dismissed-reason"];
      if (status !== "dismissed") {
        if (present(reason)) {
          return [
            F(
              `dismissed-reason is set but status is \`${status}\` — dismissal is downstream of the analyst's terminal write`,
              a.lineOf("dismissed-reason"),
            ),
          ];
        }
        return [];
      }
      if (!present(reason)) {
        return [F("status is `dismissed` but `dismissed-reason` is null", a.lineOf("dismissed-reason"))];
      }
      // ADR-0014: the old `>= 50 chars` clause measured length where it meant
      // substance. It passed padding and rejected tight correct sentences.
      // Whether the reason holds up is the triage Skill's judgment.
      return [];
    },
  },

  // -- MS: module-spec -------------------------------------------------------
  {
    id: "MS-01",
    type: "module-spec",
    description:
      "`paths` is non-empty and every glob resolves to something on disk. An unresolvable path means the module-to-paths mapping has drifted from the tree.",
    check(a, world) {
      const paths = arr(a.fm.paths).filter(present).map(String);
      if (paths.length === 0) {
        return [F("`paths` is empty; the module-to-paths mapping is required", a.lineOf("paths"))];
      }
      const out = [];
      for (const p of paths) {
        if (!pathGlobResolves(world.repoRoot, p)) {
          out.push(F(`\`paths\` entry \`${p}\` resolves to nothing on disk`, a.lineOf("paths")));
        }
      }
      return out;
    },
  },
  {
    id: "MS-02",
    type: "module-spec",
    description:
      "No module-spec's `paths` overlap another's. Overlap means a change-spec's `area` is ambiguous.",
    check(a, world) {
      const others = (world.byType.get("module-spec") ?? []).filter((m) => m !== a);
      const mine = arr(a.fm.paths).filter(present).map(String);
      const out = [];
      for (const other of others) {
        // Report each pair once, from the alphabetically-first module.
        if (String(a.fm.id) > String(other.fm.id)) continue;
        for (const p of mine) {
          for (const q of arr(other.fm.paths).filter(present).map(String)) {
            if (globsOverlap(p, q)) {
              out.push(
                F(
                  `paths entry \`${p}\` overlaps \`${q}\` in ${other.relpath} — module-to-paths mapping is ambiguous`,
                  a.lineOf("paths"),
                ),
              );
            }
          }
        }
      }
      return out;
    },
  },
  {
    id: "MS-03",
    type: "module-spec",
    description: "The Invariants section names at least three invariants.",
    check(a) {
      if (String(a.fm.status) === "drafted" || String(a.fm.status) === "archived") return [];
      const sec = findSection(a.sections, "Invariants");
      if (!sec) return [F("no `## Invariants` section")];
      const n = bulletItems(sec).length;
      if (n < 3) return [F(`Invariants has ${n} bullet(s); MS-03 requires at least 3`, sec.line)];
      return [];
    },
  },

  // -- UI: ui-brief ----------------------------------------------------------
  {
    id: "UI-01",
    type: "ui-brief",
    description:
      "Every `new-components` entry has a justification subsection under New Components.",
    check(a) {
      const comps = arr(a.fm["new-components"]).filter(present).map(String);
      if (comps.length === 0) return [];
      const sec = findSection(a.sections, "New Components");
      if (!sec) {
        return [F("`new-components` is non-empty but there is no New Components section", a.lineOf("new-components"))];
      }
      const text = sectionText(sec);
      const out = [];
      for (const c of comps) {
        // Component ids are sometimes path-qualified (`orchestrator/Foo`) while
        // the justification heading names the component alone.
        const leaf = c.split("/").pop();
        if (!text.includes(c) && !(leaf && text.includes(leaf))) {
          out.push(F(`new component \`${c}\` has no justification in the New Components section`, sec.line));
        }
      }
      return out;
    },
  },
  {
    id: "UI-02",
    type: "ui-brief",
    description:
      "`design-system-version` matches the value declared in `hstack/config.yaml`. Skipped silently when the config declares no version.",
    check(a, world) {
      const want = world.designSystemVersion;
      if (!present(want)) return [];
      const got = a.fm["design-system-version"];
      if (!present(got)) {
        return [F("`design-system-version` is null", a.lineOf("design-system-version"))];
      }
      if (String(got) !== String(want)) {
        return [
          F(
            `design-system-version \`${got}\` does not match hstack/config.yaml (\`${want}\`)`,
            a.lineOf("design-system-version"),
          ),
        ];
      }
      return [];
    },
  },
  {
    id: "UI-02",
    variant: "figma-handoff",
    type: "figma-handoff",
    description:
      "A figma-handoff's `design-system-version` matches its parent ui-brief.",
    check(a, world) {
      const brief = siblingOfType(a, world, "ui-brief");
      if (!brief) return [];
      const got = a.fm["design-system-version"];
      const want = brief.fm["design-system-version"];
      if (!present(got) || !present(want)) return [];
      if (String(got) !== String(want)) {
        return [
          F(
            `design-system-version \`${got}\` does not match ${brief.relpath} (\`${want}\`)`,
            a.lineOf("design-system-version"),
          ),
        ];
      }
      return [];
    },
  },

  // -- ST: story -------------------------------------------------------------
  {
    id: "ST-01",
    type: "story",
    description:
      "`persona` references a persona artifact that exists. Skipped when the repo keeps personas outside the tree (no persona artifacts found).",
    check(a, world) {
      const personas = world.byType.get("persona") ?? [];
      if (personas.length === 0) return [];
      const p = a.fm.persona;
      if (!present(p)) return [F("`persona` is null", a.lineOf("persona"))];
      const hit = personas.find((x) => String(x.fm.id) === String(p));
      if (!hit) {
        return [F(`persona \`${p}\` names no persona artifact on disk`, a.lineOf("persona"))];
      }
      return [];
    },
  },
  {
    id: "ST-02",
    type: "story",
    description: "`linked-change-specs` is non-empty once the story is `in-flight` or later.",
    check(a) {
      if (!["in-flight", "shipped"].includes(String(a.fm.status))) return [];
      if (arr(a.fm["linked-change-specs"]).filter(present).length > 0) return [];
      return [
        F(
          `status is \`${a.fm.status}\` but \`linked-change-specs\` is empty`,
          a.lineOf("linked-change-specs"),
        ),
      ];
    },
  },
  {
    id: "ST-03",
    type: "story",
    description: "`success-metric` is a non-empty string.",
    check(a) {
      if (present(a.fm["success-metric"])) return [];
      return [F("`success-metric` is empty", a.lineOf("success-metric"))];
    },
  },

  // -- INF: infrastructure ---------------------------------------------------
  {
    id: "INF-01",
    type: "infrastructure",
    description: "Every H2 named in the infrastructure template is present.",
    check(a) {
      const missing = INFRA_SECTIONS.filter((t) => !findSection(a.sections, t));
      if (missing.length === 0) return [];
      return [F(`missing required section(s): ${missing.join(", ")}`)];
    },
  },
  {
    id: "INF-02",
    type: "infrastructure",
    description: "The Unknowns section is present even when empty.",
    check(a) {
      if (findSection(a.sections, "Unknowns")) return [];
      return [F("no `## Unknowns` section — it is required even when empty")];
    },
  },
  {
    id: "INF-03",
    type: "infrastructure",
    description:
      "The Blast-Radius Matrix lists at least one row once status is `current`.",
    check(a) {
      if (String(a.fm.status) !== "current") return [];
      const sec = findSection(a.sections, "Blast-Radius Matrix");
      if (!sec) return [F("no `## Blast-Radius Matrix` section")];
      const rows = substantiveLines(sec).filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s|:-]*\|\s*$/.test(l));
      // Drop the header row.
      if (rows.length <= 1) {
        return [F("Blast-Radius Matrix has no data rows at `status: current`", sec.line)];
      }
      return [];
    },
  },

  // -- FL: kernel-fit flags --------------------------------------------------
  {
    id: "FL-01",
    type: "kernel-fit-flag",
    description:
      "Every pin-time field is non-null at `status: pending`: session-id, session-transcript-path, branch, head, workspace, timestamp, pre-compaction-message-count. `hint` is optional, and when set is one whitespace-free token of at most 32 characters — a real format constraint on a pointer token, mechanized here rather than left as prose in `/hstack:flag` (ADR-0014).",
    check(a) {
      const fields = [
        "session-id",
        "session-transcript-path",
        "branch",
        "head",
        "workspace",
        "timestamp",
        "pre-compaction-message-count",
      ];
      const out = fields
        .filter((f) => !present(a.fm[f]))
        .map((f) => F(`pin-time field \`${f}\` is null`, a.lineOf(f)));
      const hint = a.fm.hint;
      if (present(hint)) {
        const h = String(hint);
        if (/\s/.test(h)) {
          out.push(F(`hint \`${h}\` carries whitespace; the pin stores the first token only`, a.lineOf("hint")));
        } else if (h.length > 32) {
          out.push(F(`hint is ${h.length} chars; the pin caps it at 32`, a.lineOf("hint")));
        }
      }
      return out;
    },
  },
  {
    id: "FL-02",
    type: "kernel-fit-flag",
    description:
      "`status: processed` requires `classification` and `classification-rationale` non-null.",
    check(a) {
      if (String(a.fm.status) !== "processed") return [];
      return ["classification", "classification-rationale"]
        .filter((f) => !present(a.fm[f]))
        .map((f) => F(`status is \`processed\` but \`${f}\` is null`, a.lineOf(f)));
    },
  },

  // -- CM: coord-messages ----------------------------------------------------
  {
    id: "CM-01",
    type: "coord-message",
    description:
      "`from-repo`, `from-branch`, `to-repo`, and `subject` are non-null at send-time; `subject` is at most 80 characters.",
    check(a) {
      const out = ["from-repo", "from-branch", "to-repo", "subject"]
        .filter((f) => !present(a.fm[f]))
        .map((f) => F(`\`${f}\` is null at send-time`, a.lineOf(f)));
      // CM-01's stated text is the non-null requirement; `<= 80 chars` is the
      // template's shape note for the same field, so it surfaces as a warning.
      const subject = a.fm.subject;
      if (present(subject) && String(subject).length > 80) {
        out.push(
          F(
            `subject is ${String(subject).length} chars; the template caps it at 80`,
            a.lineOf("subject"),
            "warn",
          ),
        );
      }
      return out;
    },
  },

  // -- Body structure --------------------------------------------------------
  {
    id: "SP-06",
    variant: "required-sections",
    type: "change-spec",
    description:
      "The change-spec's contract sections carry content once the spec is past draft: Problem, Current Behavior, Target Behavior, Acceptance Criteria, Surfaces. (Invariants is SP-04, Scope Boundaries is the SP-06 primary check.)",
    check(a) {
      if (!CHANGE_SPEC_BEYOND_DRAFT(a.fm.status)) return [];
      const out = requireSections(a, [
        "Problem",
        "Current Behavior",
        "Target Behavior",
        "Acceptance Criteria",
        "Surfaces",
      ]);
      if (arr(a.fm["resolves-tech-debt"]).filter(present).length > 0) {
        const sec = findSection(a.sections, "Resolves Tech-Debt");
        if (!sec || substantiveLines(sec).length === 0) {
          out.push(
            F(
              "`resolves-tech-debt` is non-empty but the Resolves Tech-Debt section is empty (it must quote each TD's Acceptance verbatim)",
            ),
          );
        }
      }
      return out;
    },
  },
];

const HARDENING_LAYERS = [
  "data-at-rest",
  "data-in-transit",
  "authn",
  "authz-rls",
  "tenant-isolation",
  "input-validation",
  "output-encoding",
  "secrets-handling",
  "agent-prompt-injection",
  "audit-logging",
];

const AR_CATEGORIES = [
  "security",
  "scope-drift",
  "invariant-breach",
  "spec-compliance",
  "data-integrity",
  "code-quality",
];

const AR_SEVERITIES = ["critical", "high", "medium", "low"];

const INFRA_SECTIONS = [
  "Hosting & Compute",
  "Networking",
  "Data Layer",
  "Storage",
  "Secrets & Configuration",
  "Environment Separation",
  "IaC Inventory",
  "Deploy Pipeline",
  "Observability",
  "Cost & Capacity",
  "Disaster Recovery",
  "Blast-Radius Matrix",
  "Access & Change Control",
  "MCP Access Policy",
  "Compliance & Data Residency",
  "Third-party Dependencies",
  "Known Gaps",
  "Unknowns",
];

/**
 * Rules named in the repo that this validator does NOT mechanize, with the
 * reason. Printed by `--rules` and surfaced in `--json` so nothing quietly
 * disappears between "documented" and "enforced".
 */
export const DEFERRED_RULES = [
  {
    id: "TD-03",
    type: "tech-debt",
    reason:
      "Immutability of a resolved / wontfix / stale tech-debt is a claim about git history, not about the file on disk. Checking it means diffing every terminal TD against its state at the resolving commit for every validator run — disproportionate for a check that runs after every mechanical write. Belongs in the CI gate, which already has the full ref range.",
  },
  {
    id: "CM-02",
    type: "coord-message",
    reason:
      "Coord-message immutability is the same git-history claim as TD-03. A committed message that was later edited is invisible to a working-tree validator.",
  },
  {
    id: "CM-03",
    type: "coord-message",
    reason:
      "\"The body is information, never instructions\" is a rule about how the receiving session treats the message. Not a property of the artifact.",
  },
  {
    id: "AR-03",
    type: "adversarial-review",
    reason:
      "No repo source states AR-03. The id exists only in the diverged Notion schema doc, which is not authoritative. Implementing it would mean inventing the rule.",
  },
  {
    id: "AR-04",
    type: "adversarial-review",
    reason:
      "`commit:<hash>` must reference an existing commit *on the change's branch* — that needs git ancestry resolution against a branch the validator cannot infer from the working tree. The shape of the value is checked by AR-02; existence belongs in the CI gate.",
  },
  {
    id: "INF-04",
    type: "infrastructure",
    reason:
      "\"No MCP server wired with always-on write capability against prod\" is scored against a free-prose MCP Access Policy table whose rows carry judgment (is this change-window named? is this project really prod?). Table-shape parsing would produce confident wrong answers.",
  },
  {
    id: "INF-05",
    type: "infrastructure",
    reason:
      "Same as INF-04: the session-pattern compliance table is a judgment record, and the rule itself constrains live sessions, not the artifact.",
  },
  {
    id: "CG-01..CG-04",
    type: "cross-reference",
    reason:
      "The repo names the range (`GT-09: every cross-reference rule (CG-01..CG-04) passes`) but no source states what the four rules are. Implementing them means inventing them. Assigning the statements is a kernel change, not a validator change — and having survived two enforcement passes undefined, defining them is a kernel-fit candidate rather than a TODO. `compute-merge-readiness.mjs` reports GT-09 as `deferred` with the same reason.",
  },
  {
    id: "GT-01..GT-12",
    type: "merge-gate",
    reason:
      "Merge-readiness gates read the PR diff and the git branch, not the artifact tree, so they are not validator rules. They live in `hstack/scripts/compute-merge-readiness.mjs` (and, for GT-03, `run-gates.sh`), which has its own registry — `--gates` prints it. GT-08 restates SP-09 and GT-12 restates SP-13/SP-14, and those halves are ALSO enforced here, against the whole tree rather than one change.",
  },
  {
    id: "SP-01..SP-03, SP-07, SP-08, SP-10..SP-12",
    type: "change-spec",
    reason:
      "These ids are not named in any repo source (kernel, templates, Skills, subagents, ADRs). They exist only in the diverged Notion schema doc. No id squatting: they stay unimplemented until a kernel change states them.",
  },
  {
    id: "judgment-rules",
    type: "*",
    reason:
      "Quality rules stay with the subagents: whether a challenge-prompt answer actually probes for omissions, whether an adversarial finding is real or quota-filler, whether a severity is calibrated, whether a counter-explanation genuinely weakens its finding, whether a rationale paragraph is honest about a degraded read source. A validator that scored these would be an LLM, and the kernel already has one in the loop.",
  },
];

// ---------------------------------------------------------------------------
// 5. Rule helpers
// ---------------------------------------------------------------------------

function isRealDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function adrNumber(id) {
  const m = /^ADR-(\d{4})/.exec(String(id ?? ""));
  return m ? Number(m[1]) : null;
}

function pad4(n) {
  return String(n).padStart(4, "0");
}

function isTerminal(a, terminals) {
  return terminals.includes(String(a.fm.status));
}

function requireSections(a, titles) {
  const out = [];
  for (const t of titles) {
    const sec = findSection(a.sections, t);
    if (!sec) out.push(F(`missing required section \`## ${t}\``));
    else if (substantiveLines(sec).length === 0) {
      out.push(F(`section \`## ${t}\` carries no content`, sec.line));
    }
  }
  return out;
}

/** The change-spec that owns the folder this per-change artifact lives in. */
function parentSpec(a, world) {
  const sibling = world.byPath.get(join(dirname(a.path), "spec.md"));
  if (sibling && sibling.type === "change-spec") return sibling;
  const byId = world.byId.get(String(a.fm["parent-change"]));
  return byId && byId.type === "change-spec" ? byId : null;
}

function siblingOfType(a, world, type) {
  for (const other of world.artifacts) {
    if (other !== a && other.type === type && dirname(other.path) === dirname(a.path)) {
      return other;
    }
  }
  return null;
}

function parentChangeMatches(a, world) {
  const sibling = world.byPath.get(join(dirname(a.path), "spec.md"));
  if (!sibling || sibling.type !== "change-spec") return [];
  if (String(a.fm["parent-change"]) !== String(sibling.fm.id)) {
    return [
      F(
        `parent-change is \`${a.fm["parent-change"]}\` but the enclosing change folder holds \`${sibling.fm.id}\``,
        a.lineOf("parent-change"),
      ),
    ];
  }
  return [];
}

function isValidResolution(s) {
  if (s === "justified-in-prose") return true;
  if (/^commit:[0-9a-f]{7,40}$/i.test(s)) return true;
  if (/^tech-debt:\S+$/.test(s)) return true;
  return false;
}

/**
 * Table names declared in the data-review Schema Changes section.
 *
 * The section is prose, so this reads only the identifier that immediately
 * follows a "new table" phrase — never every backticked token on the line,
 * which sweeps up column names. DR-01 reports as a warning because of it.
 */
function newTablesFromSchemaChanges(a) {
  const sec = findSection(a.sections, "Schema Changes");
  if (!sec) return [];
  const out = new Set();
  for (const line of substantiveLines(sec)) {
    for (const m of line.matchAll(
      /new\s+table[^`\n]{0,30}?`([a-z_][a-z0-9_]*)`/gi,
    )) {
      out.add(m[1]);
    }
  }
  return [...out];
}

/** Phase ids declared in a plan's Phase Overview table and Per-Phase Detail. */
function planPhases(a) {
  const overview = [];
  const overviewSec = findSection(a.sections, "Phase Overview");
  if (overviewSec) {
    for (const line of overviewSec.lines) {
      const m = /^\s*\|\s*`?([a-z0-9][a-z0-9-]*)`?\s*\|/.exec(line);
      if (m && m[1] !== "step-id" && !/^-+$/.test(m[1])) overview.push(m[1]);
    }
  }
  const detailSec = findSection(a.sections, "Per-Phase Detail");
  const detail = [];
  if (detailSec) {
    const start = a.sections.indexOf(detailSec);
    for (let i = start + 1; i < a.sections.length; i++) {
      const s = a.sections[i];
      if (s.level <= 2) break;
      if (s.level === 3) detail.push(s.title.replace(/[`*]/g, "").trim());
    }
  }
  return { overview, detail };
}

/** `{ phase, path, line }` for every Files Touched bullet in a plan. */
function filesTouched(a) {
  const out = [];
  const detailSec = findSection(a.sections, "Per-Phase Detail");
  if (!detailSec) return out;
  const start = a.sections.indexOf(detailSec);
  for (let i = start + 1; i < a.sections.length; i++) {
    const s = a.sections[i];
    if (s.level <= 2) break;
    if (s.level !== 3) continue;
    const phase = s.title.replace(/[`*]/g, "").trim();
    let inFiles = false;
    s.lines.forEach((line, idx) => {
      if (/^\s*\*\*Files Touched\.?\*\*/i.test(line)) {
        inFiles = true;
        return;
      }
      if (inFiles && /^\s*\*\*[A-Z]/.test(line)) {
        inFiles = false;
        return;
      }
      if (!inFiles) return;
      const m = /^\s*[-*]\s+`?([^`\s][^`]*?)`?\s*$/.exec(line);
      if (!m) return;
      const path = m[1].trim();
      if (path === "" || /\s/.test(path)) return; // prose bullet, not a path
      out.push({ phase, path, line: s.line + idx + 1 });
    });
  }
  return out;
}

/** Does a repo-relative glob cover `path`? Supports `*`, `**`, and bare dirs. */
export function globMatches(glob, path) {
  const g = glob.replace(/^\.\//, "").replace(/\/$/, "");
  const p = path.replace(/^\.\//, "");
  if (g === p) return true;
  if (!g.includes("*")) {
    // A bare directory covers everything under it.
    return p.startsWith(g + "/");
  }
  const re = new RegExp(
    "^" +
      g
        .split(/(\*\*\/|\*\*|\*)/)
        .map((part) => {
          if (part === "**/") return "(?:.*/)?";
          if (part === "**") return ".*";
          if (part === "*") return "[^/]*";
          return part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("") +
      "$",
  );
  return re.test(p);
}

/**
 * Do two globs overlap? Answered by expanding each glob into a probe path and
 * testing it against the other glob's matcher — `services/agents/**` and
 * `services/board.ts` share a directory prefix but cannot match the same file,
 * and a prefix test would wrongly call that an overlap.
 */
export function globsOverlap(a, b) {
  const na = normGlob(a);
  const nb = normGlob(b);
  if (na === nb) return true;
  return globMatches(na, globProbe(nb)) || globMatches(nb, globProbe(na));
}

function normGlob(g) {
  return g.replace(/^\.\//, "").replace(/\/$/, "");
}

/** A concrete path the glob would match, using sentinels no real path carries. */
function globProbe(g) {
  return normGlob(g)
    .split("**")
    .join("\u0001")
    .split("*")
    .join("\u0002")
    .split("\u0001")
    .join("hstackseg/hstackseg")
    .split("\u0002")
    .join("hstacktok");
}

/** Does a module-spec `paths` glob resolve to anything in the repo? */
function pathGlobResolves(repoRoot, glob) {
  const g = glob.replace(/^\.\//, "").replace(/\/$/, "");
  const literal = g.split("*")[0];
  const base = literal.endsWith("/") ? literal.slice(0, -1) : dirname(literal);
  if (!g.includes("*")) return existsSync(resolve(repoRoot, g));
  const dir = resolve(repoRoot, base === "." ? "" : base);
  if (!existsSync(dir)) return false;
  if (!g.includes("/")) return true;
  // Cheap: the concrete prefix directory exists, so the glob has somewhere to match.
  return true;
}

// ---------------------------------------------------------------------------
// 6. Artifact discovery
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".telemetry",
  "__pycache__",
  ".session-state",
]);

/** Subtrees of `hstack/` that are framework files, not artifacts. */
const SKIP_HSTACK_SUBTREES = ["templates", ".claude", "scripts", "lints"];

function walkMarkdown(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".") {
      if (SKIP_DIRS.has(e.name)) continue;
    }
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walkMarkdown(p, out);
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** Read one file into an artifact record, or `null` when it carries no type. */
export function loadArtifact(path, repoRoot) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    return { path, relpath: relative(repoRoot, path), unreadable: String(err) };
  }
  const fm = parseFrontmatter(text);
  if (!fm.found) {
    return {
      path,
      relpath: relative(repoRoot, path),
      noFrontmatter: true,
      parseError: fm.error,
    };
  }
  const body = text.split("\n").slice(fm.endLine).join("\n");
  const sections = parseSections(body, fm.endLine + 1);
  return {
    path,
    relpath: relative(repoRoot, path),
    fm: fm.data,
    rawScalars: fm.rawScalars,
    keyLines: fm.keyLines,
    body,
    sections,
    type: fm.data.type === undefined || fm.data.type === null ? null : String(fm.data.type),
    lineOf(key) {
      return this.keyLines[key] ?? null;
    },
  };
}

export function buildWorld(repoRoot, hstackRoot) {
  const files = walkMarkdown(hstackRoot).filter((p) => {
    const rel = relative(hstackRoot, p).split(sep);
    return !SKIP_HSTACK_SUBTREES.includes(rel[0]);
  });
  const artifacts = [];
  const skipped = [];
  for (const f of files) {
    const a = loadArtifact(f, repoRoot);
    if (a.noFrontmatter || a.unreadable || !a.type) {
      skipped.push(a);
      continue;
    }
    artifacts.push(a);
  }
  const byId = new Map();
  const byType = new Map();
  const byPath = new Map();
  for (const a of artifacts) {
    if (present(a.fm.id) && !byId.has(String(a.fm.id))) byId.set(String(a.fm.id), a);
    if (!byType.has(a.type)) byType.set(a.type, []);
    byType.get(a.type).push(a);
    byPath.set(a.path, a);
  }
  return {
    repoRoot,
    hstackRoot,
    artifacts,
    skipped,
    byId,
    byType,
    byPath,
    designSystemVersion: readDesignSystemVersion(hstackRoot),
  };
}

/** Best-effort read of `design-system.version` from hstack/config.yaml. */
function readDesignSystemVersion(hstackRoot) {
  const cfg = join(hstackRoot, "config.yaml");
  if (!existsSync(cfg)) return null;
  try {
    const text = readFileSync(cfg, "utf8");
    const m = /^\s*design-system-version:\s*(\S+)\s*$/m.exec(text);
    return m ? m[1].replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 7. Runner
// ---------------------------------------------------------------------------

export function validate(world, targets = null) {
  const findings = [];
  const scope = targets ?? world.artifacts;
  for (const a of scope) {
    if (a.noFrontmatter) {
      findings.push({
        rule: "FM-01",
        severity: "error",
        file: a.relpath,
        line: 1,
        message: a.parseError ?? "no YAML frontmatter block",
      });
      continue;
    }
    if (!TYPE_SCHEMAS[a.type]) continue; // unknown type — reported as skipped
    for (const rule of RULES) {
      if (rule.type !== "*" && rule.type !== a.type) continue;
      let raw;
      try {
        raw = rule.check(a, world);
      } catch (err) {
        findings.push({
          rule: rule.id,
          severity: "error",
          file: a.relpath,
          line: null,
          message: `validator error while checking this rule: ${err && err.message ? err.message : err}`,
        });
        continue;
      }
      for (const f of raw ?? []) {
        findings.push({
          rule: rule.id,
          severity: f.severity ?? rule.severity ?? "error",
          file: a.relpath,
          line: f.line ?? null,
          message: f.message,
        });
      }
    }
  }
  findings.sort(
    (p, q) =>
      p.file.localeCompare(q.file) ||
      p.rule.localeCompare(q.rule) ||
      (p.line ?? 0) - (q.line ?? 0),
  );
  return findings;
}

// ---------------------------------------------------------------------------
// 8. CLI
// ---------------------------------------------------------------------------

/**
 * Markers that identify an hstack tree. `CLAUDE.md` is the pre-ADR-0010 kernel
 * filename — a consumer that has not run `hstack update` yet still validates.
 */
const HSTACK_MARKERS = ["KERNEL.md", "CLAUDE.md", "config.yaml"];

const looksLikeHstack = (dir) => HSTACK_MARKERS.some((m) => existsSync(join(dir, m)));

export function findHstackRoot(start) {
  let dir = resolve(start);
  for (;;) {
    if (basename(dir) === "hstack" && looksLikeHstack(dir)) {
      return { repoRoot: dirname(dir), hstackRoot: dir };
    }
    const nested = join(dir, "hstack");
    if (existsSync(nested) && looksLikeHstack(nested)) {
      return { repoRoot: dir, hstackRoot: nested };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function usage() {
  return `hstack validate-spec — mechanical artifact contract check

  node hstack/scripts/validate-spec.mjs [options] [path ...]

  (no path)   validate every artifact under hstack/
  <path>      validate the named file(s); cross-artifact rules still read the
              whole tree, so reciprocity is checked against real disk state

Options
  --json      emit findings as JSON on stdout
  --strict    treat warnings as failures (exit 1)
  --rules     print the rule registry (implemented + deferred) and exit
  --root DIR  repo root to resolve hstack/ from (default: search upward from cwd)
  -h, --help  this text

Exit codes: 0 clean, 1 findings, 2 usage or environment error.`;
}

function printRules() {
  const impl = RULES.map((r) => ({
    id: r.id + (r.variant ? ` (${r.variant})` : ""),
    type: r.type,
    severity: r.severity ?? "error",
    inferred: r.inferred === true,
    description: r.description,
  }));
  console.log(`# hstack validator registry — ${RULES.length} checks, ${DEFERRED_RULES.length} deferred entries\n`);
  console.log("## Mechanized\n");
  for (const r of impl) {
    console.log(
      `- ${r.id}  [${r.type}]${r.severity === "warn" ? "  (warning)" : ""}${r.inferred ? "  (inferred — no repo source states the rule text)" : ""}\n    ${r.description}`,
    );
  }
  console.log("\n## Deferred — named, not mechanized in v1\n");
  for (const r of DEFERRED_RULES) {
    console.log(`- ${r.id}  [${r.type}]\n    ${r.reason}`);
  }
}

function main(argv) {
  const args = argv.slice(2);
  const opts = { json: false, strict: false, rules: false, root: null, paths: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") opts.json = true;
    else if (a === "--strict") opts.strict = true;
    else if (a === "--rules") opts.rules = true;
    else if (a === "--root") opts.root = args[++i];
    else if (a === "-h" || a === "--help") {
      console.log(usage());
      return 0;
    } else if (a.startsWith("-")) {
      console.error(`validate-spec: unknown option ${a}\n\n${usage()}`);
      return 2;
    } else opts.paths.push(a);
  }

  if (opts.rules) {
    printRules();
    return 0;
  }

  const found = findHstackRoot(opts.root ?? (opts.paths[0] ? dirname(resolve(opts.paths[0])) : process.cwd()));
  if (!found) {
    console.error(
      "validate-spec: no hstack/ tree found (looked for hstack/KERNEL.md upward from " +
        (opts.root ?? process.cwd()) +
        "). Pass --root <repo>.",
    );
    return 2;
  }

  const world = buildWorld(found.repoRoot, found.hstackRoot);

  let targets = null;
  const missing = [];
  if (opts.paths.length > 0) {
    targets = [];
    for (const p of opts.paths) {
      const abs = resolve(p);
      const hit = world.byPath.get(abs);
      if (hit) targets.push(hit);
      else if (!existsSync(abs)) missing.push(p);
      else {
        // Outside the scanned tree, or carries no `type:` — load it directly so
        // a Skill can validate the file it just wrote wherever it lives.
        const a = loadArtifact(abs, found.repoRoot);
        if (a.noFrontmatter || !a.type) {
          missing.push(`${p} (no hstack frontmatter)`);
        } else {
          targets.push(a);
          world.artifacts.push(a);
          world.byPath.set(abs, a);
          if (present(a.fm.id) && !world.byId.has(String(a.fm.id))) {
            world.byId.set(String(a.fm.id), a);
          }
        }
      }
    }
  }
  if (missing.length > 0) {
    console.error(`validate-spec: cannot validate ${missing.join(", ")}`);
    return 2;
  }

  const findings = validate(world, targets);
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warn");
  const scanned = targets ?? world.artifacts;
  // Only meaningful for a whole-tree run: when the engineer named paths, the
  // tree-wide skip list is noise about files they did not ask about.
  const unknownTypes = targets
    ? []
    : [...new Set(world.artifacts.filter((a) => !TYPE_SCHEMAS[a.type]).map((a) => a.type))].sort();

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ok: errors.length === 0 && (!opts.strict || warnings.length === 0),
          scanned: scanned.length,
          errors: errors.length,
          warnings: warnings.length,
          unknownTypes,
          findings,
          deferred: DEFERRED_RULES,
        },
        null,
        2,
      ),
    );
  } else {
    for (const f of findings) {
      const where = f.line ? `${f.file}:${f.line}` : f.file;
      const tag = f.severity === "warn" ? "warn " : "error";
      console.log(`${tag}  ${f.rule.padEnd(6)}  ${where}\n         ${f.message}`);
    }
    const byRule = new Map();
    for (const f of findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
    if (findings.length > 0) console.log("");
    console.log(
      `validate-spec: ${scanned.length} artifact(s), ${errors.length} error(s), ${warnings.length} warning(s)` +
        (byRule.size > 0
          ? `\n  by rule: ${[...byRule.entries()]
              .sort((p, q) => q[1] - p[1])
              .map(([r, n]) => `${r}=${n}`)
              .join(" ")}`
          : ""),
    );
    if (unknownTypes.length > 0) {
      console.log(`  skipped ${unknownTypes.length} unknown artifact type(s): ${unknownTypes.join(", ")}`);
    }
  }

  if (errors.length > 0) return 1;
  if (opts.strict && warnings.length > 0) return 1;
  return 0;
}

// Only run the CLI when invoked directly, so `doctor` and the tests can import.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]).endsWith(`${sep}validate-spec.mjs`);
if (invokedDirectly) {
  process.exit(main(process.argv));
}
