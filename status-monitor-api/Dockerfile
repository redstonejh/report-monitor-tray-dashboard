FROM node:22-bookworm-slim AS dependencies
WORKDIR /app/status-monitor-api
COPY status-monitor-api/package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    API_PORT=3847 \
    HISTORY_DB_PATH=/data/history.db
WORKDIR /app
COPY --from=dependencies /app/status-monitor-api/node_modules ./status-monitor-api/node_modules
COPY status-monitor-api ./status-monitor-api
RUN mkdir -p /data /source && chown -R node:node /app /data /source
USER node
EXPOSE 3847
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3847/ping').then(r=>{if(!r.ok)throw Error(r.status)}).catch(()=>process.exit(1))"]
CMD ["node", "status-monitor-api/src/index.js"]
