# Stage 1: Build Frontend Assets
FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src/ ./src/
COPY public/ ./public/
RUN npm run build

# Stage 2: Production Dependencies (Backend)
FROM node:22-bookworm-slim AS backend-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --omit=dev
RUN cd backend && npm ci --omit=dev

# Stage 3: Minimal Production Runtime
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Non-root setup
RUN chown -R node:node /app

# Copy production node_modules
COPY --chown=node:node --from=backend-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=backend-deps /app/backend/node_modules ./backend/node_modules

# Copy built frontend static distribution
COPY --chown=node:node --from=frontend-builder /app/dist ./dist
COPY --chown=node:node public ./public

# Copy application runtime code (excluding tests, migrations, secrets, and test runner guards)
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node backend/package.json backend/server.js backend/app.js backend/db.js backend/dgii_reception_router.js ./backend/
COPY --chown=node:node backend/routes ./backend/routes
COPY --chown=node:node backend/middleware ./backend/middleware
COPY --chown=node:node backend/services ./backend/services
COPY --chown=node:node backend/repositories ./backend/repositories
COPY --chown=node:node backend/utils ./backend/utils
COPY --chown=node:node backend/domain ./backend/domain
COPY --chown=node:node backend/public ./backend/public

ENV NODE_ENV=staging \
    PORT=5005

USER node

EXPOSE 5005

HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "const http = require('http'); const req = http.get('http://127.0.0.1:5005/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)); req.on('error', () => process.exit(1));"

CMD ["node", "server.js"]

