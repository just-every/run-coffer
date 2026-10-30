// CI-only scheduling: verification.json remains the authority for commands,
// browser opt-ins, test selections and the one hosted verification invocation.
import { readFileSync, readdirSync, mkdirSync, openSync, closeSync, realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { verificationPlan } from '../verify-app.mjs';

const MIN_JOBS = 8;
const MAX_JOBS = 14;
const WORKERS = 3;
const JOB_TARGET = 15 * 60;
const SETUP_SECONDS = 120;
const LANE_TARGET = JOB_TARGET - SETUP_SECONDS;
// Successful END lines from Verify 40911159077 and 40920377253, including
// browser opt-ins; retain the larger observation for each registration. The
// computed move-in group retains its larger fixed-complement local sample.
// Pad observations by 10%; reserve two minutes for runner setup.
const weight = seconds => Math.ceil(seconds * 1.1);
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
 if (!/\bnode --test\b/.test(command)) return [{ command, label: shard.name, seconds: weight(estimates[command] ?? 100) }];
 const patterns = [...command.matchAll(/\btests\/[\w.*-]+\.mjs\b/g)].map(match => match[0]);
 if (!patterns.length) return [{ command, label: shard.name, seconds: 100 }];
 const files = [...new Set(patterns.flatMap(pattern => {
  const patternRegex = new RegExp('^' + pattern.split('*').map(escape).join('.*') + '$');
  return readdirSync('tests').map(name => 'tests/' + name).filter(name => patternRegex.test(name));
 }))];
 if (!files.length) throw Error(`No test files for ${command}`);
 const names = new Set();
 const timeouts = new Map();
 for (const file of files) {
  // Recognize only direct, literal registrations. The complement below always
  // runs too: loops, computed names, suites and future registration forms cannot
  // silently disappear when the scheduler does not recognize them.
  const source = readFileSync(file, 'utf8');
  const literals = /(?:^|\n)[ \t]*test\(\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\s*,/g;
  for (const match of source.matchAll(literals)) {
   const body = match[1].slice(1, -1);
   if (/\\[^'"\\]/.test(body)) continue;
   const name = body.replace(/\\(['"\\])/g, '$1');
   names.add(name);
   const timeout = /^\s*\{\s*timeout\s*:\s*(\d+)\s*\}/.exec(source.slice(match.index + match[0].length));
   if (timeout) timeouts.set(name, Number(timeout[1]) / 1000);
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
 const units = [...names].filter(selected).map(name => {
  const seconds = weight(estimates[name] ?? 90);
  // Verify 40920377253 timed out CAMP-004 at its existing 300s deadline
  // while two other lanes were active; CAMP-002 took 273s against the same
  // deadline. Give registrations near a declared timeout the whole runner,
  // without changing the test timeout, command or browser opt-ins.
  const exclusive = timeouts.has(name) && seconds >= timeouts.get(name) * 0.75;
  return {
   command: filtered('^' + escape(name) + '(?:$| > )'),
   label: shard.name + ': ' + name,
   seconds: exclusive ? Math.max(seconds, Math.ceil(timeouts.get(name))) : seconds,
   exclusive,
  };
 });
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

export async function schedule(tier) {
 if (!['push', 'all'].includes(tier)) throw Error('Expected push or all');
 const plan = await verificationPlan();
 const shards = tier === 'all' ? [...plan.push, ...plan.nightly] : plan.push;
 const units = shards.flatMap(shard => shard.hosted
  ? [{ command: 'node scripts/verify-ci.mjs ' + quote(shard.name), label: shard.name + ': hosted checks', seconds: weight(estimates['hosted checks'] ?? 100) }]
  : shard.commands.flatMap(command => split(command, shard)));
 // Serial jobs give timeout-sensitive registrations a runner without competing
 // lanes. Their estimates reserve at least the full existing test deadline.
 // Other jobs retain three lanes and isolate their longest registrations.
 units.sort((a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label));
 const serial = [];
 for (const unit of units.filter(unit => unit.exclusive)) {
  if (unit.seconds > LANE_TARGET) throw Error(`Registration exceeds CI target: ${unit.label}`);
  let lane = serial.find(lane => lane.seconds + unit.seconds <= LANE_TARGET);
  if (!lane) { lane = { seconds: 0, units: [] }; serial.push(lane); }
  lane.units.push(unit);
  lane.seconds += unit.seconds;
 }
 const concurrent = units.filter(unit => !unit.exclusive);
 for (let count = MIN_JOBS; count <= MAX_JOBS; count++) {
  const parallelJobs = count - serial.length;
  if (parallelJobs <= 0) continue;
  const lanes = Array.from({ length: parallelJobs * WORKERS }, (_, index) => ({ index, seconds: 0, units: [], isolated: false }));
  for (const unit of concurrent) {
   const isolate = unit.seconds >= LANE_TARGET * 0.75;
   const lane = lanes.filter(lane => !lane.isolated && (!isolate || !lane.units.length))
    .sort((a, b) => a.seconds - b.seconds || a.index - b.index)[0];
   if (!lane) break;
   lane.units.push(unit);
   lane.seconds += unit.seconds;
   lane.isolated = isolate;
  }
  if (lanes.reduce((total, lane) => total + lane.units.length, 0) !== concurrent.length
   || lanes.some(lane => lane.seconds > LANE_TARGET)) continue;
  return [...Array.from({ length: parallelJobs }, (_, index) => ({
   name: 'balanced-' + (index + 1), browser: true,
   lanes: lanes.filter(lane => lane.index % parallelJobs === index),
  })), ...serial.map((lane, index) => ({
   name: 'balanced-' + (parallelJobs + index + 1), browser: true, lanes: [lane],
  }))];
 }
 throw Error(`Verification cannot fit ${MAX_JOBS} shards within ${JOB_TARGET}s including setup; split the longest registration group`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename)) {
const [mode, value = 'push'] = process.argv.slice(2);
if (mode === '--matrix') {
 console.log(JSON.stringify({ include: (await schedule(value)).map(({ name, browser }) => ({ name, browser })) }));
} else if (mode === '--check') {
 for (const tier of ['push', 'all']) {
  const jobs = await schedule(tier);
  console.log(tier + ': ' + jobs.flatMap(job => job.lanes.flatMap(lane => lane.units)).length + ' commands; ' + jobs.map(job => job.name + '=' + (SETUP_SECONDS + Math.max(...job.lanes.map(lane => lane.seconds))) + 's including setup').join(', '));
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
