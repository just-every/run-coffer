import test from 'node:test';
import assert from 'node:assert/strict';
import { schedule } from '../scripts/ci/shards.mjs';
import { verificationPlan } from '../scripts/verify-app.mjs';
import { planVerification } from '../scripts/verify-plan.mjs';

test('balanced plans retain every authoritative command group within the runner bounds', async () => {
 const plan = await verificationPlan();
 for (const tier of ['push', 'all']) {
  const jobs = await schedule(tier);
  assert.ok(jobs.length >= 8 && jobs.length <= 14);
  const units = jobs.flatMap(job => job.lanes.flatMap(lane => lane.units));
  for (const shard of tier === 'all' ? [...plan.push, ...plan.nightly] : plan.push) {
   assert.ok(units.some(unit => unit.label === shard.name || unit.label.startsWith(shard.name + ': ')), shard.name);
  }
  assert.equal(units.filter(unit => unit.label.endsWith(': hosted checks')).length, 1);
  for (const job of jobs) {
   for (const lane of job.lanes) {
    assert.ok(lane.seconds + 120 <= 900);
    if (lane.units.some(unit => unit.exclusive)) assert.equal(job.lanes.length, 1);
   }
  }
 }
});

test('planning uses scheduled jobs for push/all and preserves native nightly coverage', async () => {
 const plan = await verificationPlan();
 const matrices = { push: await schedule('push'), all: await schedule('all') };
 for (const tier of ['push', 'nightly', 'all']) {
  const decision = await planVerification({ env: { TIER: tier }, plan, matrices });
  assert.equal(decision.coverage, 'full');
  assert.deepEqual(decision.matrix.include, (matrices[tier] ?? plan[tier]).map(({ name, browser }) => ({ name, browser })));
 }
 const tag = await planVerification({ env: { GITHUB_REF: 'refs/tags/v1' }, plan, matrices });
 assert.equal(tag.tier, 'all');
 assert.deepEqual(tag.matrix.include, matrices.all.map(({ name, browser }) => ({ name, browser })));
});

test('reuse requires successful balanced jobs, rejecting obsolete semantic shard proof', async () => {
 const plan = await verificationPlan(), matrices = { push: await schedule('push') };
 const sha = 'a'.repeat(40), repository = { id: 1, full_name: 'owner/seed' };
 const run = { id: 2, workflow_id: 1, run_attempt: 1, name: 'Verify', head_sha: sha, head_branch: 'candidate',
  event: 'push', status: 'completed', conclusion: 'success', repository, head_repository: repository };
 const current = { ...run, id: 3, head_branch: 'main', status: 'in_progress', conclusion: null };
 const env = { GITHUB_REPOSITORY: repository.full_name, GITHUB_RUN_ID: '3', GITHUB_SHA: sha,
  GITHUB_TOKEN: 'fixture', GITHUB_WORKFLOW: 'Verify', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' };
 for (const balanced of [false, true]) {
  const names = ['plan', 'full-push-proof', 'verify', ...(balanced ? matrices.push : plan.push).map(job => 'shards (' + job.name + ')')];
  const jobs = names.map((name, index) => ({ id: index + 1, run_id: 2, run_attempt: 1, name, status: 'completed', conclusion: 'success' }));
  const fetch = async url => {
   const path = new URL(url).pathname;
   const data = path.endsWith('/actions/runs/3') ? current : path.endsWith('/actions/runs/2') ? run
    : path.endsWith('/jobs') ? { total_count: jobs.length, jobs } : { total_count: 1, workflow_runs: [run] };
   return { status: 200, json: async () => data };
  };
  const decision = await planVerification({ env, fetch, plan, matrices });
  assert.equal(decision.coverage, balanced ? 'reuse' : 'full');
  assert.equal(decision.skip, balanced);
 }
});
