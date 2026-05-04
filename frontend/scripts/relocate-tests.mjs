// One-shot script: move all *.test.{ts,tsx} from src/** into tests/** mirroring layout,
// rewrite their relative imports so they still resolve to src.
// Also moves src/test/setup.ts -> tests/setup.ts.
// Idempotent-ish: skips files that no longer exist.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, "..");
const srcDir = path.join(frontendDir, "src");
const testsDir = path.join(frontendDir, "tests");

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

const isTestFile = (p) => /\.test\.(ts|tsx)$/.test(p);

function rewriteImports(code, originalFile, newFile) {
  const originalDir = path.dirname(originalFile);
  const newDir = path.dirname(newFile);
  const replaceSpec = (spec) => {
    if (!spec.startsWith(".")) return spec;
    // resolve against original location (without extension handling)
    const absoluteTarget = path.resolve(originalDir, spec);
    // assume target lives inside src (not inside tests)
    let rel = path.relative(newDir, absoluteTarget).replace(/\\/g, "/");
    if (!rel.startsWith(".")) rel = "./" + rel;
    return rel;
  };
  // Match import ... from "...", import("..."), require("..."), vi.mock("..."), vi.doMock("...")
  const patterns = [
    // import / export from "x"
    /(\bfrom\s*["'])([^"']+)(["'])/g,
    // import("x") dynamic
    /(\bimport\s*\(\s*["'])([^"']+)(["']\s*\))/g,
    // require("x")
    /(\brequire\s*\(\s*["'])([^"']+)(["']\s*\))/g,
    // vi.mock("x"), vi.doMock("x"), vi.unmock("x")
    /(\bvi\.(?:mock|doMock|unmock)\s*\(\s*["'])([^"']+)(["'])/g,
  ];
  let out = code;
  for (const re of patterns) {
    out = out.replace(re, (_m, a, spec, b) => `${a}${replaceSpec(spec)}${b}`);
  }
  return out;
}

async function moveFile(originalFile) {
  const rel = path.relative(srcDir, originalFile);
  const newFile = path.join(testsDir, rel);
  await fs.mkdir(path.dirname(newFile), { recursive: true });
  const code = await fs.readFile(originalFile, "utf8");
  const rewritten = rewriteImports(code, originalFile, newFile);
  await fs.writeFile(newFile, rewritten, "utf8");
  await fs.unlink(originalFile);
  return { from: originalFile, to: newFile };
}

async function main() {
  // 1) Move every test file under src
  const all = await walk(srcDir);
  const tests = all.filter(isTestFile);
  const moved = [];
  for (const f of tests) {
    moved.push(await moveFile(f));
  }
  // 2) Move src/test/setup.ts -> tests/setup.ts (special case)
  const oldSetup = path.join(srcDir, "test", "setup.ts");
  const newSetup = path.join(testsDir, "setup.ts");
  try {
    const code = await fs.readFile(oldSetup, "utf8");
    await fs.mkdir(testsDir, { recursive: true });
    await fs.writeFile(newSetup, code, "utf8");
    await fs.unlink(oldSetup);
    // try to remove now-empty src/test dir
    try {
      await fs.rmdir(path.join(srcDir, "test"));
    } catch {}
    moved.push({ from: oldSetup, to: newSetup });
  } catch {}
  // 3) Remove now-empty src/__tests__ dir if empty
  try {
    const remaining = await fs.readdir(path.join(srcDir, "__tests__"));
    if (remaining.length === 0) await fs.rmdir(path.join(srcDir, "__tests__"));
  } catch {}
  console.log(JSON.stringify({ movedCount: moved.length, moved }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
