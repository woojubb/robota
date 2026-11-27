FROM node:22
WORKDIR /opt/robota
COPY robota/ ./
RUN corepack enable && corepack prepare pnpm@8.15.4 --activate && pnpm install --filter @robota-sdk/agent-framework... --filter @robota-sdk/agent-provider-openai... --frozen-lockfile --ignore-scripts
COPY worker.mts /opt/worker.mts
ENV HOME=/tmp/home PRODUCT_USER_STATE_DIR=/tmp/state
CMD ["./node_modules/.bin/tsx", "--conditions=source", "/opt/worker.mts"]
