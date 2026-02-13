# Trading Bot V3.1 - Railway Deployment
FROM node:20-slim

# Install required dependencies for awal CLI
RUN apt-get update && apt-get install -y \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Install tsx globally for TypeScript execution
RUN npm install -g tsx

# Install Coinbase Agentic Wallet CLI
RUN npm install -g @coinbase/agentic-wallet

# Copy application files
COPY . .

# Create logs directory
RUN mkdir -p logs

# Set environment
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

# Run the trading agent
CMD ["tsx", "agent-v3.1.ts"]
