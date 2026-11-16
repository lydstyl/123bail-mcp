# Smithery / generic Docker image — starts the STDIO MCP server
FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc --noEmit && npm run build

CMD ["node", "dist/index.js"]
