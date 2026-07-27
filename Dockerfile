FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node index.js ./
COPY --chown=node:node src ./src

USER node

EXPOSE 8080

CMD ["npm", "start"]
