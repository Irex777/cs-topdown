FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
ENV NODE_OPTIONS=--max-old-space-size=512
CMD ["node", "server.js"]
