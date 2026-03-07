import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createScenarioRecordPayload, executeCommandCapture } from './scenario-records.mjs';

async function main() {
  const argv = process.argv.slice(2);
  const separatorIndex = argv.indexOf('--');

  if (separatorIndex === -1) {
    throw new Error('Use -- to separate record script options from the command to run.');
  }

  const optionTokens = argv.slice(0, separatorIndex);
  const commandTokens = argv.slice(separatorIndex + 1);

  if (commandTokens.length === 0) {
    throw new Error('A command is required after --.');
  }

  let outputPath = null;
  let scope = null;
  for (let index = 0; index < optionTokens.length; index += 1) {
    const token = optionTokens[index];
    switch (token) {
      case '--output': {
        const value = optionTokens[index + 1];
        if (!value) {
          throw new Error('--output requires a value.');
        }
        outputPath = value;
        index += 1;
        break;
      }
      case '--scope': {
        const value = optionTokens[index + 1];
        if (!value) {
          throw new Error('--scope requires a value.');
        }
        scope = value;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!outputPath) {
    throw new Error('--output is required.');
  }
  if (!scope) {
    throw new Error('--scope is required.');
  }

  const [command, ...args] = commandTokens;
  const result = executeCommandCapture(command, args, process.cwd(), {}, false);

  if (result.status !== 0) {
    throw new Error(`Scenario record command failed: ${commandTokens.join(' ')}`);
  }

  const absoluteOutputPath = path.resolve(process.cwd(), outputPath);
  await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });

  const content = createScenarioRecordPayload({
    scope,
    packageName: process.env.npm_package_name ?? null,
    command,
    args,
    cwd: process.cwd(),
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });

  await fs.writeFile(absoluteOutputPath, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
  process.stdout.write(`record written: ${path.relative(process.cwd(), absoluteOutputPath)}\n`);
}

void main();
