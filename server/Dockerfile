FROM node:22-alpine

WORKDIR /app

COPY server/package.json ./server/package.json
COPY server/src ./server/src
COPY index.html styles.css app.js realtime.js manifest.webmanifest service-worker.js ./public/
COPY assets ./public/assets

ENV PORT=8787
ENV PUBLIC_DIR=/app/public
ENV DATA_DIR=/app/data

RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 8787

CMD ["node", "server/src/server.mjs"]
