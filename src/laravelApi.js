const config = require('./config');

/**
 * Call Laravel API to store a message. Uses Bearer token from the socket's authenticated user.
 */
async function storeMessage(articleId, body, bearerToken, attachmentUrl = null) {
  const url = `${config.laravelApiUrl.replace(/\/$/, '')}/api/articles/${articleId}/messages`;
  const payload = { body };
  if (attachmentUrl) payload.attachment_url = attachmentUrl;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    let err;
    try {
      err = JSON.parse(text);
    } catch {
      err = { message: text };
    }
    const e = new Error(err.message || `Laravel API ${res.status}`);
    e.status = res.status;
    e.body = err;
    throw e;
  }

  return res.json();
}

/**
 * Verify token and get current user (optional, for auth on connect).
 */
async function verifyToken(bearerToken) {
  const url = `${config.laravelApiUrl.replace(/\/$/, '')}/api/user`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${bearerToken}`,
    },
  });

  if (!res.ok) {
    return null;
  }
  return res.json();
}

module.exports = { storeMessage, verifyToken };
