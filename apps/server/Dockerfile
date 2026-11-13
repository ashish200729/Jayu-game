# Jayu game server (Colyseus 0.18 on Node 22 LTS). Build from the repository root:
#   docker build -f apps/server/Dockerfile -t jayu-server .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci --ignore-scripts --no-audit --no-fund
RUN npm run build:server

FROM node:22-alpine
ENV NODE_ENV=production PORT=2567 DATA_DIR=/data REGION=ap-south
WORKDIR /app
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts && mkdir -p /data && chown node:node /data
USER node
EXPOSE 2567
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:2567/health || exit 1
# SIGTERM drains: running matches finish (up to 6 min) before exit.
STOPSIGNAL SIGTERM
CMD ["node", "dist/main.js"]
