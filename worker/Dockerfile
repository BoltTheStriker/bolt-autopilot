# Copy-trade bot worker: Node 22 with built-in fetch/http; the only npm dependency is the
# Anthropic SDK for the copilot (worker/package.json).
FROM node:22-slim
WORKDIR /app
COPY worker/package.json worker/package-lock.json ./worker/
RUN cd worker && npm ci --omit=dev --no-audit --no-fund
COPY bot ./bot
COPY worker ./worker
COPY data/bot-state.json ./data/bot-state.json
ENV DATA_DIR=/data NODE_ENV=production
CMD ["node", "--experimental-strip-types", "--no-warnings", "worker/index.ts"]
