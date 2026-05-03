require('dotenv').config();

module.exports = {
  port: parseInt(process.env.CHAT_SERVER_PORT || '3001', 10),
  laravelApiUrl: process.env.LARAVEL_API_URL || 'http://localhost:8000',
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  rateLimit: {
    maxMessages: parseInt(process.env.CHAT_RATE_LIMIT_MAX || '5', 10),
    windowMs: parseInt(process.env.CHAT_RATE_LIMIT_WINDOW_MS || '10000', 10), // 10 seconds
  },
  message: {
    maxLength: parseInt(process.env.CHAT_MESSAGE_MAX_LENGTH || '5000', 10),
  },
  // AI moderation (analyze every message before broadcast)
  moderationTimeoutMs: parseInt(process.env.AI_MODERATION_TIMEOUT_MS || '8000', 10),
  moderationBlockMisinformationThreshold: process.env.AI_BLOCK_MISINFORMATION_THRESHOLD != null
    ? parseFloat(process.env.AI_BLOCK_MISINFORMATION_THRESHOLD)
    : null,
  moderationBlockToxicityThreshold: process.env.AI_BLOCK_TOXICITY_THRESHOLD != null
    ? parseFloat(process.env.AI_BLOCK_TOXICITY_THRESHOLD)
    : null,
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  },
};
