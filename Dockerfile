# Multi-stage build: install once at the root (npm workspaces), build the frontend,
# build the backend, then ship a slim runtime image with just the backend's compiled
# output + the frontend's static assets. Single Railway service — see DESIGN.md section 7.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/backend/package.json packages/backend/package.json
COPY packages/frontend/package.json packages/frontend/package.json
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build:frontend
RUN npm run build:backend
# Backend serves the frontend's built assets from packages/backend/public.
RUN cp -r packages/frontend/dist packages/backend/public

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/backend/package.json packages/backend/package.json
RUN npm ci --omit=dev --workspace packages/backend
COPY --from=build /app/packages/backend/dist packages/backend/dist
COPY --from=build /app/packages/backend/public packages/backend/public
COPY --from=build /app/packages/backend/src/db/migrations packages/backend/dist/db/migrations

EXPOSE 3000
CMD ["node", "packages/backend/dist/index.js"]
