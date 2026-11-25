FROM node:22-slim

WORKDIR /app

# Install runtime utilities and Chromium dependencies if Chromium is enabled
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  chromium \
  fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

EXPOSE 3000

CMD ["npm", "start"]
