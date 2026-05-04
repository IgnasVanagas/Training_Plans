import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

function parseArgs(argv) {
  const options = {
    input: path.join(rootDir, "temp", "loc-report.json"),
    output: path.join(rootDir, "docs", "ui_sketches", "code-lines-visual-lt-compact.html"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--input") {
      options.input = path.resolve(rootDir, argv[index + 1]);
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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`LOC artifact not found: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCount(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "0.0%";
  }

  return `${value.toFixed(1)}%`;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function requireBucket(locReport, bucketName) {
  const bucket = locReport?.buckets?.[bucketName];
  if (!bucket) {
    throw new Error(`Missing bucket in LOC artifact: ${bucketName}`);
  }
  return bucket;
}

function buildMetrics(locReport) {
  const frontendRuntime = requireBucket(locReport, "frontend_runtime");
  const backendRuntime = requireBucket(locReport, "backend_runtime");
  const frontendTests = requireBucket(locReport, "frontend_tests");
  const backendTests = requireBucket(locReport, "backend_tests");
  const nonRuntime = requireBucket(locReport, "non_runtime");
  const grand = locReport?.grand;

  if (!grand || !Number.isFinite(grand.code)) {
    throw new Error("Missing grand totals in LOC artifact");
  }

  const runtimeCode = frontendRuntime.code + backendRuntime.code;
  const testCode = frontendTests.code + backendTests.code;
  const totalCode = grand.code;

  return {
    totalCode,
    totalFiles: grand.files,
    stats: [
      {
        label: "Vykdomas kodas",
        value: runtimeCode,
        note: `${formatPercent((runtimeCode / totalCode) * 100)} viso kiekio`,
        highlight: true,
      },
      {
        label: "Testai",
        value: testCode,
        note: `${formatPercent((testCode / totalCode) * 100)} viso kiekio`,
        highlight: false,
      },
      {
        label: "Nevykdomas kodas",
        value: nonRuntime.code,
        note: `${formatPercent((nonRuntime.code / totalCode) * 100)} viso kiekio`,
        highlight: false,
      },
    ],
    bars: [
      {
        label: "Frontend vykdomas kodas",
        value: frontendRuntime.code,
        width: clampPercent((frontendRuntime.code / totalCode) * 100),
        highlight: true,
      },
      {
        label: "Backend vykdomas kodas",
        value: backendRuntime.code,
        width: clampPercent((backendRuntime.code / totalCode) * 100),
        highlight: false,
      },
      {
        label: "Nevykdomas kodas",
        value: nonRuntime.code,
        width: clampPercent((nonRuntime.code / totalCode) * 100),
        highlight: false,
      },
      {
        label: "Backend testai",
        value: backendTests.code,
        width: clampPercent((backendTests.code / totalCode) * 100),
        highlight: false,
      },
      {
        label: "Frontend testai",
        value: frontendTests.code,
        width: clampPercent((frontendTests.code / totalCode) * 100),
        highlight: true,
      },
    ],
  };
}

function buildStylesheet() {
  return `:root {
      --black: #000000;
      --yellow: #FFFF00;
      --white: #FFFFFF;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--black);
      color: var(--white);
      font-family: Arial, Helvetica, sans-serif;
      display: grid;
      place-items: center;
      padding: 24px;
    }

    .slide {
      width: min(1180px, 100%);
      min-height: 640px;
      padding: 36px;
      border: 2px solid var(--white);
      display: grid;
      gap: 28px;
      background:
        linear-gradient(180deg, transparent 0 86%, rgba(255, 255, 255, 0.08) 86% 87%, transparent 87% 100%),
        var(--black);
    }

    .top {
      display: grid;
      grid-template-columns: 1.1fr 0.9fr;
      gap: 28px;
      align-items: start;
    }

    .eyebrow {
      margin: 0 0 10px;
      font-size: 12px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      color: var(--yellow);
      font-size: clamp(72px, 10vw, 124px);
      line-height: 0.92;
    }

    .subtext {
      margin: 12px 0 0;
      max-width: 480px;
      font-size: 20px;
      line-height: 1.22;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    .stat {
      border: 2px solid var(--white);
      padding: 16px;
      display: grid;
      gap: 8px;
      min-height: 118px;
    }

    .stat.highlight {
      border-color: var(--yellow);
      color: var(--yellow);
    }

    .label {
      font-size: 11px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }

    .value {
      font-size: 38px;
      line-height: 1;
      font-weight: 700;
    }

    .note {
      font-size: 14px;
      line-height: 1.25;
    }

    .bars {
      display: grid;
      gap: 14px;
    }

    .bar-row {
      display: grid;
      gap: 6px;
    }

    .bar-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 15px;
      align-items: baseline;
    }

    .bar-head strong {
      font-size: 22px;
      font-weight: 700;
    }

    .track {
      height: 14px;
      border: 2px solid var(--white);
    }

    .fill {
      height: 100%;
      background: var(--white);
    }

    .fill.highlight {
      background: var(--white);
    }

    .footer {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
      align-items: end;
      padding-top: 18px;
      border-top: 2px solid rgba(255, 255, 255, 0.22);
      font-size: 13px;
      line-height: 1.35;
    }

    @media (max-width: 900px) {
      .slide,
      .top,
      .stats,
      .footer {
        grid-template-columns: 1fr;
      }

      .slide {
        min-height: auto;
        padding: 24px;
      }

      .value {
        font-size: 32px;
      }
    }`;
}

function buildStatCard(stat) {
  const highlightClass = stat.highlight ? " highlight" : "";
  return `        <article class="stat${highlightClass}">
          <span class="label">${escapeHtml(stat.label)}</span>
          <span class="value">${escapeHtml(formatCount(stat.value))}</span>
          <span class="note">${escapeHtml(stat.note)}</span>
        </article>`;
}

function buildBarRow(bar) {
  const fillClass = bar.highlight ? "fill highlight" : "fill";
  return `      <div class="bar-row">
        <div class="bar-head"><span>${escapeHtml(bar.label)}</span><strong>${escapeHtml(formatCount(bar.value))}</strong></div>
        <div class="track"><div class="${fillClass}" style="width: ${bar.width.toFixed(1)}%"></div></div>
      </div>`;
}

function buildHtml(metrics) {
  return `<!DOCTYPE html>
<html lang="lt">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Training Plans Kodo Eilučių Suvestinė</title>
  <style>
${buildStylesheet()}
  </style>
</head>
<body>
  <main class="slide">
    <section class="top">
      <div>
        <p class="eyebrow">Training Plans / Kodo bazės suvestinė</p>
        <h1>${escapeHtml(formatCount(metrics.totalCode))}</h1>
        <p class="subtext">Kodo eilutės frontend, backend, testuose ir kitame nevykdomame projekto sluoksnyje.</p>
      </div>

      <div class="stats">
${metrics.stats.map(buildStatCard).join("\n")}
      </div>
    </section>

    <section class="bars" aria-label="Kategorijų palyginimas">
${metrics.bars.map(buildBarRow).join("\n")}
    </section>

    <footer class="footer">
      <div>${escapeHtml(`${formatCount(metrics.totalFiles)} suskaičiuoti šaltinio failai`)}</div>
    </footer>
  </main>
</body>
</html>`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const locReport = readJson(options.input);
  const metrics = buildMetrics(locReport);
  const html = buildHtml(metrics);

  ensureDir(path.dirname(options.output));
  fs.writeFileSync(options.output, html, "utf8");

  console.log(`Rendered LT code-lines visual to ${path.relative(rootDir, options.output)}`);
}

main();