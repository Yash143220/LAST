# ---- build client
FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client ./
ARG VITE_OPERATOR_NAME
ARG VITE_CONTACT_EMAIL
ENV VITE_OPERATOR_NAME=$VITE_OPERATOR_NAME VITE_CONTACT_EMAIL=$VITE_CONTACT_EMAIL
RUN npm run build

# ---- server deps
FROM node:22-alpine AS server
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

# ---- runtime
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=server /app/server/node_modules ./server/node_modules
COPY server ./server
COPY --from=client /app/client/dist ./client/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node", "server/src/index.js"]
