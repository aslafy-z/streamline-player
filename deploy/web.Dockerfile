# syntax=docker/dockerfile:1.29

# The web player's image: `docker build -f deploy/web.Dockerfile .` from the
# repository root.
#
# Point it at Streamline by mounting /web/config.json:
#   { "streamline": "https://streamline.example.com" }
# Without it, the player expects Streamline on its own origin.
#
# Base images are pinned by digest. Refresh one with
# `docker buildx imagetools inspect <image>:<tag> --format '{{.Manifest.Digest}}'`.

FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app

# package.json's packageManager version. Node ships no corepack from 25 on, so
# pnpm comes from npm.
ARG PNPM_VERSION=12.9.0
RUN npm install -g --allow-scripts=pnpm pnpm@${PNPM_VERSION}

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY vite.config.ts tsconfig.json ./
COPY project.inlang/settings.json project.inlang/
COPY messages/ messages/
COPY static/ static/
COPY src/ src/
RUN pnpm build

FROM joseluisq/static-web-server:2.44.1@sha256:94618e3d17802265a21926217e6f9e7832b311b6fbf5933684001739fafed06a
COPY --from=build /app/build /web
COPY deploy/web.sws.toml /etc/sws.toml
ARG VERSION=dev
# title, url and vendor would otherwise be the base image's: static-web-server's own.
LABEL org.opencontainers.image.title="Streamline Player (web)" \
      org.opencontainers.image.url=https://github.com/Streamline-HQ/streamline-player \
      org.opencontainers.image.vendor=Streamline-HQ \
      org.opencontainers.image.source=https://github.com/Streamline-HQ/streamline-player \
      org.opencontainers.image.description="Streamline's web player" \
      org.opencontainers.image.version=${VERSION}
ENV SERVER_PORT=8080 \
    SERVER_ROOT=/web \
    SERVER_FALLBACK_PAGE=/web/index.html \
    SERVER_CONFIG_FILE=/etc/sws.toml \
    SERVER_HEALTH=true
USER 1000:1000
EXPOSE 8080
