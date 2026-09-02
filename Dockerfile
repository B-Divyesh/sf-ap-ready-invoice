FROM node:22-alpine AS frontend
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm install
COPY frontend ./frontend
COPY tsconfig.json ./
RUN npm run build

FROM rust:1-slim AS backend
ARG BUILD_SHA=dev
ENV BUILD_SHA=$BUILD_SHA
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libsqlite3-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock* ./
COPY migrations ./migrations
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
ARG BUILD_SHA=dev
ENV BUILD_SHA=$BUILD_SHA PORT=8080 STATIC_DIR=/app/frontend/dist
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libsqlite3-0 && rm -rf /var/lib/apt/lists/* && groupadd -r app && useradd -r -g app -d /app app && mkdir -p /app/frontend/dist /data && chown -R app:app /app /data
WORKDIR /app
COPY --from=backend /build/target/release/ap-ready-invoice /app/ap-ready-invoice
COPY --from=frontend /build/frontend/dist /app/frontend/dist
USER app
EXPOSE 8080
CMD ["/app/ap-ready-invoice"]
