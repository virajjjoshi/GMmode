# Trash Talk Live: production image. No dependencies, so no npm install step.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

# Data (takes, leagues, bets) lives on a mounted volume at /data.
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "server.js"]
