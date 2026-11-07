import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, it, vi } from 'vitest';

import { listSupervisedSessions, stopSupervisedSession } from '../supervised-session-control.js';

const ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';

// A process that exits remains a zombie until its parent reaps it. Perl's explicit waitpid lets
// this exercise the actual Linux state even under a container whose PID 1 normally reaps orphans.
it.runIf(process.platform === 'linux' && existsSync('/usr/bin/perl'))(
  'confirms a stopped registered process even when its parent has not yet reaped it',
  async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'supervised-zombie-'));
    const root = join(scratch, 'supervised');
    const moduleUrl = new URL('../supervised-session-control.ts', import.meta.url).href;
    const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
    const worker = `import { startSupervisedControl } from ${JSON.stringify(moduleUrl)};
      const control = await startSupervisedControl({
        id: process.env.ZOMBIE_TEST_ID, root: process.env.ZOMBIE_TEST_ROOT,
        onStop: () => { void control.close().then(() => {
          process.stdout.write('CLOSED\\n');
          process.stdin.once('data', () => process.exit(0));
        }); },
      });
      process.stdout.write('READY\\n');`;
    const parent = spawn('/usr/bin/perl', [
      '-e',
      '$|=1; my $pid=fork(); die "fork" unless defined $pid; if (!$pid) { exec @ARGV or die "exec"; } print "PID:$pid\\n"; $SIG{TERM}=sub { kill 9,$pid; waitpid($pid,0); exit 0; }; while (1) { sleep 1; }',
      process.execPath, '--import', loader, '--conditions=product-source', '--input-type=module', '-e', worker,
    ], {
      env: { PATH: process.env.PATH, HOME: scratch, ZOMBIE_TEST_ROOT: root, ZOMBIE_TEST_ID: ID },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    parent.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    parent.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    const exited = once(parent, 'exit');
    try {
      await vi.waitFor(() => {
        expect(stdout, stderr).toContain('READY');
        expect(stdout).toMatch(/PID:\d+/u);
      }, { timeout: 15_000 });
      const pid = Number(/PID:(\d+)/u.exec(stdout)?.[1]);
      expect(await listSupervisedSessions(root)).toEqual([
        expect.objectContaining({ id: ID, liveness: 'alive', control: 'available' }),
      ]);
      const stopping = stopSupervisedSession(ID, root);
      let settled = false;
      void stopping.then(() => { settled = true; }, () => { settled = true; });
      await vi.waitFor(() => expect(stdout).toContain('CLOSED'), { timeout: 15_000 });
      // Removing a registration is not enough: the registered process is still alive here.
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(settled).toBe(false);
      parent.stdin.write('exit\n');
      await stopping;
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      expect(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]).toBe('Z');
      expect(await listSupervisedSessions(root)).toEqual([]);
    } finally {
      parent.kill('SIGTERM');
      await exited;
      rmSync(scratch, { recursive: true, force: true });
    }
  },
  30_000,
);
