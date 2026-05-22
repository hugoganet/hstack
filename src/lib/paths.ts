import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import fs from "fs-extra";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the package's `template/` directory.
 *
 * In production install (`npm install hstack`): dist/cli.js lives at
 * <package>/dist/cli.js, so template/ is at ../template relative to dist/.
 *
 * In local dev (`npx tsx src/cli.ts`): src/lib/paths.ts is at <repo>/src/lib/,
 * so template/ is at ../../template relative to this file.
 */
export function packageTemplateDir(): string {
  // dist/lib/paths.js → ../../template (two levels up)
  const fromDist = resolve(__dirname, "..", "..", "template");
  if (fs.existsSync(fromDist)) return fromDist;

  // dist/cli.js layout fallback: dist/lib/ might not exist; try one up
  const fromDistFlat = resolve(__dirname, "..", "template");
  if (fs.existsSync(fromDistFlat)) return fromDistFlat;

  throw new Error(
    `Cannot locate hstack template/ directory. Looked in:\n  ${fromDist}\n  ${fromDistFlat}\nThis is a packaging bug; please file an issue.`,
  );
}

/** Locate the package's VERSION file. */
export function packageVersionFile(): string {
  const fromDist = resolve(__dirname, "..", "..", "VERSION");
  if (fs.existsSync(fromDist)) return fromDist;
  const fromDistFlat = resolve(__dirname, "..", "VERSION");
  if (fs.existsSync(fromDistFlat)) return fromDistFlat;
  throw new Error("Cannot locate VERSION file");
}
