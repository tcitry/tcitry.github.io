import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

class BuildError extends Error {}

async function main() {
  const repository = process.env.BLOG_CONTENT_REPOSITORY;
  const contentCommit = process.env.BLOG_CONTENT_COMMIT;
  const contentToken = process.env.BLOG_READ_TOKEN;
  const proToken = process.env.HEROUI_AUTH_TOKEN;
  if (!repository || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(repository)) {
    throw new BuildError('Set BLOG_CONTENT_REPOSITORY to the private GitHub owner/repository, without a URL.');
  }
  if (!/^[a-f0-9]{40}$/.test(contentCommit ?? '')) {
    throw new BuildError('Set BLOG_CONTENT_COMMIT to the full, reviewed commit SHA on the content main branch.');
  }
  for (const [name, value] of [['BLOG_READ_TOKEN', contentToken], ['HEROUI_AUTH_TOKEN', proToken]]) {
    if (!value?.trim() || /[\r\n\0]/.test(value)) throw new BuildError(`Set the ${name} build secret before starting Workers Builds.`);
  }
  if (process.env.SKIP_DEPENDENCY_INSTALL !== '1') {
    throw new BuildError('Set SKIP_DEPENDENCY_INSTALL=1 in Workers Builds; this command installs the pinned theme before npm ci.');
  }
  const siteEnvironment = process.env.PUBLIC_SITE_ENV ?? 'production';
  if (siteEnvironment !== 'production') {
    throw new BuildError('build:workers only supports PUBLIC_SITE_ENV=production. For local noindex previews, use npm run build.');
  }

  const scratch = await mkdtemp(path.join(tmpdir(), 'astro-workers-content-'));
  const checkout = path.join(scratch, 'content');
  const askpass = path.join(scratch, 'askpass');
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  const env = { ...process.env, BLOG_DIR: checkout, PUBLIC_SITE_ENV: siteEnvironment };
  // Keep credentials scoped to the only commands that need them.
  delete env.BLOG_READ_TOKEN;
  delete env.BLOG_CONTENT_REPOSITORY;
  delete env.BLOG_CONTENT_COMMIT;
  delete env.HEROUI_AUTH_TOKEN;
  delete env.GIT_ASKPASS;
  // Deploy credentials remain available to the later platform deploy command,
  // but dependency scripts and content renderers have no reason to receive them.
  const deploySecrets = Object.keys(env).filter(name => /^(?:CLOUDFLARE_|CF_)/.test(name)
    || ['GITHUB_TOKEN', 'GH_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT'].includes(name));
  const sensitive = [contentToken, proToken, repository, contentCommit, checkout,
    ...deploySecrets.map(name => env[name])].filter(Boolean).flatMap(value => [value, encodeURIComponent(value)]);
  for (const name of deploySecrets) delete env[name];
  const redact = value => sensitive.reduce((output, secret) => output.replaceAll(secret, '[redacted]'), String(value || ''));

  async function run(label, command, args, commandEnv, quiet = false) {
    console.log(label);
    try {
      const result = await execute(command, args, {
        cwd: root, env: commandEnv, signal: controller.signal,
        maxBuffer: 32 * 1024 * 1024,
      });
      if (!quiet) {
        process.stdout.write(redact(result.stdout));
        process.stderr.write(redact(result.stderr));
      }
      return result.stdout;
    } catch (error) {
      if (!quiet) {
        process.stdout.write(redact(error.stdout));
        process.stderr.write(redact(error.stderr));
      }
      throw new BuildError(controller.signal.aborted ? 'Workers build interrupted.' : `${label} failed. Check the build configuration and access permissions.`);
    }
  }

  try {
    await writeFile(askpass, '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" "x-access-token" ;;\n  *) printf "%s\\n" "$BLOG_READ_TOKEN" ;;\nesac\n', { mode: 0o700 });
    await run('Checking out private content', 'git', [
      '-c', 'credential.helper=', 'clone', '--quiet', '--branch', 'main', '--single-branch',
      '--no-checkout',
      `https://github.com/${repository}.git`, checkout,
    ], { ...env, BLOG_READ_TOKEN: contentToken, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: '0' }, true);
    await run('Checking the reviewed content revision', 'git', ['-C', checkout, 'merge-base', '--is-ancestor', contentCommit, 'origin/main'], env, true);
    await run('Selecting the reviewed content revision', 'git', ['-C', checkout, 'checkout', '--quiet', '--detach', contentCommit], env, true);
    const selectedCommit = await run('Verifying the content revision', 'git', ['-C', checkout, 'rev-parse', 'HEAD'], env, true);
    if (selectedCommit.trim() !== contentCommit) throw new BuildError('The content checkout does not match the reviewed revision.');
    await run('Removing private checkout remote metadata', 'git', ['-C', checkout, 'remote', 'remove', 'origin'], env, true);
    await rm(askpass);
    const siteCommit = (await run('Recording the site revision', 'git', ['rev-parse', 'HEAD'], env, true)).trim();

    for (const script of ['setup', 'build', 'check', 'test', 'verify:release']) {
      if (script === 'verify:release') {
        const siteHead = (await run('Checking the built site revision', 'git', ['rev-parse', 'HEAD'], env, true)).trim();
        const contentHead = (await run('Checking the built content revision', 'git', ['-C', checkout, 'rev-parse', 'HEAD'], env, true)).trim();
        if (siteHead !== siteCommit || contentHead !== contentCommit) throw new BuildError('Release source changed during the build. Start a new isolated build.');
      }
      const args = script === 'test' ? ['test'] : ['run', script];
      const commandEnv = script === 'setup' ? { ...env, HEROUI_AUTH_TOKEN: proToken } : env;
      await run(`Running npm ${args.join(' ')}`, process.env.npm_execpath ? process.execPath : 'npm',
        process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args, commandEnv);
    }
    console.log('Production build verified and sealed. Workers Builds can now run npm run deploy:verified without rebuilding.');
  } finally {
    await rm(scratch, { recursive: true, force: true });
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof BuildError ? error.message : 'Workers build failed. Check the build environment.');
  process.exitCode = 1;
}
