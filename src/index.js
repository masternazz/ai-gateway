require('dotenv').config();
const express = require('express');
const logger = require('./logger');
const { setupWebhook, registerWebhook } = require('./telegram');
const { startPoller } = require('./email-poller');

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), time: new Date().toISOString() });
});

// Telegram webhook
const webhookPath = setupWebhook(app);

const PORT = parseInt(process.env.PORT || '3000');

app.listen(PORT, '0.0.0.0', async () => {
  logger.info(`AI Gateway listening on port ${PORT}`);

  // Register Telegram webhook if public URL is configured
  if (webhookPath && process.env.PUBLIC_URL) {
    try {
      await registerWebhook(process.env.PUBLIC_URL, webhookPath);
    } catch (e) {
      logger.warn(`Could not register Telegram webhook: ${e.message}`);
    }
  } else if (webhookPath) {
    logger.warn('PUBLIC_URL not set — set it to your public URL (e.g. https://ai-gateway.example.com) then restart to register Telegram webhook');
  }

  // Start email poller
  if (process.env.IMAP_PASS) {
    startPoller();
  } else {
    logger.warn('IMAP_PASS not set — email poller disabled');
  }
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
});
