const { simpleGit } = require('simple-git');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const REPOS_DIR = path.join(__dirname, '..', 'repos');

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

function git(name) {
  const p = repoPath(name);
  return simpleGit({
    baseDir: p,
    config: [
      `core.sshCommand=ssh -i ${process.env.GITHUB_SSH_KEY} -o StrictHostKeyChecking=no`,
      `user.name=ai-gateway`,
      `user.email=ai@masternazz.com`
    ]
  });
}

async function ensureCloned(name) {
  const repoMap = getRepoMap();
  const url = repoMap[name];
  if (!url) throw new Error(`Unknown repo: ${name}. Known repos: ${Object.keys(repoMap).join(', ')}`);

  const p = repoPath(name);
  if (!fs.existsSync(p)) {
    logger.info(`Cloning ${name} from ${url}`);
    fs.mkdirSync(p, { recursive: true });
    await simpleGit({
      config: [`core.sshCommand=ssh -i ${process.env.GITHUB_SSH_KEY} -o StrictHostKeyChecking=no`]
    }).clone(url, p);
    logger.info(`Cloned ${name}`);
  }
}

async function pull(name) {
  const p = repoPath(name);
  const wasNew = !fs.existsSync(p);
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
