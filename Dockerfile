FROM node:18-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
# Default/local port only — src/config.js reads process.env.PORT first, and
# Railway injects and routes off its own dynamic PORT, not this EXPOSE value.
EXPOSE 3001

CMD ["npm", "start"]
