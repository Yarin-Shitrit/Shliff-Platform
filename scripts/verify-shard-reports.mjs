// Checks that the sharded test run, taken as a whole, ran every test file once.
//
// Each shard already cross-checks its own report (verify-test-report.mjs):
// exit code against failures, and any skip as a worker that died. What no shard
// can see is a shard that is not there. A matrix job that never started, or died
// before it wrote a report, leaves the other shards green -- and "every report
// I was given is clean" reads exactly like "the suite passed".
//
// So the expected set of test files does not come from the reports. It comes
// from git: every tracked file matching vitest.config.ts's `include`. That is an
// oracle the test run did not produce. The reports have to cover that set
// exactly -- no file missing, none run twice, none unexplained.
//
// If vitest.config.ts's `include` ever changes, change INCLUDE below with it.
// Until then this fails, which is the safe direction.
//
// Usage: node scripts/verify-shard-reports.mjs <directory of shard reports> [timings-out.json]
// Reports are named vitest-report-<i>-of-<n>.json. With a second argument it
// also writes each file's measured seconds -- the table vitest.ci.config.ts
// balances the shards by -- whether or not the run was green.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Mirrors vitest.config.ts `include`. `:(glob)` is load-bearing: without it git
// reads `**/` as "at least one directory" and misses src/proxy.test.ts.
const INCLUDE = [':(glob)src/**/*.test.ts', ':(glob)src/**/*.test.tsx'];

const dir = process.argv[2];
const timingsOut = process.argv[3];
if (!dir) {
  console.error('usage: verify-shard-reports.mjs <directory of shard reports> [timings-out.json]');
  process.exit(2);
}

const problems = [];

const expected = execFileSync('git', ['ls-files', '--', ...INCLUDE], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
if (expected.length === 0) {
  console.error('✗ git lists no test files at all. The oracle is dead; nothing can be verified.');
  process.exit(1);
}

const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
const reports = [];
for (const name of names) {
  const m = name.match(/^vitest-report-(\d+)-of-(\d+)\.json$/);
  if (m) reports.push({ name, index: Number(m[1]), count: Number(m[2]) });
}

if (reports.length === 0) {
  console.error(`✗ no shard reports in ${dir}. No shard's result reached this job.`);
  process.exit(1);
}

const counts = new Set(reports.map((r) => r.count));
if (counts.size !== 1) {
  problems.push(`Reports disagree about the number of shards: ${[...counts].join(', ')}.`);
}
const shardCount = Math.max(...counts);
for (let i = 1; i <= shardCount; i++) {
  if (!reports.some((r) => r.index === i)) {
    problems.push(
      `Shard ${i} of ${shardCount} left no report. Its files did not run, or ran ` +
        'and the result was lost -- either way, they are not verified.',
    );
  }
}

const seen = new Map(); // file -> shard index
const seconds = new Map(); // file -> measured seconds
const rows = [];
let tests = 0;
let failed = 0;
let skipped = 0;

for (const r of reports.sort((a, b) => a.index - b.index)) {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(path.join(dir, r.name), 'utf8'));
  } catch (err) {
    problems.push(`Shard ${r.index}: ${r.name} is not valid JSON (${err.message}).`);
    continue;
  }

  const results = report.testResults ?? [];
  tests += report.numTotalTests ?? 0;
  failed += report.numFailedTests ?? 0;
  skipped += (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);
  if (report.success !== true) problems.push(`Shard ${r.index}: the report does not say success.`);

  let start = Infinity;
  let end = -Infinity;
  for (const t of results) {
    const file = path.relative(process.cwd(), t.name);
    if (seen.has(file)) {
      problems.push(`${file} ran in shard ${seen.get(file)} and again in shard ${r.index}.`);
    }
    seen.set(file, r.index);
    seconds.set(file, Math.round((t.endTime - t.startTime) / 100) / 10);
    if (t.status !== 'passed') problems.push(`Shard ${r.index}: ${file} is ${t.status}.`);
    start = Math.min(start, t.startTime);
    end = Math.max(end, t.endTime);
  }
  rows.push({
    shard: r.index,
    files: results.length,
    tests: report.numTotalTests ?? 0,
    seconds: results.length ? Math.round((end - start) / 1000) : 0,
  });
}

const missing = expected.filter((f) => !seen.has(f));
const expectedSet = new Set(expected);
const unexpected = [...seen.keys()].filter((f) => !expectedSet.has(f));
if (missing.length > 0) {
  problems.push(
    `${missing.length} of ${expected.length} test file(s) appear in no shard's report:\n` +
      missing.map((f) => `      ${f}`).join('\n'),
  );
}
if (unexpected.length > 0) {
  problems.push(
    `${unexpected.length} file(s) ran that git does not list as a test file:\n` +
      unexpected.map((f) => `      ${f}`).join('\n'),
  );
}
if (failed > 0) problems.push(`${failed} test(s) failed.`);
if (skipped > 0) {
  problems.push(
    `${skipped} test(s) skipped or todo. This suite has no deliberate skips, so a ` +
      'worker died and took them with it.',
  );
}

console.log('shard  files  tests  seconds');
for (const row of rows) {
  console.log(
    `${String(row.shard).padStart(5)}  ${String(row.files).padStart(5)}  ` +
      `${String(row.tests).padStart(5)}  ${String(row.seconds).padStart(7)}`,
  );
}
console.log(
  `\n${seen.size} of ${expected.length} test files, ${tests} tests, ` +
    `across ${reports.length} of ${shardCount} shard reports.`,
);

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '### Test shards',
    '',
    '| shard | files | tests | seconds |',
    '|---:|---:|---:|---:|',
    ...rows.map((x) => `| ${x.shard} | ${x.files} | ${x.tests} | ${x.seconds} |`),
    '',
    `${seen.size} of ${expected.length} test files, ${tests} tests.`,
    '',
  ];
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
}

if (timingsOut) {
  const table = {};
  for (const file of [...seconds.keys()].sort()) table[file] = seconds.get(file);
  fs.writeFileSync(timingsOut, JSON.stringify(table, null, 2) + '\n');
  console.log(`wrote ${seconds.size} file timings to ${timingsOut}`);
}

if (problems.length > 0) {
  console.error('\n✗ the sharded run cannot be read as green:\n');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`✓ every test file ran exactly once, in ${shardCount} shards, and passed.`);
