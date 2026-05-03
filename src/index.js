const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('ioredis');
const cors = require('cors');

const config = require('./config');
const { RateLimiter, startCleanup } = require('./rateLimiter');
const {
  validateMessagePayload,
  validateJoinRoomPayload,
  validateTypingPayload,
} = require('./validator');
const { storeMessage, verifyToken } = require('./laravelApi');
const {
  analyzeMessage: analyzeMessageModeration,
  shouldBlockForMisinformation,
  shouldBlockForToxicity,
} = require('./moderation');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: true },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6,
  connectTimeout: 45000,
  // Scaling: allow many concurrent connections
  transports: ['websocket', 'polling'],
});

const rateLimiter = new RateLimiter(config.rateLimit.maxMessages, config.rateLimit.windowMs);
startCleanup(rateLimiter);

async function setupRedisAdapter() {
  let pub;
  let sub;
  try {
    pub = createClient({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password || undefined,
      maxRetriesPerRequest: 3,
      retryStrategy() {
        return null;
      },
    });
    pub.on('error', () => {});
    sub = pub.duplicate();
    sub.on('error', () => {});
    await pub.ping();
    io.adapter(createAdapter(pub, sub));
    console.log('Redis adapter attached for horizontal scaling');
  } catch (err) {
    if (pub) pub.disconnect();
    if (sub) sub.disconnect();
    console.warn('Redis not available (single instance):', err.message);
  }
}

function roomName(articleId) {
  return `article_${articleId}`;
}

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Authentication required: provide auth.token'));
  }
  try {
    const user = await verifyToken(token);
    if (!user) {
      return next(new Error('Invalid or expired token'));
    }
    socket.data.user_id = user.id;
    socket.data.token = token;
    next();
  } catch (e) {
    next(new Error('Authentication failed'));
  }
});

io.on('connection', (socket) => {
  socket.data.rooms = new Set();

  socket.on('join_room', (payload, callback) => {
    const result = validateJoinRoomPayload(payload);
    if (!result.valid) {
      const err = result.errors[0] || 'Invalid payload';
      callback?.({ error: err });
      return;
    }
    const room = roomName(result.article_id);
    socket.join(room);
    socket.data.rooms.add(room);
    callback?.({ success: true, room });
  });

  socket.on('send_message', async (payload, callback) => {
    const result = validateMessagePayload(payload);
    if (!result.valid) {
      callback?.({ error: result.errors[0] || 'Validation failed' });
      return;
    }

    const limit = rateLimiter.check(socket.id);
    if (!limit.allowed) {
      callback?.({ error: 'Rate limit exceeded. Maximum 5 messages per 10 seconds.' });
      return;
    }

    const { article_id, message, attachment_url } = result.normalized;
    const userId = socket.data.user_id;
    const token = socket.data.token;

    try {
      // Analyze message via AI moderation service before broadcast (skip for image-only)
      const moderation = message ? await analyzeMessageModeration(message) : null;
      if (moderation) {
        if (shouldBlockForToxicity(moderation, config.moderationBlockToxicityThreshold)) {
          callback?.({ error: 'Message rejected: content violates community guidelines.' });
          return;
        }
        if (shouldBlockForMisinformation(moderation, config.moderationBlockMisinformationThreshold)) {
          callback?.({ error: 'Message rejected: possible misinformation.' });
          return;
        }
      }

      const saved = await storeMessage(article_id, message, token, attachment_url || null);
      const receivePayload = {
        user_id: userId,
        article_id,
        message: saved.body ?? message,
        attachment_url: saved.attachment_url ?? attachment_url ?? null,
        timestamp: saved.created_at ? new Date(saved.created_at).getTime() : result.normalized.timestamp,
        id: saved.id,
      };
      if (moderation) {
        receivePayload.moderation = {
          toxicity_score: moderation.toxicity_score,
          claim_detected: moderation.claim_detected,
          misinformation_risk: moderation.misinformation_risk,
          truth_score: moderation.truth_score,
          explanation: moderation.explanation,
        };
      }
      io.to(roomName(article_id)).emit('receive_message', receivePayload);
      callback?.({ success: true, data: receivePayload });
    } catch (err) {
      const message = err.status === 403 ? 'Forbidden' : err.body?.message || err.message || 'Failed to store message';
      callback?.({ error: message });
    }
  });

  socket.on('user_typing', (payload) => {
    const result = validateTypingPayload(payload);
    if (!result.valid) return;
    socket.to(roomName(result.article_id)).emit('user_typing', {
      user_id: socket.data.user_id,
      article_id: result.article_id,
    });
  });

  socket.on('disconnect', (reason) => {
    rateLimiter.reset(socket.id);
  });
});

setupRedisAdapter().then(() => {
  server.listen(config.port, () => {
    console.log(`Chat server listening on port ${config.port}`);
  });
}).catch((err) => {
  console.error('Redis adapter setup failed, starting without it:', err);
  server.listen(config.port, () => {
    console.log(`Chat server listening on port ${config.port} (no Redis adapter)`);
  });
});
