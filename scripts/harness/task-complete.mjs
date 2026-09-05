#!/usr/bin/env node
/** Complete an already-judged Task/spec pair; never supplies a gate verdict. */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { asList, asScalar, frontmatterObject, parseFrontmatterEntryLine } from './frontmatter.mjs';
import {
  evidenceEntries,
  prepareAdvance,
  runAdvance,
  sectionBody,
  statusUpgradeOf,
  taskPathFromSpec,
} from './gate.mjs';
import {
  checkpointCheckboxItems,
  checkpointCompletionCriteria,
} from './checkpoint-evidence-contract.mjs';
import { rewriteFrontmatterStatus } from './gate-implementation-contract.mjs';
import { classifyTaskLifecycle, isValidTaskCompletionDate } from './task-lifecycle.mjs';

function completedTask(text, date) {
  const lines = rewriteFrontmatterStatus(text, 'done').split('\n');
  const end = lines.indexOf('---', 1);
  const completion = lines.findIndex(
    (line, i) => i > 0 && i < end && parseFrontmatterEntryLine(line)?.key === 'completed',
  );
  if (completion === -1) lines.splice(end, 0, `completed: ${date}`);
  else lines[completion] = `completed: ${date}`;
  return lines.join('\n');
}

function refuse(message) {
  throw new Error(`refused: ${message}`);
}

function safePath(root, relative, { vacant = false } = {}) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.split('/').includes('..'))
    refuse('unsafe path');
  const resolved = path.resolve(root, relative);
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) refuse('path outside repository');
  let cursor = root;
  const parts = rel.split(path.sep);
  for (let index = 0; index < parts.length; index++) {
    cursor = path.join(cursor, parts[index]);
    let stat;
    try {
      stat = lstatSync(cursor);
    } catch (error) {
      if (error.code === 'ENOENT' && vacant) return resolved;
      throw error;
    }
    if (stat.isSymbolicLink()) refuse(`symlink path ${cursor}`);
    if (index < parts.length - 1 && !stat.isDirectory()) refuse(`non-directory ancestor ${cursor}`);
    if (index === parts.length - 1 && (vacant || !stat.isFile()))
      refuse(`occupied or nonregular target ${cursor}`);
  }
  return resolved;
}

function assertNoInitiative(root, taskText, id) {
  if (asList(frontmatterObject(taskText).children).length)
    refuse('initiative completion requires manual projections');
  for (const folder of ['.agents/tasks', '.agents/tasks/completed']) {
    const directory = path.join(root, folder);
    if (!existsSync(directory)) continue;
    if (lstatSync(directory).isSymbolicLink()) refuse('symlink Task directory');
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.name.endsWith('.md')) continue;
      const file = safePath(root, `${folder}/${entry.name}`);
      if (asList(frontmatterObject(readFileSync(file, 'utf8')).children).includes(id))
        refuse('declaring initiative requires manual projections');
    }
  }
}

function assertComplete(text, taskText) {
  const criteria = checkpointCompletionCriteria(text);
  const plan = sectionBody(taskText, /^Plan$/i);
  const items = plan ? checkpointCheckboxItems(plan.body) : [];
  const taskItems = checkpointCheckboxItems(sectionBody(text, /^Tasks$/i)?.body ?? []);
  if (!criteria?.length || criteria.some((item) => !item.checked))
    refuse('unchecked or absent completion criteria');
  if (!items.length || items.some((item) => !item.checked)) refuse('unchecked or absent Task Plan');
  if (taskItems.length !== 1 || !taskItems[0].checked) refuse('exact checked paired Task required');
}

