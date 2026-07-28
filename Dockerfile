# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

# ---- Production Stage ----
FROM node:20-alpine

# Install dependencies for yt-dlp + ffmpeg
RUN apk add --no-cache \
    python3 \
    ffmpeg \
    curl \
    ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
       -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Non-root user for security
RUN addgroup -S tanzeel && adduser -S tanzeel -G tanzeel

WORKDIR /app

# Copy production deps from builder
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# Copy application source
COPY src/ ./src/
COPY public/ ./public/
COPY server.js api/ ./

# Ownership
RUN chown -R tanzeel:tanzeel /app

USER tanzeel

# Env
ENV NODE_ENV=production
ENV PORT=3000
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV NODE_NO_WARNINGS=1

EXPOSE 3000

HEALTHCHECK --interval=60s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
