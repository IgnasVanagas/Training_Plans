import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

function parseArgs(argv) {
  const options = {
    backend: path.join(rootDir, "backend", "coverage.json"),
    frontend: path.join(rootDir, "frontend", "coverage", "coverage-summary.json"),
    threshold: 50,
    frontendLines: 75,
    frontendStatements: 75,
    frontendBranches: 70,
    frontendFunctions: 59,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--backend") {
      options.backend = path.resolve(rootDir, argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--frontend") {
      options.frontend = path.resolve(rootDir, argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--threshold") {
      options.threshold = Number(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--frontend-lines") {
      options.frontendLines = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--frontend-statements") {
      options.frontendStatements = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--frontend-branches") {
      options.frontendBranches = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--frontend-functions") {
      options.frontendFunctions = Number(argv[index + 1]);
      index += 1;
      continue;
    }
  }

  return options;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Coverage artifact not found: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readBackendTotals(report) {
  const totals = report?.totals;
  if (!totals || typeof totals.num_statements !== "number" || typeof totals.covered_lines !== "number") {
    throw new Error("Backend coverage report is missing totals.num_statements or totals.covered_lines");
  }

  return {
    total: totals.num_statements,
    covered: totals.covered_lines,
    percent: totals.percent_statements_covered,
  };
}

function readFrontendTotals(report) {
  const t = report?.total;
  const stmts = t?.statements;
  const lines = t?.lines;
  const branches = t?.branches;
  const functions = t?.functions;
  if (
    !stmts || typeof stmts.total !== "number" || typeof stmts.covered !== "number"
    || !lines || !branches || !functions
  ) {
    throw new Error("Frontend coverage report is missing total.{statements,lines,branches,functions}");
  }

  return {
    total: stmts.total,
    covered: stmts.covered,
    percent: stmts.pct,
    statements: stmts,
    lines,
    branches,
    functions,
  };
}

function formatPercent(value) {
  return value.toFixed(2);
}

function describeSection(label, totals) {
  return `${label}: ${totals.covered}/${totals.total} statements (${formatPercent(totals.percent)}%)`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!Number.isFinite(options.threshold)) {
    throw new Error("Coverage threshold must be a number");
  }

  const backendReport = readJson(options.backend);
  const frontendReport = readJson(options.frontend);

  const backend = readBackendTotals(backendReport);
  const frontend = readFrontendTotals(frontendReport);

  const combinedCovered = backend.covered + frontend.covered;
  const combinedTotal = backend.total + frontend.total;
  const combinedPercent = combinedTotal === 0 ? 100 : (combinedCovered / combinedTotal) * 100;

  console.log(describeSection("Backend", backend));
  console.log(describeSection("Frontend", frontend));
  console.log(`Combined: ${combinedCovered}/${combinedTotal} statements (${formatPercent(combinedPercent)}%)`);
  console.log(`Threshold: ${formatPercent(options.threshold)}%`);

  const frontendChecks = [
    { label: "lines", actual: frontend.lines.pct, required: options.frontendLines },
    { label: "statements", actual: frontend.statements.pct, required: options.frontendStatements },
    { label: "branches", actual: frontend.branches.pct, required: options.frontendBranches },
    { label: "functions", actual: frontend.functions.pct, required: options.frontendFunctions },
  ];
  let frontendFailed = false;
  for (const check of frontendChecks) {
    const ok = check.actual >= check.required;
    console.log(
      `Frontend ${check.label}: ${formatPercent(check.actual)}% (required ${formatPercent(check.required)}%) ${ok ? "OK" : "FAIL"}`,
    );
    if (!ok) frontendFailed = true;
  }

  if (combinedPercent < options.threshold) {
    process.exitCode = 1;
    console.error("Combined coverage is below the required threshold.");
    return;
  }

  if (frontendFailed) {
    process.exitCode = 1;
    console.error("Frontend coverage is below the per-metric threshold floor.");
    return;
  }

  console.log("Combined coverage threshold satisfied.");
}

try {
  main();
} catch (error) {
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
}