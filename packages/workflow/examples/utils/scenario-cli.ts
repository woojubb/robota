import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';

type TScenarioMode = 'record' | 'play';
type TScenarioCommand = TScenarioMode | 'verify';
type TStrategy = 'hash' | 'sequential';

interface IScenarioArgs {
    command: TScenarioCommand;
    exampleFile: string;
    scenarioId: string;
    strategy?: TStrategy;
}

function printUsage(): void {
    process.stderr.write(
        [
            'Usage:',
            '  pnpm scenario -- <record|play|verify> <example-file> <scenario-id> [--strategy=hash|sequential]',
            '  (default strategy: hash)',
            '',
            'Examples:',
            '  pnpm scenario -- record guarded-edge-verification.ts mandatory-delegation',
            '  pnpm scenario -- play guarded-edge-verification.ts mandatory-delegation --strategy=hash',
            '  pnpm scenario -- verify guarded-edge-verification.ts mandatory-delegation --strategy=hash',
            ''
        ].join('\n')
    );
    process.stderr.write('\n');
}

function parseArgs(): IScenarioArgs {
    const [, , rawCommand, rawExampleFile, rawScenarioId, ...rest] = process.argv;
    const [commandToken, exampleFile, scenarioId] =
        rawCommand === '--'
            ? [rawExampleFile, rawScenarioId, rest.shift()]
            : [rawCommand, rawExampleFile, rawScenarioId];

    if (!commandToken || !exampleFile || !scenarioId) {
        printUsage();
        process.exit(1);
    }

    if (commandToken !== 'record' && commandToken !== 'play' && commandToken !== 'verify') {
        process.stderr.write(`Unknown command "${commandToken}". Use "record", "play", or "verify".\n`);
        process.exit(1);
    }

    const parsed: IScenarioArgs = {
        command: commandToken,
        exampleFile,
        scenarioId
    };

    for (const arg of rest) {
        if (!arg.startsWith('--strategy=')) {
            process.stderr.write(`Unknown option "${arg}".\n`);
            process.exit(1);
        }
        const value = arg.slice('--strategy='.length);
        if (value !== 'hash' && value !== 'sequential') {
            process.stderr.write(`Invalid strategy "${value}". Use "hash" or "sequential".\n`);
            process.exit(1);
        }
        parsed.strategy = value;
    }

    return parsed;
}

function createScenarioEnv(mode: TScenarioMode, scenarioId: string, strategy?: TStrategy): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (mode === 'record') {
        env.SCENARIO_RECORD_ID = scenarioId;
        delete env.SCENARIO_PLAY_ID;
        delete env.SCENARIO_PLAY_STRATEGY;
        return env;
    }

    env.SCENARIO_PLAY_ID = scenarioId;
    env.SCENARIO_PLAY_STRATEGY = strategy ?? 'hash';
    delete env.SCENARIO_RECORD_ID;
    return env;
}

function md5OfFile(filePath: string): string {
    const buf = fs.readFileSync(filePath);
    return createHash('md5').update(buf).digest('hex');
}

function tailLines(text: string, maxLines: number): string {
    const lines = text.split('\n');
    const start = Math.max(0, lines.length - maxLines);
    return lines.slice(start).join('\n');
}

function runTsxWithEnv(
    cwd: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    options?: { inheritIO?: boolean }
): { status: number; output: string } {
    const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const result = spawnSync(pnpmCmd, ['tsx', ...args], {
        cwd,
        env,
        encoding: 'utf8',
        stdio: options?.inheritIO ? 'inherit' : ['ignore', 'pipe', 'pipe']
    });

    if (options?.inheritIO) {
        return { status: result.status ?? 1, output: '' };
    }

    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    const output = `${stdout}${stderr ? `\n${stderr}` : ''}`;
    return { status: result.status ?? 1, output };
}

function assertExampleFile(examplesDir: string, exampleFile: string): string {
    const examplePath = path.resolve(examplesDir, exampleFile);
    if (!fs.existsSync(examplePath)) {
        throw new Error(`Example file not found: ${examplePath}`);
    }
    return examplePath;
}

function resetScenarioRecordFile(examplesDir: string, scenarioId: string): void {
    const scenarioDir = path.resolve(examplesDir, 'scenarios');
    const scenarioPath = path.resolve(scenarioDir, `${scenarioId}.json`);
    fs.mkdirSync(scenarioDir, { recursive: true });
    if (!fs.existsSync(scenarioPath)) {
        return;
    }
    fs.unlinkSync(scenarioPath);
}

function runRecordOrPlay(args: IScenarioArgs, examplesDir: string): never {
    const mode: TScenarioMode = args.command;
    const examplePath = assertExampleFile(examplesDir, args.exampleFile);
    if (mode === 'record') {
        resetScenarioRecordFile(examplesDir, args.scenarioId);
    }
    const env = createScenarioEnv(mode, args.scenarioId, args.strategy);
    const run = runTsxWithEnv(examplesDir, [examplePath], env, { inheritIO: true });
    process.exit(run.status);
}

function runVerify(args: IScenarioArgs, examplesDir: string): never {
    const examplePath = assertExampleFile(examplesDir, args.exampleFile);
    const strategy = args.strategy ?? 'hash';
    const env = createScenarioEnv('play', args.scenarioId, strategy);

    const hash = md5OfFile(examplePath);
    const cacheDir = path.resolve(examplesDir, 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const logPath = path.join(
        cacheDir,
        `scenario-verify-${path.basename(args.exampleFile)}-${hash}-${args.scenarioId}.log`
    );

    const exampleRun = runTsxWithEnv(examplesDir, [examplePath], env);
    fs.writeFileSync(logPath, exampleRun.output, 'utf8');

    process.stdout.write(`▶️ Example run log: ${logPath}\n`);
    process.stdout.write(tailLines(exampleRun.output, 160));
    process.stdout.write('\n');

    const strictViolation = /\[STRICT-POLICY\]|\[EDGE-ORDER-VIOLATION\]/.test(exampleRun.output);
    if (exampleRun.status !== 0 || strictViolation) {
        process.stderr.write('❌ Aborting verification (example failed or strict-policy violation).\n');
        process.exit(exampleRun.status || 1);
    }

    const verifyRun = runTsxWithEnv(examplesDir, ['utils/verify-workflow-connections.ts'], env);
    process.stdout.write('▶️ Verify...\n');
    process.stdout.write(verifyRun.output);
    process.stdout.write('\n');

    const verifyFailed = /Workflow validation failed!/i.test(verifyRun.output);
    if (verifyRun.status !== 0 || verifyFailed) {
        process.stderr.write('❌ Verification failed.\n');
        process.exit(verifyRun.status || 1);
    }

    process.exit(0);
}

function main(): void {
    const args = parseArgs();
    const examplesDir = process.cwd();

    try {
        if (args.command === 'verify') {
            runVerify(args, examplesDir);
        }
        runRecordOrPlay(args, examplesDir);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exit(1);
    }
}

main();
