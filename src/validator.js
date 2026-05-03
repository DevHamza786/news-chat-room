const MESSAGE_MAX_LENGTH = 5000;

/**
 * Validate send_message payload: { user_id, article_id, message, timestamp }
 */
function validateMessagePayload(payload) {
  const errors = [];
  if (payload == null || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be an object'] };
  }
  if (typeof payload.user_id !== 'number' && typeof payload.user_id !== 'string') {
    errors.push('user_id is required and must be a number or string');
  }
  if (typeof payload.article_id !== 'number' && typeof payload.article_id !== 'string') {
    errors.push('article_id is required and must be a number or string');
  }
  if (typeof payload.message !== 'string') {
    errors.push('message is required and must be a string');
  } else {
    const trimmed = payload.message.trim();
    if (trimmed.length === 0 && !payload.attachment_url) errors.push('message cannot be empty unless attachment_url is provided');
    if (trimmed.length > MESSAGE_MAX_LENGTH) errors.push(`message must be at most ${MESSAGE_MAX_LENGTH} characters`);
  }
  if (payload.attachment_url != null && typeof payload.attachment_url !== 'string') {
    errors.push('attachment_url must be a string URL if present');
  }
  if (payload.timestamp != null && (typeof payload.timestamp !== 'number' && typeof payload.timestamp !== 'string')) {
    errors.push('timestamp must be a number or string if present');
  }
  return {
    valid: errors.length === 0,
    errors,
    normalized: {
      user_id: payload.user_id,
      article_id: Number(payload.article_id) || 0,
      message: typeof payload.message === 'string' ? payload.message.trim() : '',
      attachment_url: typeof payload.attachment_url === 'string' && payload.attachment_url.trim() ? payload.attachment_url.trim() : null,
      timestamp: payload.timestamp != null ? (typeof payload.timestamp === 'number' ? payload.timestamp : Date.parse(payload.timestamp) || Date.now()) : Date.now(),
    },
  };
}

/**
 * Validate join_room payload: { article_id }
 */
function validateJoinRoomPayload(payload) {
  if (payload == null || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be an object'], article_id: null };
  }
  const articleId = payload.article_id != null ? Number(payload.article_id) : NaN;
  if (Number.isNaN(articleId) || articleId < 1) {
    return { valid: false, errors: ['article_id is required and must be a positive number'], article_id: null };
  }
  return { valid: true, errors: [], article_id: articleId };
}

/**
 * Validate user_typing payload: { article_id }
 */
function validateTypingPayload(payload) {
  if (payload == null || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be an object'], article_id: null };
  }
  const articleId = payload.article_id != null ? Number(payload.article_id) : NaN;
  if (Number.isNaN(articleId) || articleId < 1) {
    return { valid: false, errors: ['article_id is required and must be a positive number'], article_id: null };
  }
  return { valid: true, errors: [], article_id: articleId };
}

module.exports = {
  validateMessagePayload,
  validateJoinRoomPayload,
  validateTypingPayload,
  MESSAGE_MAX_LENGTH,
};
