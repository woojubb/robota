import { spawnSync } from 'child_process';
import path from 'path';

function printUsage(): void {
    console.log('Usage: pnpm scenario <record|play> <example-file> <scenario-id> [--strategy=hash|sequential]');
    console.log('Example: pnpm scenario play 26-guarded-edge-verification.ts mandatory-delegation --strategy=sequential');
}

interface ParsedArgs {
    mode: 'record' | 'play';
    exampleFile: string;
    scenarioId: string;
    strategy?: 'hash' | 'sequential';
}

function parseArgs(): ParsedArgs {
    const [, , modeArg, exampleFile, scenarioId, ...rest] = process.argv;

    if (!modeArg || !exampleFile || !scenarioId) {
        printUsage();
        process.exit(1);
    }

    if (modeArg !== 'record' && modeArg !== 'play') {
        console.error(`Unknown mode "${modeArg}". Use "record" or "play".`);
        process.exit(1);
    }

    const parsed: ParsedArgs = {
        mode: modeArg,
        exampleFile,
        scenarioId
    };

    for (const arg of rest) {
        if (arg.startsWith('--strategy=')) {
            const strategy = arg.split('=')[1] as 'hash' | 'sequential';
            if (strategy !== 'hash' && strategy !== 'sequential') {
                console.error(`Invalid strategy "${strategy}". Use "hash" or "sequential".`);
                process.exit(1);
            }
            parsed.strategy = strategy;
        }
    }

    return parsed;
}

function runScenario() {
    const args = parseArgs();
    const examplePath = path.resolve(process.cwd(), args.exampleFile);

    const env = { ...process.env };
    if (args.mode === 'record') {
        env.SCENARIO_RECORD_ID = args.scenarioId;
        delete env.SCENARIO_PLAY_ID;
    } else {
        env.SCENARIO_PLAY_ID = args.scenarioId;
        if (args.strategy) {
            env.SCENARIO_PLAY_STRATEGY = args.strategy;
        }
        delete env.SCENARIO_RECORD_ID;
    }

    const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const result = spawnSync(pnpmCmd, ['tsx', examplePath], {
        stdio: 'inherit',
        env
    });

    process.exit(result.status ?? 1);
}

runScenario();

