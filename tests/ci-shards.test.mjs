import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { schedule, split } from '../scripts/ci/shards.mjs';
import { verificationPlan } from '../scripts/verify-app.mjs';
import { planVerification } from '../scripts/verify-plan.mjs';

test('balanced scheduling preserves nightly coverage and fails closed without reusable proof', async () => {
 const plan = await verificationPlan(), jobs = await schedule('push');
 assert.ok(jobs.length >= 8 && jobs.length <= 14);
 const units = jobs.flatMap(job => job.lanes.flatMap(lane => lane.units));
 assert.equal(units.filter(unit => unit.label.endsWith(': hosted checks')).length, 1);
 assert.ok(jobs.every(job => job.lanes.length === 3 && job.lanes.every(lane => lane.seconds <= 780)));
 for (const tier of ['push', 'nightly', 'all']) {
  const decision = await planVerification({ plan, pushMatrix: jobs, env: { TIER: tier }, fetch: () => { throw Error('unavailable'); } });
  assert.equal(decision.coverage, 'full');
  assert.equal(decision.skip, false);
  const expected = tier === 'all' ? [...jobs, ...plan.nightly] : tier === 'push' ? jobs : plan.nightly;
  assert.deepEqual(decision.matrix.include, expected.map(({ name, browser }) => ({ name, browser })));
 }
});

test('partition executes literal, nested and computed registrations once with original filters', () => {
 const root = mkdtempSync(join(tmpdir(), 'coffer-ci-partition-')), original = process.cwd();
 try {
  mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'tests/fixture.mjs'), [
   "import test from 'node:test';",
   "import { appendFileSync } from 'node:fs';",
   "const record = name => appendFileSync('executed.txt', name + '\\n');",
   "test('keep literal', () => record('literal'));",
   "test('keep parent', async t => { record('parent'); await t.test('nested', () => record('nested')); });",
   "test('drop literal', () => record('excluded'));",
   "for (const name of ['keep computed']) test(name, () => record('computed'));",
  ].join('\n'));
  process.chdir(root);
  const units = split("node --test --test-name-pattern='^keep' --test-skip-pattern='drop' tests/fixture.mjs", { name: 'fixture' });
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const unit of units) execFileSync('/bin/bash', ['-euo', 'pipefail', '-c', unit.command], { stdio: 'pipe', env });
  assert.deepEqual(readFileSync('executed.txt', 'utf8').trim().split('\n').sort(), ['computed', 'literal', 'nested', 'parent']);
 } finally {
  process.chdir(original);
  rmSync(root, { recursive: true, force: true });
 }
});

test('reuse requires every balanced job alongside the current full-push proof', async () => {
 const plan = await verificationPlan(), pushMatrix = await schedule('push');
 const sha = 'a'.repeat(40), repository = { id: 1, full_name: 'owner/coffer' };
 const run = (id, head_branch) => ({ id, head_branch, workflow_id: 7, run_attempt: 1, name: 'Verify', head_sha: sha,
  event: 'push', status: 'completed', conclusion: 'success', repository, head_repository: repository });
 const current = run(20, 'main'), evidence = run(19, 'cloud/candidate');
 const env = { GITHUB_REPOSITORY: repository.full_name, GITHUB_RUN_ID: '20', GITHUB_SHA: sha,
  GITHUB_TOKEN: 'fixture-only', GITHUB_WORKFLOW: 'Verify', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' };
 const names = ['plan', 'full-push-proof', 'verify', ...pushMatrix.map(job => `shards (${job.name})`)];
 for (const missing of [false, true]) {
  const jobs = names.slice(0, missing ? -1 : undefined).map((name, index) => ({ id: index + 1, run_id: 19,
   run_attempt: 1, name, status: 'completed', conclusion: 'success' }));
  const fetch = async url => {
   const path = new URL(url).pathname;
   const value = path.endsWith('/runs/20') ? current : path.endsWith('/runs/19') ? evidence
    : path.endsWith('/jobs') ? { total_count: jobs.length, jobs }
    : { total_count: 1, workflow_runs: [evidence] };
   return { status: 200, json: async () => value };
  };
  const decision = await planVerification({ plan, pushMatrix, env, fetch });
  assert.equal(decision.coverage, missing ? 'full' : 'reuse');
  assert.equal(decision.skip, !missing);
 }
});

test('nested-package setup follows consumers and the tight membership journey owns its runner', async () => {
 const jobs = await schedule('push');
 let consumers = 0, exclusive = 0;
 for (const job of jobs) {
  const units = job.lanes.flatMap(lane => lane.units);
  for (const unit of units.filter(unit => unit.label.startsWith('donors:'))) {
   consumers++;
   assert.deepEqual(job.prerequisites, ['npm ci --prefix integrations/zapier --no-audit --no-fund', 'npm run validate --prefix integrations/zapier']);
  }
  if (units.some(unit => unit.label.includes(': CAMP-004:'))) {
   exclusive++;
   assert.equal(units.length, 1);
  }
 }
 assert.ok(consumers > 0);
 assert.equal(exclusive, 1);
});
