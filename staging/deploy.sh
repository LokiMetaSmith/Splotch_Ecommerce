#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

echo "🚚 Starting staging deployment..."

# --- Build Frontend ---
echo "📦 Building frontend assets..."
# Copy package files to ensure we can run npm install
cp package.json ./staging/
cp package-lock.json ./staging/
# Install dependencies and build
(cd staging && npm install && npm run build)

# --- Deploy Frontend ---
echo "🖼️  Deploying frontend..."
# Clear old assets
rm -rf staging/www/*
# Copy new assets
cp -r dist/* staging/www/

# --- Deploy Backend ---
echo "⚙️  Deploying backend..."
# Copy server files
# We don't want to overwrite the .env file or node_modules
rsync -av --exclude 'node_modules' --exclude '.env' --exclude 'db.json' --exclude 'db.staging.json' server/ staging/server/

# --- Start Staging Environment ---
echo "🚀 Starting staging environment with Docker Compose..."
(cd staging && docker-compose up -d --build)

echo "✅ Staging deployment complete!"
echo "   Frontend available at http://localhost:8080"
echo "   Backend available at http://localhost:3000"
