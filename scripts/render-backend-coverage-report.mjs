import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

function parseArgs(argv) {
  const options = {
    backend: path.join(rootDir, "backend", "coverage.json"),
    output: path.join(rootDir, "backend", "coverage"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--backend") {
      options.backend = path.resolve(rootDir, argv[index + 1]);
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

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Coverage artifact not found: ${filePath}`);
  }

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

function formatTimestamp(date) {
  return date.toISOString().replace("T", " ").replace(/:\d{2}\.\d{3}Z$/, "Z");
}

function coverageClass(percent, total) {
  if (!total) {
    return "empty";
  }

  if (percent >= 80) {
    return "high";
  }

  if (percent >= 60) {
    return "medium";
  }

  return "low";
}

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/");
}

function fileSlug(filePath) {
  return normalizePath(filePath)
    .replaceAll("/", "__")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.+/g, "_") + ".html";
}

function joinSourcePath(backendDir, fileKey) {
  return path.join(backendDir, ...normalizePath(fileKey).split("/"));
}

function splitSourceLines(fileText) {
  if (!fileText) {
    return [];
  }

  return fileText.split(/\r?\n/);
}

function isSourceCodeLine(line) {
  const trimmed = line.trim();
  return trimmed.length > 0 && !trimmed.startsWith("#");
}

function computeSourceLineCoverage(lines, executed, missing, excluded) {
  let total = 0;
  let covered = 0;
  let missingCount = 0;
  let excludedCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];

    if (!isSourceCodeLine(line)) {
      continue;
    }

    total += 1;

    if (executed.has(lineNumber)) {
      covered += 1;
      continue;
    }

    if (missing.has(lineNumber)) {
      missingCount += 1;
      continue;
    }

    if (excluded.has(lineNumber)) {
      excludedCount += 1;
    }
  }

  return {
    total,
    covered,
    missing: missingCount,
    excluded: excludedCount,
    percent: total === 0 ? 100 : (covered / total) * 100,
  };
}

function buildStylesheet() {
  return `:root {
  color-scheme: light;
  --bg: #f4f1ea;
  --panel: #fffdf8;
  --panel-strong: #f6efe3;
  --border: #dfd3bf;
  --text: #1d1a17;
  --muted: #6a6258;
  --high: #2f7d4a;
  --medium: #b47616;
  --low: #b33b2e;
  --empty: #8d857a;
  --row-hit: #eef8f0;
  --row-miss: #fff0ed;
  --row-neutral: #fbf8f3;
  --row-excluded: #f2eee8;
  --shadow: 0 16px 38px rgba(52, 39, 23, 0.08);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  color: var(--text);
  background:
    radial-gradient(circle at top left, rgba(207, 170, 120, 0.18), transparent 28%),
    linear-gradient(180deg, #f9f4eb 0%, var(--bg) 100%);
}

a {
  color: inherit;
}

.page {
  max-width: 1320px;
  margin: 0 auto;
  padding: 32px 20px 48px;
}

.hero {
  background: linear-gradient(135deg, #faf4e8 0%, #f2e6d1 100%);
  border: 1px solid var(--border);
  border-radius: 24px;
  padding: 28px;
  box-shadow: var(--shadow);
}

.eyebrow {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}

.hero h1 {
  margin: 0;
  font-size: clamp(30px, 4vw, 46px);
  line-height: 1;
}

.hero p {
  margin: 14px 0 0;
  max-width: 760px;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.55;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  margin-top: 24px;
}

.stat {
  background: rgba(255, 253, 248, 0.84);
  border: 1px solid rgba(120, 96, 62, 0.14);
  border-radius: 18px;
  padding: 16px 18px;
}

.stat strong {
  display: block;
  font-size: 28px;
  line-height: 1;
}

.stat span {
  display: block;
}

.stat .label {
  margin-top: 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.stat .detail {
  margin-top: 6px;
  font-size: 13px;
  color: var(--muted);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin: 22px 0 14px;
}

.toolbar input[type="search"] {
  min-width: min(100%, 320px);
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: rgba(255, 253, 248, 0.92);
  font: inherit;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: rgba(255, 253, 248, 0.92);
  color: var(--muted);
  font-size: 14px;
}

.summary-card,
.source-card {
  margin-top: 18px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 22px;
  box-shadow: var(--shadow);
  overflow: hidden;
}

.summary-card {
  padding: 18px;
}

.coverage-summary {
  width: 100%;
  border-collapse: collapse;
}

.coverage-summary th,
.coverage-summary td {
  padding: 14px 12px;
  border-bottom: 1px solid rgba(120, 96, 62, 0.14);
  text-align: left;
  vertical-align: middle;
}

.coverage-summary thead th {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  user-select: none;
}

.coverage-summary thead th.no-sort {
  cursor: default;
}

.coverage-summary tbody tr:last-child td {
  border-bottom: 0;
}

.coverage-summary tbody tr:hover {
  background: rgba(246, 239, 227, 0.42);
}

.file-link {
  display: inline-block;
  font-family: "Consolas", "Courier New", monospace;
  font-size: 13px;
  text-decoration: none;
}

.file-link:hover {
  text-decoration: underline;
}

.chart {
  width: 140px;
  height: 10px;
  border-radius: 999px;
  background: #eadfcf;
  overflow: hidden;
}

.cover-fill {
  height: 100%;
}

.high .cover-fill {
  background: linear-gradient(90deg, #4ea665, var(--high));
}

.medium .cover-fill {
  background: linear-gradient(90deg, #e4aa49, var(--medium));
}

.low .cover-fill {
  background: linear-gradient(90deg, #db786d, var(--low));
}

.empty .cover-fill {
  background: linear-gradient(90deg, #beb7ae, var(--empty));
}

.pct {
  font-weight: 700;
}

.high .pct,
.high .value-accent {
  color: var(--high);
}

.medium .pct,
.medium .value-accent {
  color: var(--medium);
}

.low .pct,
.low .value-accent {
  color: var(--low);
}

.empty .pct,
.empty .value-accent {
  color: var(--empty);
}

.breadcrumbs {
  margin-top: 18px;
  color: var(--muted);
  font-size: 14px;
}

.breadcrumbs a {
  text-decoration: none;
}

.breadcrumbs a:hover {
  text-decoration: underline;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
  color: var(--muted);
  font-size: 13px;
}

.legend span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 999px;
}

.dot-hit {
  background: #61a873;
}

.dot-miss {
  background: #d05a4d;
}

.dot-neutral {
  background: #cac1b5;
}

.source-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  padding: 18px 20px 10px;
}

.source-header h2 {
  margin: 0;
  font-size: 18px;
}

.source-header p {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 14px;
}

.source-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.source-table td {
  padding: 0;
  vertical-align: top;
}

.line-number,
.line-state {
  width: 72px;
  padding: 0 10px;
  border-right: 1px solid rgba(120, 96, 62, 0.12);
  text-align: right;
  color: var(--muted);
  font-family: "Consolas", "Courier New", monospace;
  font-size: 12px;
  line-height: 1.6;
}

.line-state {
  width: 84px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 10px;
}

.line-code {
  overflow-x: auto;
}

.line-code code {
  display: block;
  padding: 0 16px;
  white-space: pre;
  font-family: "Consolas", "Courier New", monospace;
  font-size: 13px;
  line-height: 1.6;
}

tr.hit {
  background: var(--row-hit);
}

tr.miss {
  background: var(--row-miss);
}

tr.neutral {
  background: var(--row-neutral);
}

tr.excluded {
  background: var(--row-excluded);
}

.footer-note {
  margin-top: 16px;
  color: var(--muted);
  font-size: 13px;
}

@media (max-width: 900px) {
  .coverage-summary th:nth-child(2),
  .coverage-summary td:nth-child(2) {
    display: none;
  }

  .line-number,
  .line-state {
    width: 56px;
  }
}
`;
}

function buildIndexScript() {
  return `(() => {
  const table = document.querySelector("[data-report-table]");
  if (!table) return;

  const tbody = table.querySelector("tbody");
  const rows = Array.from(tbody.querySelectorAll("tr[data-row]"));
  const filterInput = document.getElementById("filter");
  const hideCovered = document.getElementById("hideCovered");
  const headers = Array.from(table.querySelectorAll("th[data-sort-key]"));
  let sortKey = "file";
  let sortDirection = "asc";

  function compareValues(a, b, type) {
    if (type === "number") {
      return Number(a) - Number(b);
    }

    return String(a).localeCompare(String(b));
  }

  function updateSortIndicators() {
    headers.forEach((header) => {
      const active = header.dataset.sortKey === sortKey;
      header.setAttribute("aria-sort", active ? (sortDirection === "asc" ? "ascending" : "descending") : "none");
      header.dataset.active = active ? "true" : "false";
    });
  }

  function sortRows() {
    const header = headers.find((item) => item.dataset.sortKey === sortKey);
    const type = header?.dataset.sortType || "text";
    const sorted = [...rows].sort((left, right) => {
      const comparison = compareValues(left.dataset[sortKey] || "", right.dataset[sortKey] || "", type);
      return sortDirection === "asc" ? comparison : -comparison;
    });

    sorted.forEach((row) => tbody.appendChild(row));
    updateSortIndicators();
  }

  function filterRows() {
    const query = (filterInput?.value || "").trim().toLowerCase();
    const hideFull = Boolean(hideCovered?.checked);

    rows.forEach((row) => {
      const matchesQuery = !query || (row.dataset.filterText || "").includes(query);
      const matchesCoverage = !hideFull || Number(row.dataset.percent || "0") < 100;
      row.hidden = !(matchesQuery && matchesCoverage);
    });
  }

  headers.forEach((header) => {
    header.addEventListener("click", () => {
      const nextKey = header.dataset.sortKey;
      if (!nextKey) return;
      if (sortKey === nextKey) {
        sortDirection = sortDirection === "asc" ? "desc" : "asc";
      } else {
        sortKey = nextKey;
        sortDirection = header.dataset.defaultDirection || (header.dataset.sortType === "number" ? "desc" : "asc");
      }
      sortRows();
      filterRows();
    });
  });

  filterInput?.addEventListener("input", filterRows);
  hideCovered?.addEventListener("change", filterRows);

  sortRows();
  filterRows();
})();`;
}

function buildDocument({ title, body, script = "", styleHref = "report.css" }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${escapeHtml(styleHref)}">
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ""}
</body>
</html>`;
}

function renderIndex(report, outputDir, backendDir) {
  const files = Object.entries(report.files || {}).map(([fileKey, fileData]) => {
    const summary = fileData.summary || {};
    const totalStatements = summary.num_statements || 0;
    const coveredStatements = summary.covered_lines || 0;
    const missingStatements = summary.missing_lines || 0;
    const excludedStatements = summary.excluded_lines || 0;
    const percent = Number(summary.percent_statements_covered ?? summary.percent_covered ?? 0);
    const normalizedFile = normalizePath(fileKey);
    const sourcePath = joinSourcePath(backendDir, fileKey);
    const fileText = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : "";
    const sourceLines = splitSourceLines(fileText);
    const executed = new Set(fileData.executed_lines || []);
    const missing = new Set(fileData.missing_lines || []);
    const excluded = new Set(fileData.excluded_lines || []);
    const sourceCoverage = computeSourceLineCoverage(sourceLines, executed, missing, excluded);

    return {
      fileKey,
      normalizedFile,
      fileHref: `files/${fileSlug(fileKey)}`,
      totalStatements,
      coveredStatements,
      missingStatements,
      excludedStatements,
      percent,
      totalCodeLines: sourceCoverage.total,
      coveredCodeLines: sourceCoverage.covered,
      missingCodeLines: sourceCoverage.missing,
      excludedCodeLines: sourceCoverage.excluded,
      linePercent: sourceCoverage.percent,
      coverageState: coverageClass(percent, totalStatements),
      sourcePath,
    };
  });

  files.sort((left, right) => left.normalizedFile.localeCompare(right.normalizedFile));

  const totals = report.totals || {};
  const totalStatements = Number(totals.num_statements || 0);
  const coveredStatements = Number(totals.covered_lines || 0);
  const missingStatements = Number(totals.missing_lines || 0);
  const excludedStatements = Number(totals.excluded_lines || 0);
  const totalPercent = Number(totals.percent_statements_covered || 0);
  const totalCodeLines = files.reduce((sum, file) => sum + file.totalCodeLines, 0);
  const coveredCodeLines = files.reduce((sum, file) => sum + file.coveredCodeLines, 0);
  const excludedCodeLines = files.reduce((sum, file) => sum + file.excludedCodeLines, 0);
  const linePercent = totalCodeLines === 0 ? 100 : (coveredCodeLines / totalCodeLines) * 100;
  const highCoverageFiles = files.filter((file) => file.percent >= 80).length;
  const fullCoverageFiles = files.filter((file) => file.percent === 100).length;

  const rows = files.map((file) => {
    const width = file.totalStatements ? Math.max(0, Math.min(100, file.percent)) : 100;
    return `
      <tr
        data-row
        class="${file.coverageState}"
        data-file="${escapeHtml(file.normalizedFile.toLowerCase())}"
        data-statementPercent="${file.percent}"
        data-statementCount="${file.totalStatements}"
        data-linePercent="${file.linePercent}"
        data-lineCount="${file.totalCodeLines}"
        data-missing="${file.missingStatements}"
        data-excluded="${file.excludedStatements}"
        data-filter-text="${escapeHtml(file.normalizedFile.toLowerCase())}"
      >
        <td><a class="file-link" href="${escapeHtml(file.fileHref)}">${escapeHtml(file.normalizedFile)}</a></td>
        <td>
          <div class="chart ${file.coverageState}">
            <div class="cover-fill" style="width: ${width}%;"></div>
          </div>
        </td>
        <td class="pct">${formatPercent(file.percent)}</td>
        <td>${file.coveredStatements}/${file.totalStatements}</td>
        <td class="pct">${formatPercent(file.linePercent)}</td>
        <td>${file.coveredCodeLines}/${file.totalCodeLines}</td>
        <td>${file.missingStatements}</td>
        <td>${file.excludedStatements}</td>
      </tr>`;
  }).join("");

  const body = `
  <div class="page">
    <section class="hero ${coverageClass(totalPercent, totalStatements)}">
      <p class="eyebrow">Backend Coverage</p>
      <h1>Python coverage in a frontend-style table</h1>
      <p>This report is generated from <code>backend/coverage.json</code> so the backend summary reads more like the frontend coverage view while still using the same measured backend totals.</p>
      <div class="stats">
        <div class="stat">
          <strong class="value-accent">${formatPercent(totalPercent)}</strong>
          <span class="label">Statements</span>
          <span class="detail">${coveredStatements}/${totalStatements} covered</span>
        </div>
        <div class="stat">
          <strong class="value-accent">${formatPercent(linePercent)}</strong>
          <span class="label">Code Lines</span>
          <span class="detail">${coveredCodeLines}/${totalCodeLines} covered</span>
        </div>
        <div class="stat">
          <strong>${files.length}</strong>
          <span class="label">Files</span>
          <span class="detail">${highCoverageFiles} at 80% or higher</span>
        </div>
        <div class="stat">
          <strong>${missingStatements}</strong>
          <span class="label">Missing</span>
          <span class="detail">${excludedStatements} excluded statements, ${excludedCodeLines} excluded code lines</span>
        </div>
      </div>
    </section>

    <div class="toolbar">
      <input id="filter" type="search" placeholder="Filter files...">
      <label class="toggle" for="hideCovered">
        <input id="hideCovered" type="checkbox">
        Hide 100% files
      </label>
    </div>

    <section class="summary-card">
      <table class="coverage-summary" data-report-table>
        <thead>
          <tr>
            <th data-sort-key="file" data-sort-type="text" data-default-direction="asc">File</th>
            <th class="no-sort">Coverage</th>
            <th data-sort-key="statementPercent" data-sort-type="number" data-default-direction="desc">Statements</th>
            <th data-sort-key="statementCount" data-sort-type="number" data-default-direction="desc">Covered / Total</th>
            <th data-sort-key="linePercent" data-sort-type="number" data-default-direction="desc">Lines</th>
            <th data-sort-key="lineCount" data-sort-type="number" data-default-direction="desc">Covered / Total</th>
            <th data-sort-key="missing" data-sort-type="number" data-default-direction="desc">Missing</th>
            <th data-sort-key="excluded" data-sort-type="number" data-default-direction="desc">Excluded</th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
      <p class="footer-note">Code-line totals are computed from non-empty, non-comment Python source lines. The existing <code>backend/htmlcov</code> report is still generated, and this view remains additive to the backend coverage gate.</p>
    </section>
  </div>`;

  fs.writeFileSync(
    path.join(outputDir, "index.html"),
    buildDocument({
      title: "Backend Coverage",
      body,
      script: buildIndexScript(),
    }),
    "utf8"
  );
}

function renderSourcePages(report, outputDir, backendDir) {
  const filesDir = path.join(outputDir, "files");
  ensureDir(filesDir);

  for (const [fileKey, fileData] of Object.entries(report.files || {})) {
    const normalizedFile = normalizePath(fileKey);
    const sourcePath = joinSourcePath(backendDir, fileKey);
    const summary = fileData.summary || {};
    const percent = Number(summary.percent_statements_covered ?? summary.percent_covered ?? 0);
    const totalStatements = Number(summary.num_statements || 0);
    const coveredStatements = Number(summary.covered_lines || 0);
    const missingStatements = Number(summary.missing_lines || 0);
    const excludedStatements = Number(summary.excluded_lines || 0);
    const status = coverageClass(percent, totalStatements);

    const executed = new Set(fileData.executed_lines || []);
    const missing = new Set(fileData.missing_lines || []);
    const excluded = new Set(fileData.excluded_lines || []);
    const fileText = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : "";
    const lines = splitSourceLines(fileText);
    const sourceCoverage = computeSourceLineCoverage(lines, executed, missing, excluded);

    const lineRows = lines.map((line, index) => {
      const lineNumber = index + 1;
      let rowClass = "neutral";
      let label = "-";

      if (missing.has(lineNumber)) {
        rowClass = "miss";
        label = "miss";
      } else if (executed.has(lineNumber)) {
        rowClass = "hit";
        label = "hit";
      } else if (excluded.has(lineNumber)) {
        rowClass = "excluded";
        label = "skip";
      }

      const code = line.length > 0 ? escapeHtml(line) : " ";
      return `
        <tr class="${rowClass}">
          <td class="line-number">${lineNumber}</td>
          <td class="line-state">${label}</td>
          <td class="line-code"><code>${code}</code></td>
        </tr>`;
    }).join("");

    const body = `
    <div class="page">
      <section class="hero ${status}">
        <p class="eyebrow">Backend Coverage Detail</p>
        <h1>${escapeHtml(normalizedFile)}</h1>
        <p>This page uses the same backend coverage data as the CLI threshold checks, but renders the source detail with a table-oriented layout similar to the frontend coverage report.</p>
        <div class="stats">
          <div class="stat">
            <strong class="value-accent">${formatPercent(percent)}</strong>
            <span class="label">Statements</span>
            <span class="detail">${coveredStatements}/${totalStatements} covered</span>
          </div>
          <div class="stat">
            <strong class="value-accent">${formatPercent(sourceCoverage.percent)}</strong>
            <span class="label">Code Lines</span>
            <span class="detail">${sourceCoverage.covered}/${sourceCoverage.total} covered</span>
          </div>
          <div class="stat">
            <strong>${missingStatements}</strong>
            <span class="label">Missing</span>
            <span class="detail">${excludedStatements} excluded statements</span>
          </div>
          <div class="stat">
            <strong>${sourceCoverage.total}</strong>
            <span class="label">Actual LOC</span>
            <span class="detail">Non-empty, non-comment source lines</span>
          </div>
        </div>
      </section>

      <div class="breadcrumbs">
        <a href="../index.html">Back to backend coverage table</a>
      </div>

      <div class="legend">
        <span><i class="dot dot-hit"></i>Covered statement</span>
        <span><i class="dot dot-miss"></i>Missing statement</span>
        <span><i class="dot dot-neutral"></i>Non-statement line</span>
      </div>

      <section class="source-card">
        <div class="source-header">
          <div>
            <h2>Source</h2>
            <p>${escapeHtml(normalizedFile)}</p>
          </div>
        </div>
        <table class="source-table">
          <tbody>
${lineRows}
          </tbody>
        </table>
      </section>
    </div>`;

    fs.writeFileSync(
      path.join(filesDir, fileSlug(fileKey)),
      buildDocument({
        title: `${normalizedFile} coverage`,
        body,
        styleHref: "../report.css",
      }),
      "utf8"
    );
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = readJson(options.backend);
  const backendDir = path.dirname(options.backend);

  fs.rmSync(options.output, { recursive: true, force: true });
  ensureDir(options.output);

  fs.writeFileSync(path.join(options.output, "report.css"), buildStylesheet(), "utf8");
  renderIndex(report, options.output, backendDir);
  renderSourcePages(report, options.output, backendDir);

  console.log(`Backend coverage HTML written to ${path.join(options.output, "index.html")}`);
}

try {
  main();
} catch (error) {
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
}