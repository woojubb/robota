import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  embeddedProductIdentity,
  generateDefaultEnvironment,
  publicProductConfig,
} from '../../packages/product-config/src/index.ts';
import { loadProductConfig } from '../../packages/product-config/src/node.ts';
import { generateWorkspaceFromConfig } from './generate-workspace.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUTPUTS = { www: 'out', docs: 'out', blog: 'dist' };

function requirePublicSiteConfig(app, config) {
  const required = [
    ['PROJECT_REPOSITORY_URL', config.identity.repositoryUrl],
    ['PROJECT_DOCS_URL', config.identity.docsUrl],
    app === 'www'
      ? ['PROJECT_HOMEPAGE_URL', config.identity.websiteUrl]
      : app === 'blog'
        ? ['PROJECT_BLOG_URL', config.identity.blogUrl]
        : ['PROJECT_DOCS_URL', config.identity.docsUrl],
    app === 'www'
      ? ['DEPLOY_PROJECT_NAME', config.deploy.projectName]
      : app === 'docs'
        ? ['DEPLOY_DOCS_PROJECT_NAME', config.deploy.docsProjectName]
        : ['DEPLOY_BLOG_PROJECT_NAME', config.deploy.blogProjectName],
  ];
  for (const [variable, value] of required) {
    if (!value) throw new Error(`${variable} is required for the ${app} public site build.`);
  }
}

async function verifyPublicOutput(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await verifyPublicOutput(file);
    else if (/\.(?:html|js|json|txt|xml|css|svg|md)$/iu.test(entry.name)) {
      const token = /__(?:PRODUCT|PROJECT|SERVICE|DEPLOY)_[A-Z0-9_]+__/u.exec(
        await readFile(file, 'utf8'),
      );
      if (token) throw new Error(`Unresolved product placeholder ${token[0]} in ${entry.name}.`);
    }
  }
}

function runCommand(command, args, cwd, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? code}).`));
    });
  });
}

/** Build a public site from an explicit product selection without altering neutral source. */
export async function buildSite({
  app,
  sourceRoot = ROOT,
  environment = { ...process.env },
  run = runCommand,
}) {
  if (!Object.hasOwn(OUTPUTS, app)) throw new Error('Select www, docs or blog.');
  if (!environment.PRODUCT_CONFIG_FILE && !environment.PRODUCT_BUILD_ENV?.trim()) {
    throw new Error(
      'Select PRODUCT_CONFIG_FILE or PRODUCT_BUILD_ENV before building a public site.',
    );
  }
  if (environment.PRODUCT_CONFIG_FILE && !path.isAbsolute(environment.PRODUCT_CONFIG_FILE)) {
    throw new Error('PRODUCT_CONFIG_FILE must be an absolute path.');
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'product-site-build-'));
  try {
    let filePath = environment.PRODUCT_CONFIG_FILE;
    if (!filePath) {
      filePath = path.join(temporary, 'selected-product.env');
      await writeFile(filePath, environment.PRODUCT_BUILD_ENV, { mode: 0o600 });
    }
    const config = loadProductConfig({ environment, filePath });
    requirePublicSiteConfig(app, config);
    const workspace = await generateWorkspaceFromConfig({
      sourceRoot,
      outDir: path.join(temporary, 'workspace'),
      config,
      defaultEnvironment: generateDefaultEnvironment(),
      publicConfig: publicProductConfig(config),
      embeddedIdentity: embeddedProductIdentity(config),
    });
    // The configuration is already embedded. Do not forward the inline host profile into app builds.
    const childEnvironment = { ...environment };
    delete childEnvironment.PRODUCT_BUILD_ENV;
    delete childEnvironment.PRODUCT_CONFIG_FILE;
    await run('pnpm', ['install', '--frozen-lockfile'], workspace, childEnvironment);
    await run('pnpm', ['--dir', `apps/${app}`, 'run', 'build'], workspace, childEnvironment);
    const output = path.join(sourceRoot, 'apps', app, OUTPUTS[app]);
    const built = path.join(workspace, 'apps', app, OUTPUTS[app]);
    await verifyPublicOutput(built);
    // A failed application build leaves the last output intact and never reaches publication.
    await mkdir(path.dirname(output), { recursive: true });
    await rm(output, { recursive: true, force: true });
    await cp(built, output, { recursive: true });
    return output;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildSite({ app: process.argv[2] })
    .then((output) => {
      process.stdout.write(`Product site output: ${output}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
