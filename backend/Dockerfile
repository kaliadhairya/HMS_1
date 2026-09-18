FROM node:20-bookworm-slim

WORKDIR /app

# Copy dependency definitions and install production packages
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source
COPY . .

ENV NODE_ENV=production
ENV PORT=5001
EXPOSE 5001

RUN sed -i 's/\r$//' startup.sh && chmod +x startup.sh
CMD ["sh", "startup.sh"]
