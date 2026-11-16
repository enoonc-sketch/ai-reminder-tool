FROM node:20-alpine
WORKDIR /app
COPY web ./web
COPY server ./server
ENV DATA_FILE=/data/data.json
VOLUME /data
EXPOSE 8787
CMD ["node","server/server.js"]
