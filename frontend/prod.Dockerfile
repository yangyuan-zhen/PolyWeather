FROM node:20-alpine AS runner

ENV NODE_ENV=production
WORKDIR /app/frontend

COPY public ./public
COPY .next/standalone ./
COPY .next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
