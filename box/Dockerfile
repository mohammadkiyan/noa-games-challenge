# "Box": Postgres 16 + the app in ONE container, to be run with --cpus=1 --memory=1g
# so the pair shares the budget of a Hetzner CPX02 (1 vCPU, 1 GB RAM). Load-test only;
# the two-container docker-compose.yml stays the dev/test setup.
# Build context is the repo root: docker build -f box/Dockerfile .

FROM node:22-bookworm-slim AS deps
WORKDIR /app/slice
COPY slice/package.json slice/package-lock.json ./
RUN npm ci --omit=dev

FROM postgres:16
# Only the node binary is needed at runtime (no npm). Node >= 22.18 strips TS types itself.
COPY --from=deps /usr/local/bin/node /usr/local/bin/node
RUN useradd --system --create-home app
WORKDIR /app/slice
COPY --from=deps /app/slice/node_modules ./node_modules
COPY slice/package.json slice/tsconfig.json ./
COPY slice/src ./src
COPY slice/migrations ./migrations
COPY slice/scripts ./scripts
COPY box/postgresql.conf /etc/postgresql/box.conf
COPY box/initdb.sql /docker-entrypoint-initdb.d/00-extensions.sql
COPY box/entrypoint.sh /usr/local/bin/box-entrypoint.sh
ENV NODE_ENV=production PORT=3000 PG_POOL_SIZE=10
EXPOSE 3000 5432
ENTRYPOINT ["box-entrypoint.sh"]
