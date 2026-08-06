FROM node:22-bookworm-slim AS dependencies
WORKDIR /app/status-monitor-api
COPY status-monitor-api/package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    API_PORT=3847 \
    HISTORY_DB_PATH=/data/history.db
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /app/status-monitor-api/node_modules ./status-monitor-api/node_modules
COPY status-monitor-api ./status-monitor-api
COPY status-monitor-api/docker-entrypoint.sh /usr/local/bin/report-monitor-api-entrypoint
RUN chmod 0755 /usr/local/bin/report-monitor-api-entrypoint \
    && mkdir -p /data /source \
    && chown -R node:node /app /data /source
EXPOSE 3847
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3847/ping').then(r=>{if(!r.ok)throw Error(r.status)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/local/bin/report-monitor-api-entrypoint"]
CMD ["node", "status-monitor-api/src/index.js"]
