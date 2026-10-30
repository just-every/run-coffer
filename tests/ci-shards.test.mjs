import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { schedule } from '../scripts/ci/shards.mjs';
import { planVerification } from '../scripts/verify-plan.mjs';

const jobs = Object.fromEntries(await Promise.all(['push', 'nightly', 'all'].map(async tier => [tier, await schedule(tier)])));
const units = tier => jobs[tier].flatMap(job => job.lanes.flatMap(lane => lane.units));
test('balanced schedules retain every tier command and exactly one hosted push invocation', () => {
 assert.equal(jobs.push.length, 8);
 for (const tier of ['push', 'nightly', 'all']) {
  assert.ok(jobs[tier].length <= 8);
  assert.equal(new Set(jobs[tier].map(job => job.name)).size, jobs[tier].length);
  assert.ok(jobs[tier].every(job => job.lanes.length === 3));
 }
 assert.deepEqual(units('all').map(unit => unit.command).sort(), [...units('push'), ...units('nightly')].map(unit => unit.command).sort());
 assert.equal(units('push').filter(unit => unit.label.endsWith(': hosted checks')).length, 1);
 assert.equal(units('all').filter(unit => unit.label.endsWith(': hosted checks')).length, 1);
});
test('coverage planner emits balanced jobs for push, nightly and all without replacing source commands', async () => {
 const plan = JSON.parse(await readFile('verification.json', 'utf8'));
 const executionPlan = Object.fromEntries(Object.entries(jobs).map(([tier, scheduled]) => [tier, scheduled.map(({ name, browser }) => ({ name, browser }))]));
 for (const tier of ['push', 'nightly', 'all']) {
  const decision = await planVerification({ plan, executionPlan, env: { TIER: tier }, fetch: async () => { throw Error('unavailable'); } });
  assert.equal(decision.coverage, 'full');
  assert.deepEqual(decision.matrix.include, executionPlan[tier]);
 }
});
