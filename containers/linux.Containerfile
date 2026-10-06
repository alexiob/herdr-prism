# Actual Linux runtime gates; platform is selected by Podman's Linux VM.
ARG RUST_IMAGE=docker.io/library/rust:1.90.0-slim-bookworm
ARG NODE_IMAGE=docker.io/library/node:24-bookworm
FROM ${RUST_IMAGE} AS rust
FROM ${NODE_IMAGE}
COPY --from=rust /usr/local/cargo /usr/local/cargo
COPY --from=rust /usr/local/rustup /usr/local/rustup
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends python3 git procps ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . /app
RUN npm ci && rustup component add rust-docs && cargo test --locked --offline --manifest-path native/sampler/Cargo.toml && node native/sampler/package.mjs && npm run build
ENV HAT_SOCKET_TESTS=1 HAT_REQUIRE_NATIVE=1 HAT_PTY_TESTS=1
CMD ["bash", "scripts/linux-container-test.sh"]
