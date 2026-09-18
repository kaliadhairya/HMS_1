# ── Stage 1: Build Frontend Assets ──
FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Production Nginx Server (Ultra-lightweight ~25MB) ──
FROM nginx:alpine-slim

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled static assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 4999

STOPSIGNAL SIGQUIT
CMD ["nginx", "-g", "daemon off;"]
