FROM node:22-bookworm-slim AS backend-deps
WORKDIR /src/wildfire-backend
COPY wildfire-backend/package.json wildfire-backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-bookworm-slim AS dashboard-deps
WORKDIR /src/wildfire-dashboard
COPY wildfire-dashboard/package.json wildfire-dashboard/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/wildfire-backend
COPY --from=backend-deps /src/wildfire-backend/node_modules ./node_modules
COPY wildfire-backend/package.json ./
COPY wildfire-backend/src ./src
COPY wildfire-dashboard/dist /app/wildfire-dashboard/dist
USER node
EXPOSE 4000
CMD ["node", "src/server.js"]
