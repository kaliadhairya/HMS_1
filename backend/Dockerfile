FROM node:24-bookworm-slim

WORKDIR /app

# Copy dependency definitions and install production packages
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source
COPY . .

ENV NODE_ENV=production
ENV PORT=5001
EXPOSE 5001

RUN sed -i 's/\r$//' startup.sh docker-entrypoint.sh && chmod +x startup.sh docker-entrypoint.sh \
  && mkdir -p uploads audit-checkpoints private-documents && chown node:node uploads audit-checkpoints private-documents
# Runs as the unprivileged "node" user (docker-entrypoint.sh drops root after fixing volume owners).
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["sh", "startup.sh"]
