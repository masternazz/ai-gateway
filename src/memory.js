const fs = require('fs');
const path = require('path');

const MEMORY_FILE = process.env.MEMORY_FILE || '/opt/ai-gateway/memory.md';
const HISTORY_DIR = process.env.HISTORY_DIR || '/opt/ai-gateway/history';
const MAX_HISTORY = 10;        // full exchanges to keep
const COMPACT_THRESHOLD = 20;  // compact when history exceeds this many entries

function ensureHistoryDir() {
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

function historyPath(channel) {
  ensureHistoryDir();
  const safe = channel.replace(/[^a-zA-Z0-9@._-]/g, '_');
  return path.join(HISTORY_DIR, `${safe}.json`);
}

function loadHistory(channel) {
  const file = historyPath(channel);
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

function saveHistory(channel, history) {
  fs.writeFileSync(historyPath(channel), JSON.stringify(history, null, 2));
}

function compactHistory(history) {
  // Summarize older half into a single [summary] entry, keep recent half intact
  const keepCount = Math.floor(history.length / 2);
  const old = history.slice(0, history.length - keepCount);
  const recent = history.slice(history.length - keepCount);

  const summary = old.map(e => `${e.role === 'user' ? 'User' : 'AI'}: ${e.text.slice(0, 120)}`).join(' | ');
  const compacted = [{ role: 'summary', text: `[Earlier conversation summary: ${summary}]`, ts: new Date().toISOString() }, ...recent];
  return compacted;
}

function addToHistory(channel, role, text) {
  let history = loadHistory(channel);
  history.push({ role, text, ts: new Date().toISOString() });
  if (history.length > COMPACT_THRESHOLD) history = compactHistory(history);
  saveHistory(channel, history);
}

function loadMemory() {
  if (!fs.existsSync(MEMORY_FILE)) return '';
  return fs.readFileSync(MEMORY_FILE, 'utf8').trim();
}

function appendMemory(fact) {
  const current = loadMemory();
  const line = `- ${fact.trim()}`;
  const updated = current ? `${current}\n${line}` : line;
  fs.writeFileSync(MEMORY_FILE, updated + '\n');
}

function buildPrompt(userText, channel) {
  const memory = loadMemory();
  const history = loadHistory(channel);

  let context = '';

  if (memory) {
    context += `## Persistent Memory\n${memory}\n\n`;
  }

  if (history.length > 0) {
    context += `## Recent Conversation\n`;
    for (const entry of history) {
      context += `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.text}\n`;
    }
    context += '\n';
  }

  return context ? `${context}## Current Message\n${userText}` : userText;
}

// Returns true if the message is a memory command, and handles it
function isMemoryCommand(text) {
  return /^memory:/i.test(text.trim());
}

function handleMemoryCommand(text) {
  const fact = text.replace(/^memory:\s*/i, '').trim();
  if (!fact) return 'Nothing to save — use: memory: <fact>';
  appendMemory(fact);
  return `Saved to memory: "${fact}"`;
}

module.exports = { buildPrompt, addToHistory, isMemoryCommand, handleMemoryCommand, loadMemory };
