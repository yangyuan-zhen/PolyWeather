FROM node:20-alpine AS deps

WORKDIR /app/frontend
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_POLYWEATHER_API_BASE_URL
ARG NEXT_PUBLIC_POLYWEATHER_LOCAL_FULL_ACCESS

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_POLYWEATHER_API_BASE_URL=$NEXT_PUBLIC_POLYWEATHER_API_BASE_URL
ENV NEXT_PUBLIC_POLYWEATHER_LOCAL_FULL_ACCESS=$NEXT_PUBLIC_POLYWEATHER_LOCAL_FULL_ACCESS

WORKDIR /app/frontend
COPY --from=deps /app/frontend/node_modules ./node_modules
COPY . ./
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine AS runner

ENV NODE_ENV=production
WORKDIR /app/frontend

COPY --from=builder /app/frontend/public ./public
COPY --from=builder /app/frontend/.next/standalone ./
COPY --from=builder /app/frontend/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
