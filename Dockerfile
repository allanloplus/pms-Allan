FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
# 資料目錄交給非 root 的 node 帳號;掛上的具名磁碟區會沿用這個擁有者
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3300
CMD ["node", "server.js"]
