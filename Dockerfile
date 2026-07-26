# Use official Node.js Alpine image for minimal footprint
FROM node:20-alpine

# Install Python3, ffmpeg, and yt-dlp dependencies
RUN apk add --no-cache \
    python3 \
    ffmpeg \
    curl \
    ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Set working directory
WORKDIR /app

# Copy package configuration
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose server port
EXPOSE 3000

# Set environment variable for yt-dlp binary
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV NODE_ENV=production
ENV PORT=3000

# Start server
CMD ["npm", "start"]
