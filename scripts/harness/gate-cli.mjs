#!/usr/bin/env node

import path from 'node:path';

import {
  EXIT_PASS,
  EXIT_PENDING,
  parseArgs,
  runAdvance,
  runApprove,
  runJudge,
  runRecord,
} from './gate-operations.mjs';

const USAGE = [
  'usage:',
  '  gate.mjs judge   --gate <GATE> --doc <spec> [--continuation|--correction] [--lane L1|L2] [--catalogue <p>] [--backlog-rule <p>] [--root <p>] [--date YYYY-MM-DD] [--verify-cmd "<cmd>"]... [--dry-run]',
  '  gate.mjs record  --doc <spec> --tc TC-NN (--command "<cmd>" --exit <n> --output-file <p> | --skip "<reason>") [--date YYYY-MM-DD]',
  '  gate.mjs advance --doc <spec> [--rule <p>] [--root <p>]',
  '  gate.mjs approve --doc <spec> --route DIRECT|CLASS --instruction "<verbatim>" [--class <ID>] [--given YYYY-MM-DD] [--date YYYY-MM-DD] [--backlog-rule <p>] [--catalogue <p>] [--root <p>]',
  '                   route CLASS only: [--evidence "<the measurement>"] [--conversation "<where the instruction was given>"] — DIRECT refuses both rather than dropping them',
  "dates default to the LOCAL calendar date; the document's `lane:` is authoritative (--lane may only equal it); L1 order: approve (does not change status) → judge --gate PLAN (does not change status) → advance (performs the status transition) → one planning commit; a stacked branch sets HARNESS_BASE_REF=<parent branch> for the measured diff",
].join('\n');

export function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(`❌ ${error.message}\n${USAGE}`);
    return 1;
  }
  const { subcommand, options } = parsed;
  try {
    switch (subcommand) {
      case 'judge': {
        const result = runJudge(options);
        for (const line of result.lines) console.log(line);
        console.log(result.summary);
        if (result.entry)
          console.log(
            result.written
              ? `Evidence Log entry appended (${result.entry[0]})`
              : `dry run — entry not written:\n${result.entry.join('\n')}`,
          );
        else if (result.exit === EXIT_PENDING && result.approvePending > 0)
          console.log(
            `no entry written: ${result.approvePending} GATE-APPROVAL criteria are PENDING — run \`gate.mjs approve\` first, then judge again`,
          );
        else if (result.exit === EXIT_PENDING)
          console.log("no entry written: pending criteria are the guardian's to judge and record");
        return result.exit;
      }
      case 'record': {
        const result = runRecord(options);
        console.log(`recorded ${result.lines[0]}`);
        return result.exit;
      }
      case 'advance': {
        const result = runAdvance(options);
        console.log(
          `advanced ${result.from} → ${result.to}: ${result.path}${result.moved ? '' : ' (folder unchanged)'}${result.notes.length ? ` — ${result.notes.join('; ')}` : ''}`,
        );
        return result.exit;
      }
      case 'approve': {
        const result = runApprove(options);
        console.log(`wrote ${result.lines[0]}`);
        if (result.problem) console.error(`❌ ${result.problem}`);
        else
          console.log(
            `standing-delegation-evidence: route ${result.route} accepted; ${result.summary}`,
          );
        return result.exit;
      }
      default:
        console.error(`❌ unknown subcommand ${subcommand ?? '(none)'}\n${USAGE}`);
        return 1;
    }
  } catch (error) {
    console.error(`❌ ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exitCode = main();
}
