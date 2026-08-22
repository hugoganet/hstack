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
] as const;

/**
 * Paths the installer shipped before v0.17 and now takes back.
 *
 * v0.17 removed the enforcement scripts (`validate-spec.mjs`,
 * `compute-merge-readiness.mjs`, `run-gates.sh`) and the `coord/` and
 * `telemetry/` module trees along with the machinery that called them. Dropping
 * them from `FRAMEWORK_PATHS` is not enough on its own: the update diff only
 * looks at paths in that list, so a path removed from it is a path nothing will
 * ever prune — the consumer would keep running a copy of a script this
 * framework no longer knows about. `hstack update` therefore removes these
 * explicitly, the same way the ADR-0010 rename is a migration rather than a
 * diff. Planned only when the path is actually on disk, so it is a no-op by
 * construction on a consumer installed after v0.17.
 *
 * Relative to `<consumer>/hstack/`. Order matters only for readability.
 */
export const LEGACY_FRAMEWORK_PATHS = [
  "scripts/validate-spec.mjs",
  "scripts/compute-merge-readiness.mjs",
  "scripts/run-gates.sh",
  "scripts/coord",
  "scripts/telemetry",
] as const;

/**
 * The directory the legacy paths above lived in. Removed after them, and only
 * when empty: an engineer who put their own script there keeps it.
 */
export const LEGACY_SCRIPTS_DIR = "scripts";

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
   * <consumer>/.claude/settings.json. Until v0.17 the installer merged the
   * ADR-0007 coord-notification hooks into it; now it only takes them back out.
   * The installer owns ONLY the entries whose command targets hstack's coord
   * script — everything else in the file is engineer-owned and never touched.
   * Idempotent; an unparseable settings.json is surfaced, never overwritten.
   */
  settingsFile: ".claude/settings.json",
} as const;
