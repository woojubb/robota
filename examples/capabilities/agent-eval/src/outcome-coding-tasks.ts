/**
 * Five small synthetic repository tasks with a broken start state, a solved control and an
 * independent verifier program that the model never sees. The contents are frozen: a test
 * digests a canonical serialization of this module's data and compares it with a constant.
 */

/** A task as data: files, prompt and verifier, with no behavior. */
export interface ICodingTaskDefinition {
  readonly id: string;
  /** The only text the model receives. */
  readonly prompt: string;
  /** Initial file tree: relative path to exact content. */
  readonly files: Readonly<Record<string, string>>;
  /** Overlay applied on top of `files` to build the solved control. */
  readonly solved: Readonly<Record<string, string>>;
  /** Paths the agent may write; every other initial file is protected. */
  readonly allowed: readonly string[];
  /** Node ES module source that exits 0 only when the task is solved; reads the tree at /work. */
  readonly verifier: string;
}

export interface ICodingTask extends ICodingTaskDefinition {
  /** Initial files outside `allowed`; the agent must leave them byte-identical. */
  readonly protectedFiles: readonly string[];
}

const DEFINITIONS: readonly ICodingTaskDefinition[] = [
  {
    id: 'navigation',
    prompt:
      'Find the module that implements normalizeSku (not a re-export). Inspect the source and write answer.json with exactly {"file":"<relative implementation path>","export":"normalizeSku"}. Do not change existing project files.',
    files: {
      'src/main.mjs': "export { normalizeSku } from './catalog.mjs';\n",
      'src/catalog.mjs':
        "export function normalizeSku(value) { return String(value).trim().toUpperCase().replace(/\\s+/g, '-'); }\n",
      'src/display.mjs': 'export const label = (value) => `SKU: ${value}`;\n',
    },
    solved: {
      'answer.json': '{"file":"src/catalog.mjs","export":"normalizeSku"}\n',
    },
    allowed: ['answer.json'],
    verifier:
      "import fs from 'node:fs'; import assert from 'node:assert/strict'; assert.deepEqual(JSON.parse(fs.readFileSync('/work/answer.json')), {file:'src/catalog.mjs',export:'normalizeSku'});",
  },
  {
    id: 'bug-repair',
    prompt:
      'Fix src/cart.mjs: totalCents(items, discountPercent) must sum priceCents*quantity, apply discountPercent as a percentage of that sum, and round once to an integer. Empty carts return 0. Do not modify tests.',
    files: {
      'src/cart.mjs':
        'export function totalCents(items, discountPercent = 0) { return Math.round(items.reduce((s, i) => s + i.priceCents * i.quantity, 0) - discountPercent * 100); }\n',
    },
    solved: {
      'src/cart.mjs':
        'export function totalCents(items, discountPercent = 0) { return Math.round(items.reduce((s, i) => s + i.priceCents * i.quantity, 0) * (1 - discountPercent / 100)); }\n',
    },
    allowed: ['src/cart.mjs'],
    verifier:
      "import assert from 'node:assert/strict'; import {totalCents as f} from '/work/src/cart.mjs'; assert.equal(f([{priceCents:1000,quantity:2},{priceCents:500,quantity:1}],10),2250); assert.equal(f([],25),0); assert.equal(f([{priceCents:333,quantity:1}],15),283); assert.equal(f([{priceCents:25,quantity:4}]),100);",
  },
  {
    id: 'feature',
    prompt:
      'Implement slugify(value) in src/labels.mjs. Convert value to a string, lowercase it, replace each run of non-ASCII-alphanumeric characters with one hyphen, and remove leading/trailing hyphens. Whitespace-only strings return an empty string. Keep the existing exported name.',
    files: {
      'src/labels.mjs': "export function slugify(value) { throw new Error('Not implemented'); }\n",
    },
    solved: {
      'src/labels.mjs':
        "export function slugify(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }\n",
    },
    allowed: ['src/labels.mjs'],
    verifier:
      "import assert from 'node:assert/strict'; import {slugify as f} from '/work/src/labels.mjs'; for (const [x,y] of [[' Hello, WORLD! ','hello-world'],['a___b---c','a-b-c'],['  ',''],['v2.1','v2-1'],[123,'123']]) assert.equal(f(x),y);",
  },
  {
    id: 'multi-file',
    prompt:
      'Update both src/units.mjs and src/invoice.mjs. Add exported formatMoney(cents) in units returning a dollar string with exactly two decimals, such as "$12.50". Change invoiceTotal(items) to return an integer number of cents: convert each item.price in dollars using shared toCents and multiply by item.quantity (default 1). Keep existing exports and reuse toCents from units.',
    files: {
      'src/units.mjs': 'export function toCents(amount) { return Math.round(amount * 100); }\n',
      'src/invoice.mjs':
        'export function invoiceTotal(items) { return items.reduce((s, item) => s + item.price, 0); }\n',
    },
    solved: {
      'src/units.mjs':
        "export function toCents(amount) { return Math.round(amount * 100); }\nexport function formatMoney(cents) { return '$' + (cents / 100).toFixed(2); }\n",
      'src/invoice.mjs':
        "import {toCents} from './units.mjs';\nexport function invoiceTotal(items) { return items.reduce((s, item) => s + toCents(item.price) * (item.quantity ?? 1), 0); }\n",
    },
    allowed: ['src/units.mjs', 'src/invoice.mjs'],
    verifier:
      "import assert from 'node:assert/strict'; import fs from 'node:fs'; import {toCents,formatMoney} from '/work/src/units.mjs'; import {invoiceTotal as f} from '/work/src/invoice.mjs'; assert.equal(toCents(1.23),123); assert.equal(formatMoney(1250),'$12.50'); assert.equal(formatMoney(0),'$0.00'); assert.equal(f([{price:1.25,quantity:3},{price:2.5}]),625); assert.equal(f([]),0); assert.match(fs.readFileSync('/work/src/invoice.mjs','utf8'), /import[\\s\\S]*toCents/);",
  },
  {
    id: 'test-diagnosis',
    prompt:
      'The existing tests/range.test.mjs fails for the upper endpoint. Diagnose from the source and tests, then repair src/range.mjs. range(start,end) must include both integer endpoints, return [] when start>end, and handle equal/negative endpoints. Do not modify the test file.',
    files: {
      'src/range.mjs':
        'export function range(start,end) { const out=[]; for(let i=start;i<end;i++) out.push(i); return out; }\n',
      'tests/range.test.mjs':
        "import assert from 'node:assert/strict'; import {range} from '../src/range.mjs'; assert.deepEqual(range(2,4),[2,3,4]);\n",
    },
    solved: {
      'src/range.mjs':
        'export function range(start,end) { const out=[]; for(let i=start;i<=end;i++) out.push(i); return out; }\n',
    },
    allowed: ['src/range.mjs'],
    verifier:
      "import assert from 'node:assert/strict'; import {range as f} from '/work/src/range.mjs'; assert.deepEqual(f(2,4),[2,3,4]); assert.deepEqual(f(5,5),[5]); assert.deepEqual(f(4,2),[]); assert.deepEqual(f(-2,1),[-2,-1,0,1]);",
  },
];

export const CODING_TASKS: readonly ICodingTask[] = DEFINITIONS.map((definition) => ({
  ...definition,
  protectedFiles: Object.keys(definition.files).filter(
    (path) => !definition.allowed.includes(path),
  ),
}));

/** The tree a trial starts from (`broken`) or the exact solved control. */
export function taskFiles(
  task: ICodingTaskDefinition,
  kind: 'broken' | 'solved',
): Readonly<Record<string, string>> {
  return kind === 'broken' ? task.files : { ...task.files, ...task.solved };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** Canonical serialization the digest covers: tasks in order, object keys sorted, compact JSON. */
export function serializeCodingTasks(tasks: readonly ICodingTask[] = CODING_TASKS): string {
  return JSON.stringify(canonicalize(tasks));
}
