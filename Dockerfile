FROM node:20-alpine
WORKDIR /app
COPY web ./web
COPY server ./server
ENV DATA_FILE=/data/data.json
# 以非 root 用户运行；放在 HTTPS 反向代理后面时加 -e TRUST_PROXY=1
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node","server/server.js"]
