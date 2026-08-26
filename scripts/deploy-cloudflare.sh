#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# GenZTV — Cloudflare D1 deployment helper
# ═══════════════════════════════════════════════════════════════════
# Usage:
#   ./scripts/deploy-cloudflare.sh setup   # First-time: create D1 + DB schema
#   ./scripts/deploy-cloudflare.sh build   # Build for Cloudflare
#   ./scripts/deploy-cloudflare.sh deploy  # Deploy to Cloudflare Workers
#   ./scripts/deploy-cloudflare.sh migrate # Apply schema changes to D1
#   ./scripts/deploy-cloudflare.sh dev     # Local dev with wrangler D1 sim
#
# Prerequisites:
#   1. Install wrangler: bun add -g wrangler  (or use local `bunx wrangler`)
#   2. Login:        wrangler login
#   3. Replace REPLACE_WITH_YOUR_D1_DATABASE_ID in wrangler.jsonc (after `setup`)
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

cd "$(dirname "$0")/.."

CMD="${1:-help}"

case "$CMD" in
  setup)
    echo "📦 Creating Cloudflare D1 database 'genztv'..."
    bunx wrangler d1 create genztv
    echo ""
    echo "✅ D1 database created. Copy the 'database_id' from the output above"
    echo "   and paste it into wrangler.jsonc (replace REPLACE_WITH_YOUR_D1_DATABASE_ID)."
    echo ""
    echo "📦 Applying initial schema to D1 (remote)..."
    bunx prisma migrate diff \
      --from-empty \
      --to-schema-datamodel prisma/schema.prisma \
      --script > /tmp/genztv-migration.sql
    bunx wrangler d1 execute genztv --remote --file=/tmp/genztv-migration.sql
    echo "✅ Schema applied to remote D1."
    ;;
  migrate)
    echo "📦 Generating migration SQL from current Prisma schema..."
    bunx prisma migrate diff \
      --from-schema-datasource prisma/schema.prisma \
      --to-schema-datamodel prisma/schema.prisma \
      --script > /tmp/genztv-drift.sql || true
    if [ -s /tmp/genztv-drift.sql ]; then
      echo "📦 Applying drift migration to remote D1..."
      bunx wrangler d1 execute genztv --remote --file=/tmp/genztv-drift.sql
      echo "✅ D1 schema synced."
    else
      echo "✅ D1 schema already in sync."
    fi
    ;;
  build)
    echo "🏗️  Building Next.js for Cloudflare Workers (OpenNext)..."
    bunx opennextjs-cloudflare build
    echo "✅ Build complete. Output: .open-next/"
    ;;
  deploy)
    echo "🚀 Deploying to Cloudflare Workers..."
    bunx wrangler deploy
    echo "✅ Deployed."
    ;;
  dev)
    echo "🏃 Starting local dev with Cloudflare context (D1 simulator)..."
    echo "   This runs `next dev` with @opennextjs/cloudflare's local proxy."
    echo "   D1 binding 'DB' will be a local SQLite file (.wrangler/state/)."
    bun run dev
    ;;
  *)
    cat <<EOF
GenZTV Cloudflare D1 deployment script

Usage: $0 <command>

Commands:
  setup    Create D1 database + apply initial schema (run once)
  migrate  Apply schema drift to existing D1 (run after schema.prisma changes)
  build    Build the app for Cloudflare Workers via OpenNext
  deploy   Deploy the built app to Cloudflare Workers
  dev      Local dev with D1 simulator (uses standard \`next dev\`)

Prerequisites:
  - Cloudflare account + wrangler login
  - wrangler.jsonc configured with your D1 database_id

Typical first deploy:
  $0 setup
  $0 build
  $0 deploy
EOF
    ;;
esac
