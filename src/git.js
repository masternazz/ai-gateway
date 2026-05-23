const { simpleGit } = require('simple-git');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const REPOS_DIR = path.join(__dirname, '..', 'repos');

// Per-repo clone locks — prevents concurrent clone attempts on the same repo
const cloneLocks = {};

// Parse REPOS env: "homelab-docs:git@github.com:...,nazz-d.github.io:git@github.com:..."
function getRepoMap() {
  const map = {};
  const entries = (process.env.REPOS || '').split(',');
  for (const entry of entries) {
    const idx = entry.indexOf(':');
    if (idx === -1) continue;
    const name = entry.slice(0, idx).trim();
    const url = entry.slice(idx + 1).trim();
    if (name && url) map[name] = url;
  }
  return map;
}

function repoPath(name) {
  return path.join(REPOS_DIR, name);
}

function sshEnv() {
  if (!process.env.GITHUB_SSH_KEY) return {};
  return { GIT_SSH_COMMAND: `ssh -i ${process.env.GITHUB_SSH_KEY} -o StrictHostKeyChecking=no` };
}

function git(name) {
  const p = repoPath(name);
  const sg = simpleGit({
    baseDir: p,
    config: [
      `user.name=${process.env.GIT_USER_NAME || 'ai-gateway'}`,
      `user.email=${process.env.GIT_USER_EMAIL || 'ai@example.com'}`
    ],
    unsafe: { allowUnsafeSshCommand: true },
  });
  if (process.env.GITHUB_SSH_KEY) sg.env({ ...process.env, ...sshEnv() });
  return sg;
}

async function ensureCloned(name) {
  const repoMap = getRepoMap();
  const url = repoMap[name];
  if (!url) throw new Error(`Unknown repo: ${name}. Known repos: ${Object.keys(repoMap).join(', ')}`);

  const p = repoPath(name);
  const gitDir = path.join(p, '.git');
  if (fs.existsSync(gitDir)) return; // already cloned

  // If a clone is already in progress for this repo, wait for it
  if (cloneLocks[name]) {
    await cloneLocks[name];
    return;
  }

  // Remove any partial/empty dir from a previous failed clone
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  logger.info(`Cloning ${name} from ${url}`);

  const sg = simpleGit({ unsafe: { allowUnsafeSshCommand: true } });
  if (process.env.GITHUB_SSH_KEY) sg.env({ ...process.env, ...sshEnv() });

  cloneLocks[name] = sg.clone(url, p)
    .then(() => { logger.info(`Cloned ${name}`); })
    .finally(() => { delete cloneLocks[name]; });

  await cloneLocks[name];
}

async function pull(name) {
  const p = repoPath(name);
  const wasNew = !fs.existsSync(path.join(p, '.git'));
  await ensureCloned(name);
  if (wasNew) return `Cloned ${name} successfully`;
  logger.info(`Pulling ${name}`);
  const result = await git(name).pull();
  const summary = result.summary;
  if (summary.changes === 0 && summary.insertions === 0 && summary.deletions === 0) {
    return `${name} is already up to date`;
  }
  return `Pulled ${name}: ${summary.changes} files changed, +${summary.insertions} -${summary.deletions} lines`;
}

async function push(name) {
  await ensureCloned(name);
  logger.info(`Pushing ${name}`);
  await git(name).push();
  return `Pushed ${name} to origin`;
}

async function commit(name, message) {
  await ensureCloned(name);
  logger.info(`Committing ${name}: ${message}`);
  await git(name).add('.');
  const result = await git(name).commit(message);
  return `Committed ${name}: ${result.summary.changes} files changed — "${message}"`;
}

async function diff(name) {
  await ensureCloned(name);
  const result = await git(name).diff(['HEAD']);
  return result || 'No changes';
}

async function log(name, count = 5) {
  await ensureCloned(name);
  const result = await git(name).log(['--oneline', `-${count}`]);
  return result.all.map(l => `${l.hash.slice(0, 7)} ${l.date.slice(0, 10)} ${l.message}`).join('\n');
}

async function runGitOps(gitOps) {
  const results = [];
  for (const { op, target } of gitOps) {
    try {
      let out;
      if (op === 'pull')   out = await pull(target);
      if (op === 'push')   out = await push(target);
      if (op === 'diff')   out = await diff(target);
      if (op === 'log')    out = await log(target);
      if (op === 'clone')  { await ensureCloned(target); out = `Cloned ${target}`; }
      if (out) results.push(`[git ${op} ${target}]\n${out}`);
    } catch (e) {
      results.push(`[git ${op} ${target} FAILED]\n${e.message}`);
    }
  }
  return results.join('\n\n');
}

module.exports = { pull, push, commit, diff, log, runGitOps, ensureCloned, repoPath };
