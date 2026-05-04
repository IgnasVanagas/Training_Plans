import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

const thresholds = {
  combinedStatements: 50,
  backendStatements: 60,
  frontendStatements: 75,
  frontendLines: 75,
  frontendBranches: 70,
  frontendFunctions: 59,
};

function parseArgs(argv) {
  const options = {
    frontend: path.join(rootDir, "frontend", "coverage", "coverage-summary.json"),
    frontendHtml: path.join(rootDir, "frontend", "coverage", "index.html"),
    backend: path.join(rootDir, "backend", "coverage.json"),
    backendHtml: path.join(rootDir, "backend", "htmlcov", "class_index.html"),
    output: path.join(rootDir, "docs", "combined-coverage-report.html"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--frontend") {
      options.frontend = path.resolve(rootDir, argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--frontend-html") {
      options.frontendHtml = path.resolve(rootDir, argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--backend") {
      options.backend = path.resolve(rootDir, argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--backend-html") {
      options.backendHtml = path.resolve(rootDir, argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--output") {
      options.output = path.resolve(rootDir, argv[index + 1]);
      index += 1;
    }
  }

  return options;
}

function ensureFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }

  return fs.statSync(filePath);
}

function readJson(filePath) {
  ensureFile(filePath, "Coverage artifact");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "0%";
  }

  return `${value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}%`;
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatRatio(covered, total) {
  return `${formatCount(covered)}/${formatCount(total)}`;
}

function formatTimestamp(timestamp) {
  return new Date(timestamp).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function statusClass(passed) {
  return passed ? "pass" : "fail";
}

function relativeHref(fromFile, toFile) {
  return path.relative(path.dirname(fromFile), toFile).replaceAll("\\", "/");
}

function readBackendTotals(report) {
  const totals = report?.totals;
  if (!totals || typeof totals.num_statements !== "number" || typeof totals.covered_lines !== "number") {
    throw new Error("Backend coverage report is missing totals.num_statements or totals.covered_lines");
  }

  return {
    total: totals.num_statements,
    covered: totals.covered_lines,
    missing: totals.missing_lines,
    percent: totals.percent_statements_covered,
    displayPercent: totals.percent_statements_covered_display,
  };
}

function readFrontendTotals(report) {
  const total = report?.total;
  const statements = total?.statements;
  const lines = total?.lines;
  const branches = total?.branches;
  const functions = total?.functions;

  if (
    !statements || typeof statements.total !== "number" || typeof statements.covered !== "number"
    || !lines || !branches || !functions
  ) {
    throw new Error("Frontend coverage report is missing total.{statements,lines,branches,functions}");
  }

  return {
    statements,
    lines,
    branches,
    functions,
  };
}

function buildBar(percent, passed) {
  return `
    <div class="bar-track" aria-hidden="true">
      <span class="bar-fill ${statusClass(passed)}" style="width: ${clampPercent(percent)}%;"></span>
    </div>
  `;
}

function buildComparisonRow(metric) {
  return `
    <div class="comparison-row">
      <div>
        <strong>${escapeHtml(metric.label)}</strong>
        <span>${escapeHtml(metric.detail)}</span>
      </div>
      <div class="metric-number">${escapeHtml(formatPercent(metric.percent))}</div>
      ${buildBar(metric.percent, metric.passed)}
      <div class="metric-ratio">${escapeHtml(metric.ratio)}</div>
    </div>
  `;
}

function buildMetricRow(metric) {
  const tone = metric.statusTone ?? statusClass(metric.passed);
  const label = metric.statusLabel ?? (metric.passed ? "PASS" : "FAIL");

  return `
    <div class="metric-row">
      <div>
        <strong>${escapeHtml(metric.label)}</strong>
        <span>${escapeHtml(metric.detail)}</span>
      </div>
      <div class="metric-meta">
        <span class="metric-percent">${escapeHtml(formatPercent(metric.percent))}</span>
        <span>${escapeHtml(metric.ratio)}</span>
      </div>
      <span class="status-badge ${escapeHtml(tone)}">${escapeHtml(label)}</span>
    </div>
  `;
}

function buildSourceCard(source) {
  return `
    <article class="source-card">
      <p class="source-label">${escapeHtml(source.label)}</p>
      <h3>${escapeHtml(source.title)}</h3>
      <p>${escapeHtml(source.description)}</p>
      <a href="${escapeHtml(source.href)}">Open source report</a>
      <span class="source-time">Updated ${escapeHtml(source.updatedAt)}</span>
    </article>
  `;
}

function buildHtml(data) {
  const passedChecks = data.checks.filter((check) => check.passed).length;

  const comparisonRows = [
    {
      label: "Combined statements",
      detail: `Weighted across frontend and backend totals. Gate ${formatPercent(thresholds.combinedStatements)}.`,
      percent: data.combined.percent,
      ratio: formatRatio(data.combined.covered, data.combined.total),
      passed: data.combined.percent >= thresholds.combinedStatements,
    },
    {
      label: "Frontend statements",
      detail: `From frontend/coverage/index.html. Gate ${formatPercent(thresholds.frontendStatements)}.`,
      percent: data.frontend.statements.pct,
      ratio: formatRatio(data.frontend.statements.covered, data.frontend.statements.total),
      passed: data.frontend.statements.pct >= thresholds.frontendStatements,
    },
    {
      label: "Backend statements",
      detail: `From backend/htmlcov/class_index.html and backend/coverage.json. Gate ${formatPercent(thresholds.backendStatements)}.`,
      percent: data.backend.percent,
      ratio: formatRatio(data.backend.covered, data.backend.total),
      passed: data.backend.percent >= thresholds.backendStatements,
    },
  ].map(buildComparisonRow).join("");

  const frontendRows = [
    {
      label: "Statements",
      detail: `Threshold ${formatPercent(thresholds.frontendStatements)}`,
      percent: data.frontend.statements.pct,
      ratio: formatRatio(data.frontend.statements.covered, data.frontend.statements.total),
      passed: data.frontend.statements.pct >= thresholds.frontendStatements,
    },
    {
      label: "Lines",
      detail: `Threshold ${formatPercent(thresholds.frontendLines)}`,
      percent: data.frontend.lines.pct,
      ratio: formatRatio(data.frontend.lines.covered, data.frontend.lines.total),
      passed: data.frontend.lines.pct >= thresholds.frontendLines,
    },
    {
      label: "Branches",
      detail: `Threshold ${formatPercent(thresholds.frontendBranches)}`,
      percent: data.frontend.branches.pct,
      ratio: formatRatio(data.frontend.branches.covered, data.frontend.branches.total),
      passed: data.frontend.branches.pct >= thresholds.frontendBranches,
    },
    {
      label: "Functions",
      detail: `Threshold ${formatPercent(thresholds.frontendFunctions)}`,
      percent: data.frontend.functions.pct,
      ratio: formatRatio(data.frontend.functions.covered, data.frontend.functions.total),
      passed: data.frontend.functions.pct >= thresholds.frontendFunctions,
    },
  ].map(buildMetricRow).join("");

  const backendRows = [
    {
      label: "Runtime statements",
      detail: `Threshold ${formatPercent(thresholds.backendStatements)}`,
      percent: data.backend.percent,
      ratio: formatRatio(data.backend.covered, data.backend.total),
      passed: data.backend.percent >= thresholds.backendStatements,
    },
    {
      label: "Missing statements",
      detail: "Remaining backend runtime statements outside current test execution.",
      percent: data.backend.total === 0 ? 0 : (data.backend.missing / data.backend.total) * 100,
      ratio: formatRatio(data.backend.missing, data.backend.total),
      passed: false,
      statusTone: "info",
      statusLabel: "GAP",
    },
  ].map(buildMetricRow).join("");

  const sourceCards = data.sources.map(buildSourceCard).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Training Plans Combined Coverage Report</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f0e7;
      --panel: rgba(255, 252, 246, 0.92);
      --panel-strong: #efe4d0;
      --border: #d8c7ad;
      --text: #1d1a16;
      --muted: #6c6257;
      --pass: #2f7d4a;
      --fail: #b45035;
      --track: #eadfce;
      --shadow: 0 18px 40px rgba(56, 41, 23, 0.1);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(217, 178, 111, 0.18), transparent 26%),
        linear-gradient(180deg, #fbf7ef 0%, var(--bg) 100%);
    }

    a {
      color: #184d7f;
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    .page {
      max-width: 1220px;
      margin: 0 auto;
      padding: 28px 18px 48px;
    }

    .hero,
    .panel,
    .source-card {
      background: var(--panel);
      border: 1px solid var(--border);
      box-shadow: var(--shadow);
    }

    .hero {
      border-radius: 28px;
      padding: 28px;
      background: linear-gradient(135deg, #faf4e8 0%, #f0e4cf 100%);
    }

    .eyebrow {
      margin: 0 0 12px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
    }

    h1 {
      margin: 0;
      font-size: clamp(32px, 4vw, 52px);
      line-height: 0.96;
      letter-spacing: -0.04em;
    }

    .hero p:last-of-type {
      max-width: 760px;
      margin: 14px 0 0;
      color: var(--muted);
      line-height: 1.55;
    }

    .hero-grid,
    .panel-grid,
    .source-grid {
      display: grid;
      gap: 16px;
    }

    .hero-grid {
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      margin-top: 24px;
    }

    .hero-card {
      border-radius: 20px;
      padding: 18px;
      background: rgba(255, 252, 246, 0.72);
      border: 1px solid rgba(112, 88, 53, 0.12);
    }

    .hero-card strong {
      display: block;
      font-size: 31px;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }

    .hero-card span {
      display: block;
      margin-top: 8px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .hero-card small {
      display: block;
      margin-top: 8px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }

    .panel-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin-top: 18px;
    }

    .panel {
      border-radius: 24px;
      padding: 22px;
    }

    .panel.span-2 {
      grid-column: 1 / -1;
    }

    .panel h2 {
      margin: 0;
      font-size: 19px;
    }

    .panel > p {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.5;
    }

    .comparison-list,
    .metric-list {
      display: grid;
      gap: 14px;
      margin-top: 18px;
    }

    .comparison-row,
    .metric-row {
      display: grid;
      gap: 12px;
      align-items: center;
      padding: 14px 16px;
      border-radius: 18px;
      border: 1px solid rgba(112, 88, 53, 0.14);
      background: rgba(255, 255, 255, 0.42);
    }

    .comparison-row {
      grid-template-columns: minmax(180px, 1.3fr) 96px minmax(180px, 1fr) 110px;
    }

    .metric-row {
      grid-template-columns: minmax(0, 1fr) auto auto;
    }

    .comparison-row strong,
    .metric-row strong {
      display: block;
      font-size: 15px;
    }

    .comparison-row span,
    .metric-row span {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
    }

    .metric-number,
    .metric-percent,
    .metric-ratio {
      font-variant-numeric: tabular-nums;
    }

    .metric-number,
    .metric-percent {
      font-size: 18px;
      font-weight: 700;
    }

    .metric-meta {
      text-align: right;
      display: grid;
      gap: 4px;
    }

    .bar-track {
      height: 14px;
      border-radius: 999px;
      overflow: hidden;
      background: var(--track);
      min-width: 0;
    }

    .bar-fill {
      display: block;
      height: 100%;
      border-radius: 999px;
    }

    .bar-fill.pass {
      background: linear-gradient(90deg, #68b57c, var(--pass));
    }

    .bar-fill.fail {
      background: linear-gradient(90deg, #df8b78, var(--fail));
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 70px;
      padding: 8px 11px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border: 1px solid transparent;
    }

    .status-badge.pass {
      background: rgba(47, 125, 74, 0.12);
      color: var(--pass);
      border-color: rgba(47, 125, 74, 0.18);
    }

    .status-badge.fail {
      background: rgba(180, 80, 53, 0.12);
      color: var(--fail);
      border-color: rgba(180, 80, 53, 0.18);
    }

    .status-badge.info {
      background: rgba(108, 98, 87, 0.12);
      color: var(--muted);
      border-color: rgba(108, 98, 87, 0.18);
    }

    .source-grid {
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      margin-top: 18px;
    }

    .source-card {
      border-radius: 20px;
      padding: 18px;
    }

    .source-card h3 {
      margin: 6px 0 8px;
      font-size: 18px;
    }

    .source-card p,
    .source-time {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.5;
    }

    .source-label {
      margin: 0;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .source-card a {
      display: inline-block;
      margin-top: 8px;
      font-weight: 700;
    }

    .source-time {
      display: block;
      margin-top: 12px;
    }

    .footnote {
      margin-top: 18px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }

    @media (max-width: 860px) {
      .panel-grid {
        grid-template-columns: 1fr;
      }

      .panel.span-2 {
        grid-column: auto;
      }

      .comparison-row {
        grid-template-columns: 1fr;
      }

      .metric-row {
        grid-template-columns: 1fr;
      }

      .metric-meta {
        text-align: left;
      }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <p class="eyebrow">Generated coverage snapshot</p>
      <h1>Training Plans Combined Coverage</h1>
      <p>This page merges the current frontend and backend coverage outputs into one weighted statement view, while keeping each report's own metrics visible.</p>
      <div class="hero-grid">
        <article class="hero-card">
          <strong>${escapeHtml(formatPercent(data.combined.percent))}</strong>
          <span>Combined Statements</span>
          <small>${escapeHtml(formatRatio(data.combined.covered, data.combined.total))} across frontend and backend statement totals.</small>
        </article>
        <article class="hero-card">
          <strong>${escapeHtml(formatPercent(data.frontend.statements.pct))}</strong>
          <span>Frontend Statements</span>
          <small>${escapeHtml(formatRatio(data.frontend.statements.covered, data.frontend.statements.total))} from the frontend HTML report.</small>
        </article>
        <article class="hero-card">
          <strong>${escapeHtml(formatPercent(data.backend.percent))}</strong>
          <span>Backend Statements</span>
          <small>${escapeHtml(formatRatio(data.backend.covered, data.backend.total))}. The backend HTML headline rounds this to ${escapeHtml(data.backend.displayPercent)}%.</small>
        </article>
        <article class="hero-card">
          <strong>${passedChecks}/${data.checks.length}</strong>
          <span>Threshold Checks</span>
          <small>Combined, backend, and frontend metric gates are evaluated from the current artifacts.</small>
        </article>
      </div>
    </section>

    <section class="panel-grid">
      <article class="panel span-2">
        <h2>Weighted Coverage Comparison</h2>
        <p>The combined result uses the same statement math as the repository coverage gate: backend covered statements plus frontend covered statements over the combined statement total.</p>
        <div class="comparison-list">${comparisonRows}</div>
      </article>

      <article class="panel">
        <h2>Frontend Coverage Detail</h2>
        <p>Visible metrics taken from the frontend coverage output, with the same thresholds enforced in the repo.</p>
        <div class="metric-list">${frontendRows}</div>
      </article>

      <article class="panel">
        <h2>Backend Coverage Detail</h2>
        <p>The backend HTML class index shows the rounded headline, while the exact statement counts come from the paired backend coverage JSON.</p>
        <div class="metric-list">${backendRows}</div>
      </article>

      <article class="panel span-2">
        <h2>Source Reports</h2>
        <p>These are the underlying reports this page summarizes.</p>
        <div class="source-grid">${sourceCards}</div>
        <p class="footnote">Generated ${escapeHtml(data.generatedAt)}. Frontend HTML and backend HTML are linked directly so you can drill into uncovered areas after using this summary.</p>
      </article>
    </section>
  </main>
</body>
</html>`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  const frontendHtmlStat = ensureFile(options.frontendHtml, "Frontend HTML report");
  const backendHtmlStat = ensureFile(options.backendHtml, "Backend HTML report");

  const frontend = readFrontendTotals(readJson(options.frontend));
  const backend = readBackendTotals(readJson(options.backend));

  const combinedCovered = frontend.statements.covered + backend.covered;
  const combinedTotal = frontend.statements.total + backend.total;
  const combinedPercent = combinedTotal === 0 ? 100 : (combinedCovered / combinedTotal) * 100;

  const checks = [
    { label: "Combined statements", passed: combinedPercent >= thresholds.combinedStatements },
    { label: "Backend runtime statements", passed: backend.percent >= thresholds.backendStatements },
    { label: "Frontend statements", passed: frontend.statements.pct >= thresholds.frontendStatements },
    { label: "Frontend lines", passed: frontend.lines.pct >= thresholds.frontendLines },
    { label: "Frontend branches", passed: frontend.branches.pct >= thresholds.frontendBranches },
    { label: "Frontend functions", passed: frontend.functions.pct >= thresholds.frontendFunctions },
  ];

  const html = buildHtml({
    frontend,
    backend,
    combined: {
      covered: combinedCovered,
      total: combinedTotal,
      percent: combinedPercent,
    },
    checks,
    generatedAt: formatTimestamp(new Date()),
    sources: [
      {
        label: "Frontend source",
        title: "frontend/coverage/index.html",
        description: "Frontend statement, branch, function, and line totals for the full src surface.",
        href: relativeHref(options.output, options.frontendHtml),
        updatedAt: formatTimestamp(frontendHtmlStat.mtime),
      },
      {
        label: "Backend source",
        title: "backend/htmlcov/class_index.html",
        description: "Backend coverage.py class index headline, paired with backend coverage.json for exact statement totals.",
        href: relativeHref(options.output, options.backendHtml),
        updatedAt: formatTimestamp(backendHtmlStat.mtime),
      },
    ],
  });

  ensureDir(path.dirname(options.output));
  fs.writeFileSync(options.output, html, "utf8");

  console.log(`Wrote combined coverage report to ${options.output}`);
  console.log(`Combined statements: ${formatRatio(combinedCovered, combinedTotal)} (${formatPercent(combinedPercent)})`);
}

try {
  main();
} catch (error) {
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
}