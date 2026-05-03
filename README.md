# News Chat Server (WebSocket)

Scalable WebSocket chat server using **Express** and **Socket.IO**. Each news article has its own room: `article_{article_id}`.

## Features

- **Room naming:** `article_{article_id}`
- **Events:** `join_room`, `send_message`, `receive_message`, `user_typing`
- **Laravel integration:** Messages are stored via Laravel API (`POST /api/articles/:id/messages`)
- **Redis Pub/Sub:** Use Socket.IO Redis adapter for multi-instance scaling
- **Rate limiting:** 5 messages per 10 seconds per user
- **Auth:** Connect with Laravel Sanctum token (`auth.token`)

## Setup

```bash
cd chat-server
cp .env.example .env
# Edit .env: LARAVEL_API_URL, REDIS_* if needed
npm install
npm start
```

## Environment

| Variable | Description |
|---------|-------------|
| `CHAT_SERVER_PORT` | Port (default: 3001) |
| `LARAVEL_API_URL` | Laravel API base URL |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Redis for adapter |
| `CHAT_RATE_LIMIT_MAX` | Max messages per window (default: 5) |
| `CHAT_RATE_LIMIT_WINDOW_MS` | Window in ms (default: 10000) |

## Events

### Client → Server

- **`join_room`**  
  Payload: `{ article_id }`  
  Joins the room `article_{article_id}`.

- **`send_message`**  
  Payload: `{ user_id, article_id, message, timestamp? }`  
  Validates, rate-limits, stores via Laravel, then broadcasts `receive_message` to the room.

- **`user_typing`**  
  Payload: `{ article_id }`  
  Broadcasts typing to others in the same room.

### Server → Client

- **`receive_message`**  
  Payload: `{ user_id, article_id, message, timestamp, id? }`

- **`user_typing`**  
  Payload: `{ user_id, article_id }`

## Message payload (send_message / receive_message)

```json
{
  "user_id": 1,
  "article_id": 5,
  "message": "Hello",
  "timestamp": 1699999999999
}
```

## Authentication

Connect with a Laravel Sanctum token:

```js
const socket = io('http://localhost:3001', {
  auth: { token: 'YOUR_SANCTUM_TOKEN' }
});
```

If the token is invalid or missing, the connection is rejected.

## Reconnection

Socket.IO handles reconnection automatically. After reconnect the client receives a new socket: **re-join rooms** by emitting `join_room` again for each article the user is viewing.

```js
socket.on('connect', () => {
  currentArticleId && socket.emit('join_room', { article_id: currentArticleId });
});
```

## Scaling (50k+ users)

1. **Redis adapter:** Run multiple chat-server instances behind a load balancer; they share state via Redis Pub/Sub.
2. **Sticky sessions:** If you use polling, enable sticky sessions by IP or cookie so the same client hits the same instance (optional; WebSocket doesn’t require it once connected).
3. **Rate limiting:** Per-socket limit (5/10s) is in-memory per instance; for strict global limits across instances, add a Redis-based limiter.

## API (Laravel)

The server calls:

- `GET {LARAVEL_API_URL}/api/user` with `Authorization: Bearer <token>` to verify the token.
- `POST {LARAVEL_API_URL}/api/articles/:articleId/messages` with body `{ body }` and the same Bearer token to store messages.

Ensure CORS allows the chat-server origin if it differs from the Laravel app.
