# Node >= 22.18 runs .ts files directly (type stripping), so there is no build step.
FROM node:22-alpine
WORKDIR /app/slice
COPY slice/package.json slice/package-lock.json ./
RUN npm ci --omit=dev
COPY slice/tsconfig.json ./
COPY slice/src ./src
COPY slice/migrations ./migrations
COPY slice/scripts ./scripts
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "src/server.ts"]
