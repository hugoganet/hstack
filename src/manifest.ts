/**
 * MANIFEST — the authoritative mapping of framework files shipped to consumers.
 *
 * Every entry is a path inside the npm package's `template/` directory.
 * On `hstack init` it is copied to `<consumer>/hstack/<same-path>`.
 * On `hstack update` only paths in `FRAMEWORK_PATHS` are overwritten; paths
 * in `USER_CONTENT_PATHS` are NEVER touched by the installer.
 *
 * The boundary is load-bearing — see KERNEL.md "Mechanical operations" and
 * the README installation section.
 */

/**
 * Paths the installer owns. `hstack update` overwrites these.
 * Relative to `<consumer>/hstack/`.
 *
 * `KERNEL.md` was `CLAUDE.md` until ADR-0010 — a consumer still carrying the
 * old name is migrated by `hstack update`, not by this diff (the old path is no
 * longer a framework path, so nothing here would ever remove it).
 */
export const FRAMEWORK_PATHS = [
  "KERNEL.md",
  "templates/",
  ".claude/agents/",
  ".claude/skills/",
  "scripts/telemetry/",
  "scripts/coord/",
] as const;

/**
 * Paths the installer NEVER touches once they exist in the consumer.
 * Listed for documentation and `hstack doctor` validation.
 * Relative to `<consumer>/hstack/`.
 */
export const USER_CONTENT_PATHS = [
  "config.yaml",
  "context/",
  "specs/",
  "adr/",
  "tech-debt/",
  "research/",
  "telemetry/reports/",
  "kernel-fit/",
] as const;

/**
 * Consumer-side wiring under `<consumer>/.claude/` — symlinks pointing into
 * the consumer's `hstack/.claude/` tree. Owned by the installer; recreated
 * on every `hstack init` and `hstack update`.
 */
export const CLAUDE_WIRING = {
  /** Dir-level symlink: <consumer>/.claude/agents -> hstack/.claude/agents */
  agentsLink: {
    from: ".claude/agents",
    to: "hstack/.claude/agents",
  },
  /** Per-skill symlinks: <consumer>/.claude/skills/hstack-* -> hstack/.claude/skills/hstack-* */
  skillsGlob: "hstack-*",
  skillsSourceDir: "hstack/.claude/skills",
  skillsTargetDir: ".claude/skills",
  /**
   * Coord-notification hook entries merged into <consumer>/.claude/settings.json
   * (ADR-0007). The installer owns ONLY the two entries whose command targets
   * hstack's committed coord script — everything else in the file is
   * engineer-owned and never touched. Merge-only, idempotent; an unparseable
   * settings.json is a blocker, never an overwrite.
   */
  settingsFile: ".claude/settings.json",
} as const;
