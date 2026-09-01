#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# GenZTV — Cloudflare D1 deployment helper (raw SQL, no Prisma)
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."
CMD="${1:-help}"

case "$CMD" in
  schema)
    echo "📦 Applying schema to D1 (remote)..."
    npx wrangler d1 execute genztv --remote --file=prisma/d1-schema.sql
    echo "✅ Schema applied to remote D1."
    ;;
  build)
    echo "🏗️  Building for Cloudflare Workers (OpenNext)..."
    npx opennextjs-cloudflare build
    echo "✅ Build complete. Output: .open-next/"
    ;;
  deploy)
    echo "🚀 Deploying to Cloudflare Workers..."
    npx wrangler deploy
    echo "✅ Deployed."
    ;;
  dev)
    echo "🏃 Starting local dev..."
    bun run dev
    ;;
  *)
    cat <<EOF
GenZTV Cloudflare D1 deployment script (raw SQL, no Prisma)

Usage: $0 <command>

Commands:
  schema   Apply prisma/d1-schema.sql to remote D1 (run if tables are missing)
  build    Build the app for Cloudflare Workers via OpenNext
  deploy   Deploy the built app to Cloudflare Workers
  dev      Local dev server

Typical first deploy:
  $0 schema    # apply D1 schema
  $0 build     # build
  $0 deploy    # deploy
EOF
    ;;
esac
