FROM node:24-bookworm-slim AS base

RUN apt-get update \
    && apt-get install --yes --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN npm install --global --ignore-scripts pnpm@12.14.0 \
    && chmod +x /usr/local/lib/node_modules/pnpm/bin/pnpm.mjs \
    && ln --symbolic --force /usr/local/lib/node_modules/pnpm/bin/pnpm.mjs /usr/local/bin/pnpm \
    && chown node:node /app
USER node

FROM base AS dependencies
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node server/package.json ./server/
COPY --chown=node:node client/package.json ./client/
RUN pnpm --filter express-app... install --frozen-lockfile

FROM dependencies AS development
COPY --chown=node:node . .
RUN pnpm --filter express-app db:generate
EXPOSE 3000
CMD ["pnpm", "--filter", "express-app", "dev"]

FROM development AS build
RUN pnpm --filter express-app build

FROM base AS production-dependencies
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node server/package.json ./server/
COPY --chown=node:node client/package.json ./client/
RUN pnpm --filter express-app... install --prod --frozen-lockfile

FROM node:24-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/views ./server/views
COPY --from=build /app/server/public ./server/public
COPY --chown=node:node server/package.json ./server/
WORKDIR /app/server
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
