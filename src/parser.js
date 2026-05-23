// Parse incoming message text into { engine, prompt, gitOps }
// Syntax:  claude: <prompt>  |  codex: <prompt>  |  gemini: <prompt>
// Git ops embedded naturally in the prompt — detected via keywords

const ENGINES = ['claude', 'codex', 'gemini'];

const GIT_PATTERNS = [
  { re: /\bpull\s+([\w.\-]+)\b/i,   op: 'pull' },
  { re: /\bpush\s+([\w.\-]+)\b/i,   op: 'push' },
  { re: /\bcommit\s+"([^"]+)"/i,     op: 'commit' },
  { re: /\bcommit\s+'([^']+)'/i,     op: 'commit' },
  { re: /\bdiff\s+([\w.\-]+)\b/i,    op: 'diff' },
  { re: /\blog\s+([\w.\-]+)\b/i,     op: 'log' },
  { re: /\bclone\s+([\w.\-]+)\b/i,   op: 'clone' },
];

function parse(text) {
  if (!text || !text.trim()) return null;

  const trimmed = text.trim();

  // Detect engine prefix  e.g. "claude: do something"
  let engine = null;
  let prompt = trimmed;

  for (const eng of ENGINES) {
    const prefix = new RegExp(`^${eng}\\s*:\\s*`, 'i');
    if (prefix.test(trimmed)) {
      engine = eng;
      prompt = trimmed.replace(prefix, '').trim();
      break;
    }
  }

  // Default to claude if no prefix
  if (!engine) engine = 'claude';

  // Detect git operations in the prompt
  const gitOps = [];
  for (const { re, op } of GIT_PATTERNS) {
    const match = prompt.match(re);
    if (match) gitOps.push({ op, target: match[1] });
  }

  // Flag as git-only if the prompt is just a git command with no real question
  const gitOnlyRe = /^(pull|push|diff|log|clone)\s+[\w.\-]+\s*$/i;
  const commitOnlyRe = /^commit\s+["'].+["']\s*$/i;
  const gitOnly = gitOps.length > 0 && (gitOnlyRe.test(prompt) || commitOnlyRe.test(prompt));

  return { engine, prompt, gitOps, gitOnly };
}

module.exports = { parse, ENGINES };
