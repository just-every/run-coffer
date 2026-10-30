// CI-only scheduling: verification.json remains the authority for commands,
// browser opt-ins, test selections and the one hosted verification invocation.
import { readFileSync, readdirSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { verificationPlan } from '../verify-app.mjs';

const MIN_JOBS = 8;
const MAX_JOBS = 14;
const WORKERS = 3;
const JOB_TARGET = 15 * 60;
const SETUP_SECONDS = 120;
const LANE_TARGET = JOB_TARGET - SETUP_SECONDS;
// Successful END lines from Verify 40911159077 (fb0d74b6), including its
// browser opt-ins. The run was cancelled, so incomplete units retain the prior
// samples. The computed move-in group uses its larger, fixed-complement local
// observation. Pad observations by 10%; reserve two minutes for runner setup.
const weight = seconds => Math.ceil(seconds * 1.1);
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const estimates = JSON.parse(readFileSync(new URL('./durations.json', import.meta.url), 'utf8'));
const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
const option = /--test-name-pattern(?:=|\s+)('(?:[^']*)'|"(?:[^"]*)"|[^\s]+)/;
const skipOption = /--test-skip-pattern(?:=|\s+)('(?:[^']*)'|"(?:[^"]*)"|[^\s]+)/;
const unquote = value => /^['"]/.test(value) ? value.slice(1, -1) : value;

export function split(command, shard) {
 // Expand only the existing Node test scripts. Other commands, including rer's
 // hosted production-output/hydration checks, retain their original entry point.
 command = command.replace(/\bpnpm run ([\w:-]+)/g, (match, name) =>
  /\bnode --test\b/.test(scripts[name] ?? '') ? scripts[name] : match);
 if (!/\bnode --test\b/.test(command)) return [{ command, label: shard.name, seconds: weight(estimates[command] ?? 100) }];
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
  seconds: weight(estimates[name] ?? 90),
 }));
 units.push({
  // Node also matches the synthetic <root> ancestor. A negative include matches
  // that root and runs every descendant again, including browser journeys.
  // Exclude the recognized registrations with a positive skip instead, keeping
  // the original include and skip so computed/future registrations still run.
  command: (() => {
   const known = '^(?:' + [...names].map(escape).join('|') + ')(?:$| > )';
   const flag = '--test-skip-pattern=' + quote(exclude ? '(?:' + unquote(exclude[1]) + ')|(?:' + known + ')' : known);
   return exclude ? command.replace(skipOption, () => flag) : command.replace(/\bnode --test\b/, match => match + ' ' + flag);
  })(),
  label: shard.name + ': remaining registrations (' + files.join(', ') + ')',
  seconds: weight(estimates['remaining:' + files.join(', ')] ?? 30),
 });
 // Validate the partition whenever CI constructs its matrix. Original name
 // filters must select each recognized registration exactly once, or zero times
 // when the authoritative command excludes it.
 for (const name of names) {
  const matches = units.filter(unit => {
   const pattern = option.exec(unit.command);
   const skip = skipOption.exec(unit.command);
   return (!pattern || new RegExp(unquote(pattern[1])).test(name))
    && (!skip || !new RegExp(unquote(skip[1])).test(name));
  }).length;
  if (matches !== Number(selected(name))) throw Error(`Invalid CI partition: ${shard.name}: ${name}`);
 }
 for (const unit of units) {
  for (const pattern of [option.exec(unit.command), skipOption.exec(unit.command)].filter(Boolean)) {
   if (['', '<root>'].some(root => new RegExp(unquote(pattern[1])).test(root))) {
    throw Error(`CI partition matches Node's synthetic root: ${unit.label}`);
   }
  }
 }
 return units;
}

