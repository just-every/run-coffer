import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;

function fixture(failPreparation) {
 const root = mkdtempSync(join(tmpdir(), 'coffer-ci-order-'));
 mkdirSync(join(root, 'scripts/ci'), { recursive: true });
 mkdirSync(join(root, 'tests'));
 for (const file of ['ci/shards.mjs', 'ci/durations.json', 'verify-app.mjs']) {
  copyFileSync(new URL('../' + file, import.meta.url), join(root, 'scripts', file));
 }
 writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: {} }));
 const prepare = failPreparation ? 'node -e "process.exit(23)"'
  : String.raw`node -e "require('fs').appendFileSync('events', 'installed\n')"`;
 const validate = String.raw`node -e "const fs=require('fs');if(fs.readFileSync('events','utf8')!=='installed\n')process.exit(24);fs.appendFileSync('events','validated\n')"`;
 writeFileSync(join(root, 'verification.json'), JSON.stringify({ push: [
  { name: 'campaign-progress', browser: false, hosted: false, commands: [prepare, validate, 'node --test tests/membership.mjs'] },
  { name: 'runtime', browser: false, hosted: true, commands: ['node --version'] },
 ], nightly: [] }));
 writeFileSync(join(root, 'tests/membership.mjs'), String.raw`import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,appendFileSync} from 'node:fs';
test('CAMP-004: fixture', () => {
 assert.equal(readFileSync('events','utf8'), 'installed\nvalidated\n');
 appendFileSync('events','test\n');
});
`);
 return root;
}

function runMembership(root) {
 const options = { cwd: root, encoding: 'utf8', env: childEnv };
 const plan = spawnSync(process.execPath, ['scripts/ci/shards.mjs', '--plan', 'push'], options);
 assert.equal(plan.status, 0, plan.stdout + plan.stderr);
 const job = JSON.parse(plan.stdout).find(job => job.lanes.some(lane => lane.units.some(unit => unit.label.includes(': CAMP-004:'))));
 assert.ok(job, 'membership verification has a scheduled runner');
 return spawnSync(process.execPath, ['scripts/ci/shards.mjs', job.name, 'push'], options);
}

test('runner executes ordered shard prerequisites once before dependent tests', () => {
 const root = fixture(false);
 try {
  const result = runMembership(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(join(root, 'events'), 'utf8'), 'installed\nvalidated\ntest\n');
 } finally { rmSync(root, { recursive: true, force: true }); }
});

test('failed preparation fails the job before validation or test execution', () => {
 const root = fixture(true);
 try {
  const result = runMembership(root);
  assert.equal(result.status, 23, result.stdout + result.stderr);
  assert.match(result.stdout, /exit=23/);
  assert.equal(existsSync(join(root, 'events')), false);
  assert.doesNotMatch(result.stdout, /START lane=0/);
 } finally { rmSync(root, { recursive: true, force: true }); }
});
