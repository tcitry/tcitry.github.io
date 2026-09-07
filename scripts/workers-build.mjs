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
  const contentToken = process.env.BLOG_READ_TOKEN;
  const proToken = process.env.HEROUI_AUTH_TOKEN;
  if (!repository || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(repository)) {
    throw new BuildError('Set BLOG_CONTENT_REPOSITORY to the private GitHub owner/repository, without a URL.');
  }
  for (const [name, value] of [['BLOG_READ_TOKEN', contentToken], ['HEROUI_AUTH_TOKEN', proToken]]) {
    if (!value?.trim() || /[\r\n\0]/.test(value)) throw new BuildError(`Set the ${name} build secret before starting Workers Builds.`);
  }
  if (process.env.SKIP_DEPENDENCY_INSTALL !== '1') {
    throw new BuildError('Set SKIP_DEPENDENCY_INSTALL=1 in Workers Builds; this command installs the pinned theme before npm ci.');
  }
  if (process.env.PUBLIC_SITE_ENV && process.env.PUBLIC_SITE_ENV !== 'preview') {
    throw new BuildError('build:workers currently supports PUBLIC_SITE_ENV=preview only. Production promotion is a separate step.');
  }

  const scratch = await mkdtemp(path.join(tmpdir(), 'astro-workers-content-'));
  const checkout = path.join(scratch, 'content');
  const askpass = path.join(scratch, 'askpass');
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  const env = { ...process.env, BLOG_DIR: checkout, PUBLIC_SITE_ENV: 'preview' };
  // Keep credentials scoped to the only commands that need them.
  delete env.BLOG_READ_TOKEN;
  delete env.BLOG_CONTENT_REPOSITORY;
  delete env.HEROUI_AUTH_TOKEN;
  delete env.GIT_ASKPASS;
  const sensitive = [contentToken, proToken, repository, checkout].flatMap(value => [value, encodeURIComponent(value)]);
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
      `https://github.com/${repository}.git`, checkout,
    ], { ...env, BLOG_READ_TOKEN: contentToken, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: '0' }, true);
    await run('Removing private checkout remote metadata', 'git', ['-C', checkout, 'remote', 'remove', 'origin'], env, true);
    await rm(askpass);

    for (const script of ['setup', 'build', 'check', 'test', 'verify']) {
      const args = script === 'test' ? ['test'] : ['run', script];
      const commandEnv = script === 'setup' ? { ...env, HEROUI_AUTH_TOKEN: proToken } : env;
      await run(`Running npm ${args.join(' ')}`, process.env.npm_execpath ? process.execPath : 'npm',
        process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args, commandEnv);
    }
    console.log('Preview build verified. Workers Builds can now run its separate Wrangler deploy command.');
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
