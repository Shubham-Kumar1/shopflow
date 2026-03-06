FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY package.json ./
USER app
EXPOSE 4001
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:4001/health || exit 1
CMD ["node", "src/index.js"]
