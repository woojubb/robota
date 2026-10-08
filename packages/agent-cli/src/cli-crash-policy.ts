import { areTuiProcessGuardsActive, classifyUncaughtException } from './process-guards.js';

let installed = false;
let diagnosticName = 'CLI';

export function formatCliImeHint(cliName: string): string {
  return (
    `\n[${cliName}] CJK/IME input error — this is a known issue with macOS Terminal.app.\n` +
    '  Workaround: use iTerm2 (https://iterm2.com) or input your prompt in English.\n' +
    '  Alternatively, use headless mode: -p "your prompt here"\n\n'
  );
}

/** One process policy; interactive guards own TUI errors, while headless crashes fail fast. */
export function installCliCrashPolicy(cliName: string): void {
  diagnosticName = cliName;
  if (installed) return;
  installed = true;
  process.on('uncaughtException', (error) => {
    const decision = classifyUncaughtException(error, areTuiProcessGuardsActive());
    if (decision === 'ime-hint') {
      process.stderr.write(formatCliImeHint(diagnosticName));
      return;
    }
    if (decision === 'guard-owned') return;
    throw error;
  });
}
