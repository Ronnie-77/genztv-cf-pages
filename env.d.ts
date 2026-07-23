// env.d.ts — Cloudflare Pages bindings type definitions for @opennextjs/cloudflare
interface CloudflareEnv {
  DB: D1Database
  ADMIN_PASSWORD: string
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  CRON_SECRET: string
}

declare module '@opennextjs/cloudflare' {
  export function getCloudflareContext(): Promise<{
    env: CloudflareEnv
    ctx: ExecutionContext
    cf: IncomingRequestCfProperties
  }>
}
