const path = require('path');
const j = require(path.resolve(__dirname, '..', 'coverage', 'coverage-summary.json'));
const rows = Object.entries(j)
  .filter(([k]) => k !== 'total')
  .map(([k, v]) => ({
    k, fnTotal: v.functions.total, fnCov: v.functions.covered,
    fnMiss: v.functions.total - v.functions.covered, fnPct: v.functions.pct,
    lnMiss: v.lines.total - v.lines.covered,
  }))
  .filter(x => x.fnMiss >= 8)
  .sort((a, b) => b.fnMiss - a.fnMiss)
  .slice(0, 25);
for (const r of rows) {
  const p = r.k.replace(/.*[\\/]src[\\/]/, 'src/').replace(/\\/g, '/');
  console.log(`${String(r.fnMiss).padStart(3)} miss  ${r.fnPct.toFixed(0).padStart(3)}%fn  lnMiss=${String(r.lnMiss).padStart(4)}  ${p}`);
}
