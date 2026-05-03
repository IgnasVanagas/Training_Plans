import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

function parseArgs(argv) {
  const options = {
    backend: path.join(rootDir, "backend", "coverage.json"),
    frontend: path.join(rootDir, "frontend", "coverage", "coverage-summary.json"),
    threshold: 50,
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
  const totals = report?.total?.statements;
  if (!totals || typeof totals.total !== "number" || typeof totals.covered !== "number") {
    throw new Error("Frontend coverage report is missing total.statements totals");
  }

  return {
    total: totals.total,
    covered: totals.covered,
    percent: totals.pct,
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

  if (combinedPercent < options.threshold) {
    process.exitCode = 1;
    console.error("Combined coverage is below the required threshold.");
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