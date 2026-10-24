FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install --no-install-recommends -y ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci
COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix backend ci

COPY . .
ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install --no-install-recommends -y ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/scripts/start.mjs ./scripts/start.mjs
COPY --chown=node:node --from=build /app/scripts/start-production.mjs ./scripts/start-production.mjs
COPY --chown=node:node --from=build /app/backend/package.json ./backend/package.json
COPY --chown=node:node --from=build /app/backend/node_modules ./backend/node_modules
COPY --chown=node:node --from=build /app/backend/dist ./backend/dist
COPY --chown=node:node --from=build /app/backend/prisma ./backend/prisma
COPY --chown=node:node --from=build /app/backend/src/adventure/topics.ts ./backend/src/adventure/topics.ts
COPY --chown=node:node --from=build /app/dist ./dist

USER node
EXPOSE 3000
CMD ["npm", "start"]
