const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { parse } = require('./parser');
const { run, runStreaming } = require('./runner');
const { runGitOps, repoPath, log: gitLog } = require('./git');
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

  const { engine, prompt, aiPrompt, gitOps, gitOnly, verbose } = parsed;
  const channel = `telegram_${userId}`;

  // Acknowledge immediately
  const statusMsg = await b.sendMessage(
    chatId,
    gitOnly ? 'Running git op...' : `Running *${engine}*${verbose ? ' (verbose)' : ''}...`,
    { parse_mode: 'Markdown' }
  );

  let response = '';
  let gitContext = '';

  if (gitOps.length > 0) {
    const gitResult = await runGitOps(gitOps);
    response += gitResult;
    gitContext = gitResult;

    // After git ops finish, fetch log so AI has real commit data (avoids second ensureCloned)
    if (!gitOnly) {
      const firstRepo = gitOps[0]?.target;
      if (firstRepo) {
        try {
          const recentLog = await gitLog(firstRepo, 5);
          gitContext += `\n\nRecent commits for ${firstRepo}:\n${recentLog}`;
        } catch (_) {}
      }
    }
  }

  if (!gitOnly) {
    const firstRepo = gitOps[0]?.target;
    // For gemini: run from neutral dir so it doesn't try to use agentic git tools
    const workDir = (engine === 'gemini')
      ? path.join(__dirname, '..', 'repos')
      : (firstRepo ? repoPath(firstRepo) : undefined);

    const promptWithGit = gitContext ? `Git context:\n${gitContext}\n\n${aiPrompt}` : aiPrompt;
    const fullPrompt = buildPrompt(promptWithGit, channel, engine);
    addToHistory(channel, 'user', aiPrompt);

    if (response) response += '\n\n';
    try {
      let aiResult;
      if (verbose) {
        // Stream output live — edit the status message with accumulated text
        let lastEdit = Date.now();
        const gitPrefix = response;
        aiResult = await runStreaming(engine, fullPrompt, workDir, async (accumulated) => {
          // Throttle edits to once per 1.5s to avoid Telegram rate limits
          if (Date.now() - lastEdit < 1500) return;
          lastEdit = Date.now();
          const preview = (gitPrefix + accumulated).slice(-3000); // last 3000 chars
          try {
            await b.editMessageText(`\`\`\`\n${preview}\n\`\`\``, {
              chat_id: chatId,
              message_id: statusMsg.message_id,
              parse_mode: 'Markdown',
            });
          } catch (_) { /* ignore edit conflicts */ }
        }, true);
        // Delete the streaming preview message — final send below handles formatting
        try { await b.deleteMessage(chatId, statusMsg.message_id); } catch (_) {}
      } else {
        aiResult = await run(engine, fullPrompt, workDir);
      }
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
