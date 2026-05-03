/**
 * In-memory rate limiter: 5 messages per 10 seconds per user (per socket).
 * For multi-instance scaling, consider Redis-based rate limiting.
 */
class RateLimiter {
  constructor(maxMessages, windowMs) {
    this.maxMessages = maxMessages;
    this.windowMs = windowMs;
    this.counts = new Map(); // key -> { count, resetAt }
  }

  _key(socketId) {
    return socketId;
  }

  check(socketId) {
    const key = this._key(socketId);
    const now = Date.now();
    let entry = this.counts.get(key);

    if (!entry) {
      this.counts.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.maxMessages - 1 };
    }

    if (now >= entry.resetAt) {
      entry = { count: 1, resetAt: now + this.windowMs };
      this.counts.set(key, entry);
      return { allowed: true, remaining: this.maxMessages - 1 };
    }

    if (entry.count >= this.maxMessages) {
      return { allowed: false, remaining: 0 };
    }

    entry.count += 1;
    return { allowed: true, remaining: this.maxMessages - entry.count };
  }

  reset(socketId) {
    this.counts.delete(this._key(socketId));
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.counts.entries()) {
      if (now >= entry.resetAt) this.counts.delete(key);
    }
  }
}

let cleanupInterval;

function startCleanup(limiter, intervalMs = 60000) {
  if (cleanupInterval) clearInterval(cleanupInterval);
  cleanupInterval = setInterval(() => limiter.cleanup(), intervalMs);
}

module.exports = { RateLimiter, startCleanup };
