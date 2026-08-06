FROM node:22-alpine AS dependencies
WORKDIR /app/status-monitor-web
COPY status-monitor-web/package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=dependencies /app/status-monitor-web/node_modules ./status-monitor-web/node_modules
COPY status-monitor-web ./status-monitor-web
COPY status-monitor-client/dashboard ./status-monitor-client/dashboard
COPY status-monitor-client/clients.json ./status-monitor-client/clients.json
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "status-monitor-web/server.js"]
