# Mech Royale bot. Built on linux/amd64; runs with no network, read-only root, 1 CPU, 512 MB, map at /arena.
FROM oven/bun:1.4.4-slim
WORKDIR /bot
COPY package.json ./
COPY src ./src
ENTRYPOINT ["bun", "/bot/src/main.ts"]
