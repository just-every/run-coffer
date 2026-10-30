// CI-only scheduling: verification.json remains the authority for commands,
// browser opt-ins, test selections and the one hosted verification invocation.
import { realpathSync } from 'node:fs';
import { readFileSync, readdirSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { verificationPlan } from '../verify-app.mjs';

const JOBS = 8;
const WORKERS = 3;
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const estimates = JSON.parse(readFileSync(new URL('./durations.json', import.meta.url), 'utf8'));
const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
const option = /--test-name-pattern(?:=|\s+)('(?:[^']*)'|"(?:[^"]*)"|[^\s]+)/;
const skipOption = /--test-skip-pattern(?:=|\s+)('(?:[^']*)'|"(?:[^"]*)"|[^\s]+)/;
const unquote = value => /^['"]/.test(value) ? value.slice(1, -1) : value;

function split(command, shard) {
 // Expand only the existing Node test scripts. Other commands, including rer's
 // hosted production-output/hydration checks, retain their original entry point.
 command = command.replace(/\bpnpm run ([\w:-]+)/g, (match, name) =>
  /\bnode --test\b/.test(scripts[name] ?? '') ? scripts[name] : match);
 if (!/\bnode --test\b/.test(command)) return [{ command, label: shard.name, seconds: 100 }];
 const patterns = [...command.matchAll(/\btests\/[\w.*-]+\.mjs\b/g)].map(match => match[0]);
 if (!patterns.length) return [{ command, label: shard.name, seconds: 100 }];
 const files = [...new Set(patterns.flatMap(pattern => {
  const patternRegex = new RegExp('^' + pattern.split('*').map(escape).join('.*') + '$');
  return readdirSync('tests').map(name => 'tests/' + name).filter(name => patternRegex.test(name));
 }))];
 if (!files.length) throw Error(`No test files for ${command}`);
 const names = new Set();
 for (const file of files) {
  // Recognize only direct, literal registrations. The complement below always
  // runs too: loops, computed names, suites and future registration forms cannot
  // silently disappear when the scheduler does not recognize them.
  const source = readFileSync(file, 'utf8');
  const literals = /(?:^|\n)[ \t]*test\(\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\s*,/g;
  for (const match of source.matchAll(literals)) {
   const body = match[1].slice(1, -1);
   if (/\\[^'"\\]/.test(body)) continue;
   names.add(body.replace(/\\(['"\\])/g, '$1'));
  }
 }
 if (!names.size) return [{ command, label: shard.name, seconds: 100 }];
 const include = option.exec(command);
 const exclude = skipOption.exec(command);
 const selected = name => (!include || new RegExp(unquote(include[1])).test(name))
  && (!exclude || !new RegExp(unquote(exclude[1])).test(name));
 const filtered = pattern => {
  // Keep the original include/skip intersection, in addition to partitioning.
  const intersection = include ? `(?=[\\s\\S]*(?:${unquote(include[1])}))(?:${pattern})` : pattern;
  const flag = '--test-name-pattern=' + quote(intersection);
  return include ? command.replace(option, () => flag) : command.replace(/\bnode --test\b/, match => match + ' ' + flag);
 };
 const units = [...names].filter(selected).map(name => ({
  command: filtered('^' + escape(name) + '(?:$| > )'),
  label: shard.name + ': ' + name,
  seconds: estimates[name] ?? 90,
 }));
 units.push({
  command: filtered('^(?!(?:' + [...names].map(escape).join('|') + ')(?:$| > ))'),
  label: shard.name + ': remaining registrations',
  seconds: 30,
 });
 // Validate the partition whenever CI constructs its matrix. Original name
 // filters must select each recognized registration exactly once, or zero times
 // when the authoritative command excludes it.
 for (const name of names) {
  const matches = units.filter(unit => {
   const pattern = option.exec(unit.command);
   return new RegExp(unquote(pattern[1])).test(name)
    && (!exclude || !new RegExp(unquote(exclude[1])).test(name));
  }).length;
  if (matches !== Number(selected(name))) throw Error(`Invalid CI partition: ${shard.name}: ${name}`);
 }
 return units;
}

export async function schedule(tier) {
 if (!['push', 'nightly', 'all'].includes(tier)) throw Error('Expected push, nightly or all');
 const plan = await verificationPlan();
 const shards = tier === 'all' ? [...plan.push, ...plan.nightly] : plan[tier];
 const units = shards.flatMap(shard => shard.hosted
  ? [{ command: 'node scripts/verify-ci.mjs ' + quote(shard.name), label: shard.name + ': hosted checks', seconds: 100 }]
  : shard.commands.flatMap(command => split(command, shard)));
 const lanes = Array.from({ length: JOBS * WORKERS }, (_, index) => ({ index, seconds: 0, units: [] }));
 // Longest first balances the actual selected tests rather than file counts.
 for (const unit of units.sort((a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label))) {
  const lane = [...lanes].sort((a, b) => a.seconds - b.seconds || a.index - b.index)[0];
  lane.units.push(unit);
  lane.seconds += unit.seconds;
 }
 return Array.from({ length: JOBS }, (_, index) => ({
  name: 'balanced-' + (index + 1), browser: true,
  lanes: lanes.filter(lane => lane.index % JOBS === index),
 })).filter(job => job.lanes.some(lane => lane.units.length));
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename)) {
const [mode, value = 'push'] = process.argv.slice(2);
if (mode === '--matrix') {
 console.log(JSON.stringify({ include: (await schedule(value)).map(({ name, browser }) => ({ name, browser })) }));
} else if (mode === '--check') {
 for (const tier of ['push', 'nightly', 'all']) {
  const jobs = await schedule(tier);
  console.log(tier + ': ' + jobs.flatMap(job => job.lanes.flatMap(lane => lane.units)).length + ' commands; ' + jobs.map(job => job.name + '=' + Math.max(...job.lanes.map(lane => lane.seconds)) + 's').join(', '));
 }
} else {
 const job = (await schedule(value)).find(job => job.name === mode);
 if (!job) throw Error('Usage: shards.mjs --matrix|--check push|all OR balanced-N push|all');
 const directory = '.cache/ci/' + job.name;
 mkdirSync(directory, { recursive: true });
 const active = new Set();
 for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  for (const pid of active) {
   try { process.kill(-pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  process.exit(signal === 'SIGINT' ? 130 : 143);
 });
 let failures = 0;
 await Promise.all(job.lanes.map(async (lane, laneIndex) => {
  for (const [index, unit] of lane.units.entries()) {
   const log = `${directory}/${laneIndex}-${index}.log`;
   const fd = openSync(log, 'w');
   const start = Date.now();
   console.log(`START lane=${laneIndex} ${unit.label}\n> ${unit.command}`);
   const child = spawn('/bin/bash', ['-euo', 'pipefail', '-c', unit.command], {
    env: process.env, detached: true, stdio: ['ignore', fd, fd],
   });
   if (child.pid) active.add(child.pid);
   let failure;
   const code = await new Promise(resolve => {
    child.once('error', error => { failure = error; resolve(1); });
    child.once('close', status => resolve(status ?? 1));
   });
   active.delete(child.pid);
   closeSync(fd);
   process.stdout.write(readFileSync(log, 'utf8'));
   if (failure) console.error(failure);
   console.log(`END lane=${laneIndex} exit=${code} seconds=${((Date.now() - start) / 1000).toFixed(1)} ${unit.label}`);
   if (code !== 0) failures++;
  }
 }));
 if (failures) {
  console.error(`${failures} verification commands failed`);
  process.exitCode = 1;
 }
}

}
