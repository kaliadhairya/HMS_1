#!/bin/sh
# Wait for PostgreSQL DB to be reachable, then start app
echo "⏳ Connecting to PostgreSQL DB at ${DB_HOST}:${DB_PORT}/${DB_NAME}..."

MAX_RETRIES=20
RETRY=0

until node -e "
  require('dotenv').config();
  const { Client } = require('pg');
  (async () => {
    const client = new Client({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'hms',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    });
    try {
      await client.connect();
      await client.end();
      process.exit(0);
    } catch (e) {
      process.exit(1);
    }
  })();
" 2>/dev/null; do
  RETRY=$((RETRY + 1))
  if [ $RETRY -ge $MAX_RETRIES ]; then
    echo "❌ Cannot reach PostgreSQL DB after $MAX_RETRIES attempts. Check DB_HOST and network."
    exit 1
  fi
  echo "  Attempt $RETRY/$MAX_RETRIES — retrying in 3s..."
  sleep 3
done

echo "✅ PostgreSQL DB is reachable!"

# Run database setup & seeding automatically if needed
echo "⚙️ Running database initialization..."
node init_database.js || true

# Start the application
echo "🚀 Starting HMS Backend..."
exec node server.js
