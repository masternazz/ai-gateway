const nodemailer = require('nodemailer');
const logger = require('./logger');

const MAX_TELEGRAM_MSG = 4000; // Telegram limit is 4096

// ── Email reply ──────────────────────────────────────────────────────────────

let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      tls: { rejectUnauthorized: false },
    });
  }
  return transporter;
}

async function sendEmail({ to, subject, body, inReplyTo, references }) {
  const msg = {
    from: `"AI Gateway" <${process.env.SMTP_FROM}>`,
    to,
    subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
    text: body,
    ...(inReplyTo && { inReplyTo, references: references || inReplyTo }),
  };

  try {
    await getTransporter().sendMail(msg);
    logger.info(`Email reply sent to ${to}`);
  } catch (e) {
    logger.error(`Failed to send email to ${to}: ${e.message}`);
    throw e;
  }
}

// ── Telegram reply ───────────────────────────────────────────────────────────

function chunkText(text, maxLen) {
  const chunks = [];
  while (text.length > 0) {
    chunks.push(text.slice(0, maxLen));
    text = text.slice(maxLen);
  }
  return chunks;
}

async function sendTelegram(bot, chatId, text) {
  const chunks = chunkText(text, MAX_TELEGRAM_MSG);
  for (const chunk of chunks) {
    try {
      await bot.sendMessage(chatId, `\`\`\`\n${chunk}\n\`\`\``, { parse_mode: 'Markdown' });
    } catch {
      // Fallback: plain text if markdown fails
      await bot.sendMessage(chatId, chunk);
    }
  }
}

module.exports = { sendEmail, sendTelegram };
