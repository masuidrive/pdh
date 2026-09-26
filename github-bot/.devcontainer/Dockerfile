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
RUN curl -fsSL https://claude.ai/install.sh | bash

# Install Codex CLI (alternative engine, selected via CODING_ROBOT_ENGINE=codex)
RUN npm install -g @openai/codex

# Add ~/.local/bin to PATH for Claude CLI
ENV PATH="/home/node/.local/bin:${PATH}"

WORKDIR /workspaces