export function runComplete(options) {
  const root = realpathSync(options.root ?? process.cwd());
  const docPath = safePath(root, options.doc);
  const docRel = path.relative(root, docPath).split(path.sep).join('/');
  if (!/^\.agents\/spec-docs\/(todo|active|done)\/[^/]+\.md$/.test(docRel))
    refuse('noncanonical spec path');
  const text = readFileSync(docPath, 'utf8');
  const taskRel = taskPathFromSpec(text);
  if (!taskRel) throw new Error('refused: no paired Task');
  const taskPath = safePath(root, taskRel);
  if (
    !/^\.agents\/tasks\/(completed\/)?[^/]+\.md$/.test(taskRel) ||
    path.basename(taskRel) !== path.basename(docPath)
  )
    refuse('mismatched Task/spec path');
  const taskText = readFileSync(taskPath, 'utf8');
  if (!isValidTaskCompletionDate(options.date)) throw new Error('refused: invalid completion date');
  const lifecycle = classifyTaskLifecycle(taskText);
  if (!lifecycle.valid) refuse('invalid Task lifecycle');
  const id = /^(.+?-\d+)-/.exec(path.basename(taskPath))?.[1];
  if (!id || !asScalar(frontmatterObject(taskText).title).startsWith(`${id}:`))
    refuse('mismatched Task ID');
  const current = taskText
    .split(/^## Evidence(?: Log)?\s*$/m)[0]
    .split('\n')
    .filter((line) => /^Spec:/.test(line));
  if (current.length !== 1 || current[0] !== `Spec: \`${docRel}\``)
    refuse('mismatched current spec pointer');
  const fm = frontmatterObject(text);
  if (!['L1', 'L2'].includes(asScalar(fm.lane))) refuse('unknown lane');
  if (asScalar(fm.type) === 'AGREEMENT')
    refuse('initiative completion requires manual projections');
  assertNoInitiative(root, taskText, id);
  assertComplete(text, taskText);
  const last = evidenceEntries(text)?.at(-1);
  const expectedGate = asScalar(fm.lane) === 'L1' ? 'GATE-DONE' : 'GATE-COMPLETE';
  const originalStatus = asScalar(fm.lane) === 'L1' ? 'approved' : 'verifying';
  const upgrade = last ? statusUpgradeOf(last) : null;
  if (
    last?.verdict !== '✅ PASS' ||
    last.gate !== expectedGate ||
    !last.lines.some((line) => /^- [A-Z][A-Z-]* — .+: .+/.test(line)) ||
    upgrade?.from !== originalStatus ||
    upgrade?.to !== 'done'
  )
    refuse('terminal completion PASS required');
  if (
    lifecycle.status === 'done' &&
    asScalar(fm.status) === 'done' &&
    taskRel.startsWith('.agents/tasks/completed/') &&
    docRel.startsWith('.agents/spec-docs/done/')
  ) {
    return { exit: 0, alreadyDone: true, spec: docPath, task: taskPath };
  }
  if (lifecycle.state !== 'open' || taskRel.startsWith('.agents/tasks/completed/'))
    refuse('inconsistent partial completion; use manual recovery');
  safePath(root, '.agents/rules/spec-workflow.md');
  const prepared = prepareAdvance({ ...options, root });
  if (prepared.upgrade.to !== 'done') throw new Error('refused: terminal completion PASS required');
  const taskTarget = path.join(root, '.agents/tasks/completed', path.basename(taskPath));
  safePath(root, path.relative(root, prepared.target), { vacant: true });
  safePath(root, path.relative(root, taskTarget), { vacant: true });
  const newTaskRel = path.relative(root, taskTarget).split(path.sep).join('/');
  let phase = 'spec advancement';
  try {
    const result = runAdvance({ ...options, root });
    phase = 'Task completion';
    const updatedTask = completedTask(readFileSync(taskPath, 'utf8'), options.date);
    writeFileSync(taskPath, updatedTask);
    mkdirSync(path.dirname(taskTarget), { recursive: true });
    renameSync(taskPath, taskTarget);
    phase = 'current spec Task pointer';
    const finalSpec = readFileSync(result.path, 'utf8').replace(
      /(^## Tasks\s*\n)([\s\S]*?)(?=^## |$(?![\s\S]))/m,
      (all, heading, body) => heading + body.split(taskRel).join(newTaskRel),
    );
    writeFileSync(result.path, finalSpec);
    const checked = runComplete({ root, doc: result.path, date: options.date });
    if (!checked.alreadyDone) throw new Error('final completion postcondition failed');
    return { exit: 0, alreadyDone: false, spec: result.path, task: taskTarget };
  } catch (error) {
    throw new Error(
      `completion failed during ${phase}; inspect ${docPath} and ${taskTarget}; partial state may remain: ${error.message}`,
      { cause: error },
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      if (!['--doc', '--date', '--root'].includes(args[index]) || !args[index + 1])
        throw new Error('usage: task-complete.mjs --doc <spec> --date YYYY-MM-DD [--root <root>]');
      options[args[index].slice(2)] = args[index + 1];
    }
    process.stdout.write(`${JSON.stringify(runComplete(options))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
