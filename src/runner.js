const { spawn } = require('child_process');
const path = require('path');
const logger = require('./logger');

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Maps engine name to the CLI binary and how to pass a non-interactive prompt
const ENGINE_CONFIG = {
  claude: {
    bin: 'claude',
    args: (prompt) => ['--print', '--output-format', 'text', prompt],
  },
  codex: {
    bin: 'codex',
    args: (prompt) => ['--quiet', prompt],
  },
  gemini: {
    bin: 'gemini',
    args: (prompt) => ['-p', prompt],
  },
};

async function run(engine, prompt, workDir) {
  const cfg = ENGINE_CONFIG[engine];
  if (!cfg) throw new Error(`Unknown engine: ${engine}`);

  const cwd = workDir || path.join(__dirname, '..', 'repos');
  logger.info(`Running ${engine} in ${cwd}: ${prompt.slice(0, 80)}...`);

  return new Promise((resolve, reject) => {
    const child = spawn(cfg.bin, cfg.args(prompt), {
      cwd,
      env: { ...process.env, HOME: '/root', PATH: process.env.PATH },
      timeout: TIMEOUT_MS,
    });

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
        // Still resolve with whatever output we have — don't fail silently
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

module.exports = { run };
