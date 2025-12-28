import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';

type TStrategy = 'hash' | 'sequential';

function printUsage(): void {
    process.stderr.write(
        [
            'Usage:',
            '  pnpm scenario:verify -- <example-file> <scenario-id> [--strategy=hash|sequential]',
            '',
            'Examples:',
            '  pnpm scenario:verify -- guarded-edge-verification.ts mandatory-delegation --strategy=hash',
            '  pnpm scenario:verify -- continued-conversation-edge-verification.ts continued-conversation --strategy=sequential',
            ''
        ].join('\n')
    );
    process.stderr.write('\n');
}

function parseArgs(): { exampleFile: string; scenarioId: string; strategy: TStrategy } {
    const [, , rawExampleFile, rawScenarioId, ...rest] = process.argv;

    // pnpm convention: `pnpm <script> -- <args...>` passes a literal "--" through.
    const [exampleFile, scenarioId] =
        rawExampleFile === '--' ? [rawScenarioId, rest.shift()] : [rawExampleFile, rawScenarioId];

    if (!exampleFile || !scenarioId) {
        printUsage();
        process.exit(1);
    }

    let strategy: TStrategy = 'sequential';
    for (const arg of rest) {
        if (arg.startsWith('--strategy=')) {
            const value = arg.slice('--strategy='.length);
            if (value !== 'hash' && value !== 'sequential') {
                process.stderr.write(`Invalid strategy "${value}". Use "hash" or "sequential".\n`);
                process.exit(1);
            }
            strategy = value;
        }
    }

    return { exampleFile, scenarioId, strategy };
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

function runTsyxWithEnv(
    cwd: string,
    args: string[],
    env: NodeJS.ProcessEnv
): { status: number; output: string } {
    const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const result = spawnSync(pnpmCmd, ['tsx', ...args], {
        cwd,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });

    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    const output = `${stdout}${stderr ? `\n${stderr}` : ''}`;

    return { status: result.status ?? 1, output };
}

function main(): void {
    const { exampleFile, scenarioId, strategy } = parseArgs();

    const examplesDir = process.cwd();
    const examplePath = path.resolve(examplesDir, exampleFile);
    if (!fs.existsSync(examplePath)) {
        process.stderr.write(`Example file not found: ${examplePath}\n`);
        process.exit(1);
    }

    const hash = md5OfFile(examplePath);
    const cacheDir = path.resolve(examplesDir, 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const logPath = path.join(cacheDir, `scenario-verify-${path.basename(exampleFile)}-${hash}-${scenarioId}.log`);

    const env: NodeJS.ProcessEnv = {
        ...process.env,
        SCENARIO_PLAY_ID: scenarioId,
        SCENARIO_PLAY_STRATEGY: strategy
    };
    delete env.SCENARIO_RECORD_ID;

    const exampleRun = runTsyxWithEnv(examplesDir, [examplePath], env);
    fs.writeFileSync(logPath, exampleRun.output, 'utf8');

    process.stdout.write(`▶️ Example run log: ${logPath}\n`);
    process.stdout.write(tailLines(exampleRun.output, 160));
    process.stdout.write('\n');

    const strictViolation = /\[STRICT-POLICY\]|\[EDGE-ORDER-VIOLATION\]/.test(exampleRun.output);
    if (exampleRun.status !== 0 || strictViolation) {
        process.stderr.write('❌ Aborting verification (example failed or strict-policy violation).\n');
        process.exit(exampleRun.status || 1);
    }

    const verifyRun = runTsyxWithEnv(examplesDir, ['utils/verify-workflow-connections.ts'], env);
    process.stdout.write('▶️ Verify...\n');
    process.stdout.write(verifyRun.output);
    process.stdout.write('\n');

    const verifyFailed = /Workflow validation failed!/i.test(verifyRun.output);
    if (verifyRun.status !== 0 || verifyFailed) {
        process.stderr.write('❌ Verification failed.\n');
        process.exit(verifyRun.status || 1);
    }
}

main();


