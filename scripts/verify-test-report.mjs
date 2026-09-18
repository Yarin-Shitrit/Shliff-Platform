// Cross-checks a vitest JSON report against its own exit code.
//
// A green suite is not the same as a suite that ran. This repository has
// produced both of the failures below, and neither is visible in a normal
// reading of the output:
//
//   * exit code 1 with numFailedTests: 0 -- workers were SIGKILLed under memory
//     pressure. The deaths surface as unhandled errors, not as failures, and a
//     run reporting "failed: 0" reads as success.
//   * tests reported `pending` with no `.skip` anywhere in the codebase -- a
//     killed worker's un-run tests come back skipped. A skip reads as somebody's
//     deliberate choice, so the suite stays green and the lost coverage is
//     invisible.
//
// The suite contains no deliberate skips. That makes any skip an oracle this
// test run did not produce: if one appears, a worker died.
//
// Usage: node scripts/verify-test-report.mjs <report.json> <vitest-exit-code>

import fs from 'node:fs';

const [, , reportPath, exitCodeArg] = process.argv;

if (!reportPath) {
  console.error('usage: verify-test-report.mjs <report.json> <vitest-exit-code>');
  process.exit(2);
}

const vitestExit = Number(exitCodeArg ?? 0);

if (!fs.existsSync(reportPath)) {
  console.error(
    `✗ no report at ${reportPath}.\n` +
      '  vitest produced no JSON at all, which usually means it died before it ' +
      'could write one.\n' +
      `  vitest exit code was ${vitestExit}.`,
  );
  process.exit(1);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch (err) {
  console.error(`✗ ${reportPath} is not valid JSON: ${err.message}`);
  console.error('  A truncated report means the run was cut off mid-write.');
  process.exit(1);
}

const total = report.numTotalTests ?? 0;
const passed = report.numPassedTests ?? 0;
const failed = report.numFailedTests ?? 0;
const pending = report.numPendingTests ?? 0;
const todo = report.numTodoTests ?? 0;
const suites = report.numTotalTestSuites ?? 0;

console.log(
  `report: ${total} tests in ${suites} suites — ` +
    `${passed} passed, ${failed} failed, ${pending} skipped, ${todo} todo`,
);

const problems = [];

if (total === 0) {
  problems.push('The report contains no tests at all. Nothing was verified.');
}

if (failed > 0) {
  problems.push(`${failed} test(s) failed.`);
}

if (pending > 0 || todo > 0) {
  problems.push(
    `${pending + todo} test(s) reported skipped or todo. This suite contains no ` +
      'deliberate skips, so this is a worker that died and took its un-run ' +
      'tests with it — not somebody\'s choice. The coverage is missing, not waived.',
  );
}

// The dangerous direction: vitest is unhappy but the counts look clean.
if (vitestExit !== 0 && failed === 0) {
  problems.push(
    `vitest exited ${vitestExit} while reporting 0 failures. Workers died rather ` +
      'than tests failing — look at the Unhandled Errors block in the log above. ' +
      'Do not read this as a green suite.',
  );
}

// The report's own verdict, cross-checked against its counts. Not independent
// of the report, but a disagreement inside one document is still a signal.
if (report.success === false && failed === 0) {
  problems.push(
    'The report sets success: false while listing 0 failures. Something ended ' +
      'the run that was not a failing test.',
  );
}

// The other direction: a clean exit that disagrees with the report.
if (vitestExit === 0 && failed > 0) {
  problems.push(
    `vitest exited 0 but the report lists ${failed} failure(s). The exit code and ` +
      'the report disagree; trust neither until you know why.',
  );
}

if (problems.length > 0) {
  console.error('\n✗ this run cannot be read as green:\n');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`✓ ${passed} tests ran and passed; none skipped; exit code agrees.`);
