/**
 * A consumer of the PUBLISHED `@robota-sdk/workflows` 0.0.3 dist, in plain Node, over the framework's
 * built `dist`: the authority is minted through `@robota-sdk/agent-framework/node`, as the CLI mints
 * it, and the workflows package — which imports only the framework's main entry — must accept it.
 *
 * Argv: `esm | cjs` (which build of both packages to load), the project root, the trust store path.
 * Prints one JSON line with what the workflows package could do with the authority.
 */
import { createRequire } from 'node:module';

const [format, root, storePath] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const load = (specifier) => (format === 'cjs' ? require(specifier) : import(specifier));

const frameworkMain = await load('@robota-sdk/agent-framework');
const frameworkNode = await load('@robota-sdk/agent-framework/node');
const workflows = await load('@robota-sdk/workflows/command');

const trust = frameworkNode.createNodeWorkspaceTrustService(storePath, {
  sessions: '.state/sessions',
  'session-logs': '.state/logs',
  memory: '.state/memory',
  checkpoints: '.state/checkpoints',
});
const access = await trust.grant(root);

// `createWorkspaceWorkflowProject` calls assertWorkspaceProjectAuthority, getWorkspaceProjectReader,
// getWorkspaceProjectIdentity and, given a mutation, assertWorkspaceProjectMutationForAuthority from
// the framework's main entry: the four names the framework keeps there for it.
const mutation = frameworkMain.createWorkspaceProjectMutation(access.authority, {
  status: 'approved',
  purpose: 'workflows dist authority',
});
const project = workflows.createWorkspaceWorkflowProject(access.authority, mutation);

const result = {
  trust: access.status,
  canMutate: project.canMutate,
  executionRoot: project.executionRoot,
  read: project.readText('AGENTS.md', 'workflows dist authority'),
  listing: project.listDirectory('', 'workflows dist authority').map((entry) => entry.name),
};
if (frameworkNode.supportsWorkspaceProjectMutation()) {
  project.writeText('.workflows/saved.json', '{}', 'workflows dist authority');
  result.written = project.readText('.workflows/saved.json', 'workflows dist authority');
}

// A look-alike authority is refused by the same dist.
try {
  workflows.createWorkspaceWorkflowProject(Object.freeze(Object.create(null)), undefined);
  result.forged = 'accepted';
} catch (error) {
  result.forged = error?.name ?? 'refused';
}
process.stdout.write(`${JSON.stringify(result)}\n`);
