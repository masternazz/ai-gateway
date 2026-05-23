const TelegramBot = require('node-telegram-bot-api');
const { parse } = require('./parser');
const { run } = require('./runner');
const { runGitOps, repoPath } = require('./git');
const { sendTelegram } = require('./reply');
const { buildPrompt, addToHistory, isMemoryCommand, handleMemoryCommand } = require('./memory');
const logger = require('./logger');

const ALLOWED_USER_ID = parseInt(process.env.TELEGRAM_ALLOWED_USER_ID || '0');

let bot;

function getBot() {
  if (!bot) {
    bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
  }
  return bot;
}

async function handleUpdate(update) {
  const b = getBot();
  const msg = update.message || update.edited_message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = msg.text || '';

  // Only allow the configured user
  if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) {
    logger.warn(`Rejected Telegram message from user ${userId}`);
    await b.sendMessage(chatId, 'Not authorized.');
    return;
  }

  if (!text.trim()) {
    await b.sendMessage(chatId, 'Send a message like: `claude: your prompt here`', { parse_mode: 'Markdown' });
    return;
  }

  logger.info(`Telegram from ${userId}: ${text.slice(0, 80)}`);

  // memory: command — save a fact, no AI needed
  if (isMemoryCommand(text)) {
    const result = handleMemoryCommand(text);
    await b.sendMessage(chatId, result);
    return;
  }

  const parsed = parse(text);
  if (!parsed) {
    await b.sendMessage(chatId, 'Could not parse. Format: `claude: <prompt>` or `codex: <prompt>`', { parse_mode: 'Markdown' });
    return;
  }

  const { engine, prompt, gitOps, gitOnly } = parsed;
  const channel = `telegram_${userId}`;

  // Acknowledge immediately
  await b.sendMessage(chatId, gitOnly ? 'Running git op...' : `Running *${engine}*...`, { parse_mode: 'Markdown' });

  let response = '';

  if (gitOps.length > 0) {
    const gitResult = await runGitOps(gitOps);
    response += gitResult;
  }

  if (!gitOnly) {
    const firstRepo = gitOps[0]?.target;
    const workDir = firstRepo ? repoPath(firstRepo) : undefined;

    const fullPrompt = buildPrompt(prompt, channel);
    addToHistory(channel, 'user', prompt);

    if (response) response += '\n\n';
    try {
      const aiResult = await run(engine, fullPrompt, workDir);
      response += aiResult;
      addToHistory(channel, 'assistant', aiResult.slice(0, 500));
    } catch (e) {
      response += `Error running ${engine}: ${e.message}`;
    }
  }

  await sendTelegram(b, chatId, response);
}

function setupWebhook(app) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.WEBHOOK_SECRET;

  if (!token) {
    logger.warn('TELEGRAM_BOT_TOKEN not set — Telegram webhook disabled');
    return;
  }

  const path = `/telegram/${secret || token}`;

  app.post(path, async (req, res) => {
    res.sendStatus(200); // always ack immediately
    try {
      await handleUpdate(req.body);
    } catch (e) {
      logger.error(`Telegram handler error: ${e.message}`);
    }
  });

  logger.info(`Telegram webhook registered at POST ${path}`);

  // Return the path so we can register it with Telegram on startup
  return path;
}

async function registerWebhook(publicUrl, webhookPath) {
  const b = getBot();
  const url = `${publicUrl}${webhookPath}`;
  await b.setWebHook(url);
  logger.info(`Telegram webhook set to: ${url}`);
}

module.exports = { setupWebhook, registerWebhook, getBot };
