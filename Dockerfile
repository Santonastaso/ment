FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/
COPY client/package.json client/package-lock.json ./client/
RUN npm ci --prefix server && npm ci --prefix client
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache python3 make g++
COPY --from=builder /app/server ./server
COPY --from=builder /app/client/dist ./client/dist
WORKDIR /app/server
RUN npm rebuild better-sqlite3 && apk del python3 make g++
ENV DB_PATH=/data/ment.db
VOLUME ["/data"]
EXPOSE 3001
CMD ["node", "index.js"]
