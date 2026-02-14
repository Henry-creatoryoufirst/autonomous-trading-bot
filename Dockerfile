# Trading Bot V3.2 - Railway Deployment
# Uses Coinbase CDP SDK for live trade execution on Base network
FROM node:20-slim

# Install minimal system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first (layer caching)
COPY package*.json ./

# Install ALL dependencies (tsx is in devDependencies, needed for runtime)
RUN npm ci

# Copy application files
COPY . .

# Create logs directory
RUN mkdir -p logs

# Set environment
ENV NODE_ENV=production

# IPv4/IPv6 autoselection fix for cloud environments (Railway, etc.)
# Prevents connection timeouts to CDP API
ENV NODE_OPTIONS="--network-family-autoselection-attempt-timeout=500"

# Expose health check port
EXPOSE 3000

# Health check against the bot's built-in HTTP server
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Run the v3.2 trading agent with CDP SDK trade execution
CMD ["npx", "tsx", "agent-v3.2.ts"]
