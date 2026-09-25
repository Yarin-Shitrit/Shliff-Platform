// CI only: vitest.config.ts, plus a sequencer that splits `--shard=i/N` by how
// long each file takes rather than by a hash of its path. Used by
// .github/workflows/ci.yml; nothing local reads this file.
//
// vitest's own --shard gives every shard the same NUMBER of files, picked by
// path hash. Measured with 8 shards (PR #30, run 36132911713), that put the
// two heaviest files -- promote.test.ts and src/test/db.test.ts, ~29s each --
// in one shard, which ran 78s while another ran 56s. The slowest shard sets
// the wall-clock of the whole run.
//
// Coverage cannot change here. The shards partition the one list of test files
// vitest resolved from vitest.config.ts's `include`: every file goes to exactly
// one shard, whatever the weights say. The verdict job then checks that
// independently, against `git ls-files`.
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import base from './vitest.config';

// Seconds per test file, measured from a CI run's JSON reports. Refresh it from
// any green run's verdict job: gh run download <run id> -n test-timings -D .github
// A stale table only unbalances the shards; it can never drop or repeat a file.
const TIMINGS: Record<string, number> = JSON.parse(
  readFileSync(resolve(__dirname, '.github/test-timings.json'), 'utf8'),
);

// What a file costs beyond its own tests: environment, imports, setupFiles,
// transform. Measured at ~1.3s per file on a 2-core runner (run 36131956671:
// 934 worker-seconds for 552s of tests across 287 files).
const PER_FILE = 1.3;

// A file with no measurement yet -- new since the table was taken. The median
// is what a typical file costs.
const known = Object.values(TIMINGS).sort((a, b) => a - b);
const UNKNOWN = known.length ? known[Math.floor(known.length / 2)] : 1;

class TimedSequencer extends BaseSequencer {
  private rel(spec: TestSpecification): string {
    return relative(this.ctx.config.root, spec.moduleId).split(sep).join('/');
  }

  private weight(spec: TestSpecification): number {
    return (TIMINGS[this.rel(spec)] ?? UNKNOWN) + PER_FILE;
  }

  // Heaviest first, ties by path, so every shard computes the same order.
  private byWeight(files: TestSpecification[]): TestSpecification[] {
    return [...files].sort((a, b) => {
      const d = this.weight(b) - this.weight(a);
      if (d !== 0) return d;
      const ra = this.rel(a);
      const rb = this.rel(b);
      return ra < rb ? -1 : ra > rb ? 1 : 0;
    });
  }

  // Longest-processing-time first: each file goes to the shard with the least
  // work so far. Every shard runs this same deterministic assignment and keeps
  // only its own files, so the shards partition the list exactly.
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    const load = new Array<number>(count).fill(0);
    const mine: TestSpecification[] = [];
    for (const spec of this.byWeight(files)) {
      let k = 0;
      for (let j = 1; j < count; j++) if (load[j] < load[k]) k = j;
      load[k] += this.weight(spec);
      if (k === index - 1) mine.push(spec);
    }
    return mine;
  }

  // Inside a shard, start the long files first so the two workers finish
  // together instead of one waiting on a late 29s file.
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return this.byWeight(files);
  }
}

export default mergeConfig(
  base,
  defineConfig({
    test: {
      sequence: { sequencer: TimedSequencer },
    },
  }),
);
