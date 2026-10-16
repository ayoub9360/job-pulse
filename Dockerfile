FROM node:24-alpine AS build
WORKDIR /app
RUN npm install --global pnpm@10.34.7
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM node:24-alpine AS runtime
RUN apk add --no-cache curl && npm install --global pnpm@10.34.7
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
COPY config/config.example.yaml ./config/config.example.yaml
RUN mkdir -p data && chown node:node data
USER node
CMD ["node", "dist/main.js"]
