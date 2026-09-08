import {execFileSync} from 'node:child_process';
import {readFileSync, lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean))];
const failures = [];
const patterns = [
  /\bsk_(?:test|live)_[A-Za-z0-9]{20,}\b/,
  /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{30,}\b/,
  /\b(?:prod|dev):[a-z0-9-]+\|[A-Za-z0-9+/=_-]{24,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
for (const file of files) {
  const envFile = /(?:^|\/)\.(?:env|dev\.vars)(?:\.|$)/.test(file);
  if (envFile && !/\.(?:example|sample|template)$/.test(file)) {
    failures.push(`${file}: environment files must be ignored`);
    continue;
  }
  const full = path.join(root, file);
  let stat;
  try { stat = lstatSync(full); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  if (!stat.isFile() || stat.size > 2_000_000) continue;
  const source = readFileSync(full, 'utf8');
  if (patterns.some(pattern => pattern.test(source))) failures.push(`${file}: credential-like content; inspect and remove it before committing`);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log('Public source check passed: local environment files are ignored and no supported credential patterns were found.');