// Nested-package installation is local to one runner. Keep its ordered setup
// prefix with every distributed consumer, never as an independent work unit.
export function shardUnits(shard) {
 if (shard.hosted) return [{ command: 'node scripts/verify-ci.mjs ' + quote(shard.name), label: shard.name + ': hosted checks', seconds: weight(estimates['hosted checks'] ?? 100) }];
 const firstTest = shard.commands.findIndex(command => /\bnode --test\b|\bpnpm run test:/.test(command));
 const setup = /^npm ci\b/.test(shard.commands[0]) && firstTest > 0 ? shard.commands.slice(0, firstTest) : [];
 return shard.commands.slice(setup.length).flatMap(command => split(command, shard))
  .map(unit => ({ ...unit, prerequisites: setup, exclusive: unit.label.includes(': CAMP-004:') }));
}
const prerequisiteSeconds = commands => commands.reduce((total, command) => total + weight(estimates[command] ?? 30), 0);
export async function schedule(tier) {
 if (!['push', 'all'].includes(tier)) throw Error('Expected push or all');
 const plan = await verificationPlan();
 const shards = tier === 'all' ? [...plan.push, ...plan.nightly] : plan.push;
 const units = shards.flatMap(shardUnits);
 // Tight browser registrations get a whole runner, not just a lane. Every
 // other runner retains three lanes and the original fifteen-minute target.
 units.sort((a, b) => Number(Boolean(b.exclusive)) - Number(Boolean(a.exclusive)) || b.seconds - a.seconds || a.label.localeCompare(b.label));
 for (let count = MIN_JOBS; count <= MAX_JOBS; count++) {
  const jobs = Array.from({ length: count }, (_, index) => ({
   name: 'balanced-' + (index + 1), browser: true, prerequisites: [], exclusive: false,
   lanes: Array.from({ length: WORKERS }, () => ({ seconds: 0, units: [], isolated: false })),
  }));
  let assigned = 0;
  for (const unit of units) {
   const isolate = unit.seconds >= LANE_TARGET * 0.75;
   const candidates = jobs.filter(job => !job.exclusive && (!unit.exclusive || job.lanes.every(lane => !lane.units.length)))
    .flatMap(job => job.lanes.filter(lane => !lane.isolated && (!isolate || !lane.units.length)).map(lane => {
     const prerequisites = [...new Set([...job.prerequisites, ...(unit.prerequisites ?? [])])];
     const seconds = prerequisiteSeconds(prerequisites) + Math.max(...job.lanes.map(other => other.seconds + (other === lane ? unit.seconds : 0)));
     return { job, lane, prerequisites, seconds };
    })).filter(candidate => candidate.seconds <= LANE_TARGET)
    .sort((a, b) => a.lane.seconds - b.lane.seconds || a.seconds - b.seconds);
   const candidate = candidates[0];
   if (!candidate) break;
   const { job, lane, prerequisites } = candidate;
   job.prerequisites = prerequisites;
   job.exclusive ||= Boolean(unit.exclusive);
   lane.units.push(unit);
   lane.seconds += unit.seconds;
   lane.isolated = isolate;
   assigned++;
  }
  if (assigned === units.length) return jobs;
 }
 throw Error(`Verification cannot fit ${MAX_JOBS} shards within ${JOB_TARGET}s including setup; split the longest registration group`);
}

const invokedDirectly = () => { try { return realpathSync(process.argv[1]) === realpathSync(import.meta.filename); } catch { return false; } };
if (invokedDirectly()) {
const [mode, value = 'push'] = process.argv.slice(2);
if (mode === '--matrix') {
 console.log(JSON.stringify({ include: (await schedule(value)).map(({ name, browser }) => ({ name, browser })) }));
} else if (mode === '--check') {
 for (const tier of ['push', 'all']) {
  const jobs = await schedule(tier);
  console.log(tier + ': ' + jobs.flatMap(job => job.lanes.flatMap(lane => lane.units)).length + ' commands; ' + jobs.map(job => job.name + '=' + (SETUP_SECONDS + prerequisiteSeconds(job.prerequisites) + Math.max(...job.lanes.map(lane => lane.seconds))) + 's including setup').join(', '));
 }
} else if (mode === '--plan') {
 console.log(JSON.stringify(await schedule(value)));
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
 const { run } = await import('../verify-app.mjs');
 for (const command of job.prerequisites) run(command);
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
