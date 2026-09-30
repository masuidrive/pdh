# Use official devcontainer base image with TypeScript and Node.js pre-configured
# This image is optimized for VS Code devcontainer development
FROM mcr.microsoft.com/devcontainers/typescript-node:22-bookworm

# compose 直接起動でも runner の依存を満たす（features は適用されない）。
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git gh jq python3 \
    && rm -rf /var/lib/apt/lists/*

# Switch to node user (default non-root user in this devcontainer image)
USER node

# Install Claude Code CLI as node user using curl
# CLI_REFRESH は焼き直すたびに変わる（devcontainer-prebuild.yml）。cacheFrom で下の 2 行が古いまま使い回されないようにする
ARG CLI_REFRESH=""
RUN echo "cli refresh: ${CLI_REFRESH}" && curl -fsSL https://claude.ai/install.sh | bash

# Install Codex CLI (alternative engine, selected via CODING_BOT_ENGINE=codex)
RUN echo "cli refresh: ${CLI_REFRESH}" && npm install -g @openai/codex@latest

# Add ~/.local/bin to PATH for Claude CLI
ENV PATH="/home/node/.local/bin:${PATH}"

WORKDIR /workspaces
