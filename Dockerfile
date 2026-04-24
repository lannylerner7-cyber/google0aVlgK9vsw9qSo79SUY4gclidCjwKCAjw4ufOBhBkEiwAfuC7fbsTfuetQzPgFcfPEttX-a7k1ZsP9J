# Use official Node.js runtime as base image
FROM node:18-alpine

# Install wget for health checks
RUN apk add --no-cache wget

# Set working directory in container
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create data directory for storage files
RUN mkdir -p data && \
    echo '{"sessions":[]}' > data/storage.json && \
    echo '[]' > data/blocked_ips.json && \
    touch data/bots.txt

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Change ownership of app directory
RUN chown -R nextjs:nodejs /app
USER nextjs

# Expose port
EXPOSE 5000

# Health check using wget (available in alpine)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO/dev/null http://localhost:5000/health || exit 1

# Start the application
CMD ["node", "server.js"]
