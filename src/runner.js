const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const logger = require('./logger');

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const ENGINE_CONFIG = {
  claude: {
    bin: 'claude',
    args: (prompt, verbose) => verbose
      ? ['--print', '--output-format', 'text', '--verbose', '-']
      : ['--print', '--output-format', 'text', '-'],
    stdin: true,
  },
  codex: {
    bin: 'codex',
    args: (prompt, verbose) => verbose ? ['-'] : ['--quiet', '-'],
    stdin: true,
  },
  gemini: {
    bin: 'gemini',
    // --yolo: auto-approve tool calls so agentic ops don't silently hang
    // prompt passed as direct -p arg — stdin-only causes silent hangs on agentic tool lookups
    args: (prompt, verbose) => verbose
      ? ['--yolo', '--debug', '-p', prompt]
      : ['--yolo', '-p', prompt],
    stdin: false,
  },
};

const SPAWN_ENV = () => ({
  ...process.env,
  HOME: '/root',
  PATH: process.env.PATH,
  GEMINI_CLI_TRUST_WORKSPACE: 'true',
});

function spawnEngine(cfg, prompt, cwd, verbose) {
  const child = spawn(cfg.bin, cfg.args(prompt, verbose), {
    cwd,
    env: SPAWN_ENV(),
    timeout: TIMEOUT_MS,
  });
  if (cfg.stdin) {
    child.stdin.write(prompt);
    child.stdin.end();
  } else {
    child.stdin.end();
  }
  return child;
}

async function run(engine, prompt, workDir, verbose = false) {
  const cfg = ENGINE_CONFIG[engine];
  if (!cfg) throw new Error(`Unknown engine: ${engine}`);

  const cwd = workDir || path.join(__dirname, '..', 'repos');
  logger.info(`Running ${engine} in ${cwd}: ${prompt.slice(0, 80)}...`);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnEngine(cfg, prompt, cwd, verbose);
    } catch (e) {
      if (e.code === 'ENOENT') return reject(new Error(`${engine} CLI not found — needs authentication setup`));
      return reject(e);
    }

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim() || '(no output)');
      } else {
        const err = stderr.trim() || stdout.trim() || `Exit code ${code}`;
        logger.warn(`${engine} exited ${code}: ${err.slice(0, 200)}`);
        resolve(stdout.trim() || `Error (exit ${code}):\n${err}`);
      }
    });

    child.on('error', (e) => {
      if (e.code === 'ENOENT') {
        reject(new Error(`${engine} CLI not found — needs authentication setup`));
      } else {
        reject(e);
      }
    });
  });
}

// Streaming variant — calls onChunk(text) as output arrives, resolves with full output
async function runStreaming(engine, prompt, workDir, onChunk, verbose = false) {
  const cfg = ENGINE_CONFIG[engine];
  if (!cfg) throw new Error(`Unknown engine: ${engine}`);

  const cwd = workDir || path.join(__dirname, '..', 'repos');
  logger.info(`Running ${engine} (streaming) in ${cwd}: ${prompt.slice(0, 80)}...`);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnEngine(cfg, prompt, cwd, verbose);
    } catch (e) {
      if (e.code === 'ENOENT') return reject(new Error(`${engine} CLI not found — needs authentication setup`));
      return reject(e);
    }

    let full = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      const chunk = d.toString();
      full += chunk;
      onChunk(full);
    });

    child.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderr += chunk;
      // Stream stderr too in verbose mode — that's where thinking goes
      if (verbose) {
        full += chunk;
        onChunk(full);
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(full.trim() || '(no output)');
      } else {
        const err = stderr.trim() || full.trim() || `Exit code ${code}`;
        logger.warn(`${engine} exited ${code}: ${err.slice(0, 200)}`);
        resolve(full.trim() || `Error (exit ${code}):\n${err}`);
      }
    });

    child.on('error', (e) => {
      if (e.code === 'ENOENT') {
        reject(new Error(`${engine} CLI not found — needs authentication setup`));
      } else {
        reject(e);
      }
    });
  });
}

module.exports = { run, runStreaming };
