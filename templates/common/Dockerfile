# ================================================================
# STAGE 1 — Builder
# ================================================================
FROM node:20-slim AS builder

WORKDIR /app

# build-essential is required for native Titan extensions (C++ or Rust based)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

# Install with optional dependencies so it grabs the correct engine for the Linux builder
RUN npm install --include=optional

# ------------------------------------------------
# Extract Titan Extensions (packages with titan.json)
# ------------------------------------------------
RUN mkdir -p /app/.ext && \
    find node_modules -mindepth 2 -maxdepth 3 -type f -name "titan.json" | while read file; do \
    pkg_dir=$(dirname "$file"); \
    pkg_name=$(basename "$pkg_dir"); \
    echo "Extracting Titan extension: $pkg_name"; \
    cp -a "$pkg_dir" "/app/.ext/$pkg_name"; \
    rm -rf "/app/.ext/$pkg_name/node_modules"; \
    done

# ------------------------------------------------
# Copy ANY installed Titan Engine (Architecture agnostic)
# ------------------------------------------------
RUN mkdir -p /app/.ext/@titanpl && \
    cp -r node_modules/@titanpl/engine-linux-* /app/.ext/@titanpl/

COPY . .

# Run the Titan build step
RUN npx titan build


# ================================================================
# STAGE 2 — Runtime (Optimized Pure Engine)
# ================================================================
FROM ubuntu:24.04

# Use an unprivileged user for security
RUN groupadd -r titan && useradd -r -g titan titan

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# copy dist contents into /app/dist
COPY --from=builder /app/dist/ ./dist/

# titan extensions + engine
COPY --from=builder /app/.ext ./.ext

# runtime assets
COPY --from=builder /app/package.json ./package.json

# ---------------- OPTIONAL APP FOLDERS ----------------
# Static assets
# COPY --from=builder /app/app/static ./static

# Public assets
# COPY --from=builder /app/app/public ./public

# DB
# COPY --from=builder /app/app/db ./db

# CRITICAL SYSTEM SETUP:
# 1. Mandatory .env file (Engine requires it for config parsing)
# 2. Node modules symlink for extension JS dependency resolution
RUN echo "TITAN_DEV=0" > .env && \
    ln -s /app/.ext /app/node_modules && \
    chown -R titan:titan /app

# Standard environment variables
ENV HOST=0.0.0.0
ENV PORT=5100
ENV TITAN_DEV=0

USER titan
EXPOSE 5100

# Health check to ensure the server is alive
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5100/ || exit 1

# DYNAMIC ENTRYPOINT: Finds the correct architecture binary and starts it
# This allows the SAME image to work on x64 vs ARM64 servers.
CMD ["/bin/sh", "-c", "exec $(find .ext/@titanpl/engine-linux-* -name titan-server -type f | head -n 1) run dist"]