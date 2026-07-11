# War Room standalone server — container image for the NEXUS deploy (M2).
#
# SECURITY MODEL (tailnet-only, non-negotiable):
#   - The container publishes 3141 to 127.0.0.1 on the HOST only
#     (see .planning/runbooks/nexus-war-room-deploy.sh: -p 127.0.0.1:3141:3141).
#   - Caddy on the Tailscale listener (nexus.tail722a2e.ts.net) is the ONLY
#     ingress. Never attach this to the public funnel.
#   - POST /api/hooks/:providerId requires Authorization: Bearer $WAR_ROOM_TOKEN.
#
# Runtime env (supplied via --env-file, never baked into the image):
#   WAR_ROOM_TOKEN    stable bearer token for the hook ingest path
#   WAR_ROOM_MACHINE  TEXT label for agents local to this server (e.g. NEXUS)

# Overridable for hosts with broken Docker Hub auth:
#   --build-arg BASE_IMAGE=public.ecr.aws/docker/library/node:22-alpine
ARG BASE_IMAGE=node:22-alpine

FROM ${BASE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY webview-ui/package.json webview-ui/package.json
COPY webview-v3/package.json webview-v3/package.json
# --ignore-scripts: skips husky "prepare" (no .git in the build context).
# esbuild/vite binaries ship as platform optionalDependencies, no scripts needed.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM ${BASE_IMAGE}
# Deploy identity for GET /api/version — passed by the deploy runbook
# (the rsync'd build context has no .git to derive a SHA from).
ARG GIT_SHA=unknown
ARG BUILT_AT=unknown
ENV NODE_ENV=production
ENV GIT_SHA=${GIT_SHA}
ENV BUILT_AT=${BUILT_AT}
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY webview-ui/package.json webview-ui/package.json
# dist/cli.js externalizes fastify/@fastify/* (see esbuild.js) — install prod deps.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3141
ENTRYPOINT ["docker-entrypoint.sh"]
