# Multi-stage build for tethra-sync-server (Azure Container Apps / self-host).
# From repo root:
#   docker build -f crates/sync-server/Dockerfile -t tethra-sync-server .

FROM rust:1-bookworm AS builder
WORKDIR /src
COPY . .
RUN cargo build -p tethra-sync-server --release \
    && strip target/release/tethra-sync-server

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home /data --shell /usr/sbin/nologin tethra \
    && mkdir -p /data \
    && chown tethra:tethra /data
COPY --from=builder /src/target/release/tethra-sync-server /usr/local/bin/tethra-sync-server
COPY crates/sync-server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh
ENV TETHRA_SYNC_DATA=/data \
    TETHRA_SYNC_LISTEN=0.0.0.0:8787
VOLUME ["/data"]
EXPOSE 8787
# Root only long enough to chown a mounted volume, then drop to uid 10001.
USER root
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
