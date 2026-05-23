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

function getKnownRepos() {
  const names = new Set();
  for (const entry of (process.env.REPOS || '').split(',')) {
    const idx = entry.indexOf(':');
    if (idx !== -1) names.add(entry.slice(0, idx).trim().toLowerCase());
  }
  return names;
}

function parse(text) {
  if (!text || !text.trim()) return null;

  const trimmed = text.trim();

  // Detect verbose prefix — "verbose: ..." or "verbose claude: ..."
  let verbose = false;
  let working = trimmed;
  if (/^verbose\s*:/i.test(working)) {
    verbose = true;
    working = working.replace(/^verbose\s*:\s*/i, '').trim();
  } else if (/^verbose\s+/i.test(working)) {
    verbose = true;
    working = working.replace(/^verbose\s+/i, '').trim();
  }

  // Detect engine prefix  e.g. "claude: do something"
  let engine = null;
  let prompt = working;

  for (const eng of ENGINES) {
    const prefix = new RegExp(`^${eng}\\s*:\\s*`, 'i');
    if (prefix.test(working)) {
      engine = eng;
      prompt = working.replace(prefix, '').trim();
      break;
    }
  }

  // Default to claude if no prefix
  if (!engine) engine = 'claude';

  const knownRepos = getKnownRepos();

  // Detect git operations — only count a match if the target is a known repo name
  const gitOps = [];
  for (const { re, op } of GIT_PATTERNS) {
    const match = prompt.match(re);
    if (match) {
      const target = match[1];
      // For commit ops there's no repo target to validate, always include
      if (op === 'commit' || knownRepos.has(target.toLowerCase())) {
        gitOps.push({ op, target });
      }
    }
  }

  // Flag as git-only if the prompt is just a git command with no real question
  const gitOnlyRe = /^(pull|push|diff|log|clone)\s+[\w.\-]+\s*$/i;
  const commitOnlyRe = /^commit\s+["'].+["']\s*$/i;
  const gitOnly = gitOps.length > 0 && (gitOnlyRe.test(prompt) || commitOnlyRe.test(prompt));

  // Strip git op phrases from the prompt so the AI doesn't try to run git itself
  // e.g. "pull chess and tell me the last commit" → "tell me the last commit"
  let aiPrompt = prompt;
  if (gitOps.length > 0 && !gitOnly) {
    for (const { re } of GIT_PATTERNS) {
      aiPrompt = aiPrompt.replace(re, '').replace(/^\s*(and|then)\s*/i, '').trim();
    }
    if (!aiPrompt) aiPrompt = prompt; // fallback if we stripped everything
  }

  return { engine, prompt, aiPrompt, gitOps, gitOnly, verbose };
}

module.exports = { parse, ENGINES };
