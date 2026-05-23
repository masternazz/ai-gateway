const path = require('path');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { parse } = require('./parser');
const { run } = require('./runner');
const { runGitOps, repoPath, log: gitLog } = require('./git');
const { sendEmail } = require('./reply');
const { buildPrompt, addToHistory, isMemoryCommand, handleMemoryCommand } = require('./memory');
const logger = require('./logger');

const POLL_INTERVAL_MS = 30 * 1000;
const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || 'masternazz.com')
  .split(',').map(d => d.trim().toLowerCase());

function isAllowedSender(from) {
  if (!from) return false;
  const email = from.value?.[0]?.address || from;
  const domain = String(email).split('@')[1]?.toLowerCase();
  return ALLOWED_DOMAINS.includes(domain);
}

function createImapConnection() {
  return new Imap({
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASS,
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT || '993'),
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    authTimeout: 10000,
    connTimeout: 15000,
  });
}

async function fetchUnseenEmails(imap) {
  return new Promise((resolve, reject) => {
    imap.openBox('INBOX', false, (err, box) => {
      if (err) return reject(err);

      imap.search(['UNSEEN'], (err, uids) => {
        if (err) return reject(err);
        if (!uids || uids.length === 0) return resolve([]);

        const emails = [];
        const fetch = imap.fetch(uids, { bodies: '', markSeen: true });

        fetch.on('message', (msg) => {
          const chunks = [];
          msg.on('body', (stream) => {
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('end', () => {
              emails.push(Buffer.concat(chunks));
            });
          });
        });

        fetch.on('error', reject);
        fetch.on('end', () => resolve(emails));
      });
    });
  });
}

async function processEmail(rawBuffer) {
  const parsed = await simpleParser(rawBuffer);
  const from = parsed.from;
  const subject = parsed.subject || '';
  const body = parsed.text || '';
  const replyTo = from?.value?.[0]?.address;
  const messageId = parsed.messageId;

  if (!isAllowedSender(from)) {
    logger.warn(`Rejected email from unauthorized sender: ${replyTo}`);
    return;
  }

  logger.info(`Processing email from ${replyTo}: "${subject}"`);

  // Subject carries the prefix + instruction; body appends as additional context
  const rawText = body.trim() ? `${subject.trim()}\n\n${body.trim()}` : subject.trim();

  // memory: command — save a fact, reply with confirmation
  if (isMemoryCommand(rawText)) {
    const result = handleMemoryCommand(rawText);
    await sendEmail({ to: replyTo, subject: `Re: ${subject}`, body: result, inReplyTo: messageId, references: messageId });
    return;
  }

  const parsed2 = parse(rawText);

  if (!parsed2) {
    await sendEmail({ to: replyTo, subject, body: 'Could not parse your request. Use format: claude: <your prompt>' });
    return;
  }

  const { engine, prompt, aiPrompt, gitOps, gitOnly, verbose } = parsed2;
  const channel = `email_${replyTo}`;
  let response = '';
  let gitContext = '';

  if (gitOps.length > 0) {
    const gitResult = await runGitOps(gitOps);
    response += gitResult;
    gitContext = gitResult;

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
    const workDir = (engine === 'gemini')
      ? path.join(__dirname, '..', 'repos')
      : (firstRepo ? repoPath(firstRepo) : undefined);

    const promptWithGit = gitContext ? `Git context:\n${gitContext}\n\n${aiPrompt}` : aiPrompt;
    const fullPrompt = buildPrompt(promptWithGit, channel, engine);
    addToHistory(channel, 'user', aiPrompt);

    if (response) response += '\n\n';
    try {
      const aiResult = await run(engine, fullPrompt, workDir, verbose);
      response += aiResult;
      addToHistory(channel, 'assistant', aiResult.slice(0, 500));
    } catch (e) {
      response += `Error running ${engine}: ${e.message}`;
    }
  }

  await sendEmail({
    to: replyTo,
    subject,
    body: response,
    inReplyTo: messageId,
    references: messageId,
  });
}

async function pollOnce() {
  const imap = createImapConnection();

  return new Promise((resolve) => {
    imap.once('ready', async () => {
      try {
        const emails = await fetchUnseenEmails(imap);
        logger.info(`Email poll: ${emails.length} unseen message(s)`);

        for (const raw of emails) {
          try {
            await processEmail(raw);
          } catch (e) {
            logger.error(`Error processing email: ${e.message}`);
          }
        }
      } catch (e) {
        logger.error(`IMAP error: ${e.message}`);
      } finally {
        imap.end();
        resolve();
      }
    });

    imap.once('error', (e) => {
      logger.error(`IMAP connection error: ${e.message}`);
      resolve();
    });

    imap.connect();
  });
}

function startPoller() {
  logger.info(`Email poller started — checking every ${POLL_INTERVAL_MS / 1000}s`);
  pollOnce();
  setInterval(pollOnce, POLL_INTERVAL_MS);
}

module.exports = { startPoller };
