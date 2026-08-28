# 📺 GenZTV — Premium Live Streaming Platform

প্রিমিয়াম লাইভ স্ট্রিমিং প্ল্যাটফর্ম — বিশ্বের বিভিন্ন দেশের লাইভ টিভি চ্যানেল, স্পোর্টস স্ট্রিম ও ম্যাচ দেখার জন্য। Cloudflare Workers + D1 (SQLite) এ deploy করার জন্য রেডি।

## ✨ Features

- 📺 ৯৪+ লাইভ চ্যানেল (tv.jsssbd.com থেকে কালেক্টেড)
- 🎬 HLS প্লেব্যাক — ৫ ধরনের প্লেয়ার (Direct / Proxy / JW / MPEG-TS / iFrame)
- ⚽ স্পোর্টস ম্যাচ ট্র্যাকিং ও লাইভ নোটিফিকেশন
- 🔐 ক্লায়েন্ট-সাইড সিকিউরিটি (DevTools ব্লক, anti-debugging) — admin থেকে ON/OFF
- 📱 PWA + APK ডাউনলোড
- 🌐 বাংলা/ইংরেজি সাপোর্ট
- 🎛️ অ্যাডমিন প্যানেল (Channels / Matches / Settings / Data)

## 🛠️ Tech Stack

- **Framework**: Next.js 16 (App Router) + TypeScript 5
- **Styling**: Tailwind CSS 4 + shadcn/ui (New York style)
- **Database**: Prisma ORM (SQLite local dev, **Cloudflare D1** production)
- **State**: Zustand (client) + TanStack Query (server)
- **Player**: hls.js, mpegts.js
- **Deploy**: Cloudflare Workers (via `@opennextjs/cloudflare`)

## 📦 Local Development

### Prerequisites
- Node.js 20+ অথবা Bun
- Cloudflare account (production deploy এর জন্য)

### Setup

```bash
# ১. Dependencies install
bun install
# অথবা: npm install

# ২. Environment variables
cp .env.example .env
# .env খুলে ADMIN_PASSWORD পরিবর্তন করুন

# ৩. Database schema apply (local SQLite)
bun run db:push

# ৪. Dev server চালু
bun run dev
# অথবা: npm run dev
```

App চলবে `http://localhost:3000` এ।

### Admin Panel Access

- URL: `http://localhost:3000/#/admin`
- Password: `.env` এ যা সেট করা আছে (ডিফল্ট: `Ronnie7700`)

## ☁️ Cloudflare Deployment

এই প্রজেক্ট Cloudflare Workers + D1 তে deploy করার জন্য রেডি।

### Prerequisites

1. [Cloudflare account](https://dash.cloudflare.com/sign-up) (ফ্রি tier এ যথেষ্ট)
2. `wrangler` CLI login:
   ```bash
   npx wrangler login
   ```

### Step-by-step Deploy

#### ১. D1 Database তৈরি + Schema Apply

```bash
bun run cf:setup
```

এই কমান্ড:
- `genztv` নামে নতুন D1 database তৈরি করবে
- Schema সরাসরি D1 এ apply করবে
- একটি `database_id` রিটার্ন করবে

**গুরুত্বপূর্ণ:** `wrangler.jsonc` ফাইলে `database_id` আপডেট করুন (যেখানে `REPLACE_WITH_YOUR_D1_DATABASE_ID` লেখা):

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "genztv",
    "database_id": "<paste-your-id-here>",
    "migrations_dir": "prisma/migrations-d1"
  }
]
```

#### ২. Production Secrets সেট করুন

`wrangler.jsonc` এর `vars` ব্লকে পাসওয়ার্ড পরিবর্তন করুন:

```jsonc
"vars": {
  "CF_DEPLOY": "true",
  "ADMIN_PASSWORD": "your-strong-password-here",
  "NEXTAUTH_SECRET": "your-random-secret"
}
```

অথবা Cloudflare dashboard থেকে সেট করুন:
- Workers & Pages → genztv → Settings → Variables

#### ৩. Build + Deploy

দুটো উপায় আছে — **CLI দিয়ে** অথবা **Cloudflare Pages direct git integration** দিয়ে।

##### উপায় ১: CLI দিয়ে (Workers deploy)

```bash
# Build OpenNext output
bun run cf:build

# Deploy to Cloudflare Workers
bun run cf:deploy
```

Deploy সফল হলে একটি URL পাবেন: `https://genztv.<your-subdomain>.workers.dev`

##### উপায় ২: Cloudflare Pages direct git integration (recommended)

GitHub-এ push করার পর Cloudflare Pages-এ automatic deploy সেট আপ করুন:

1. Cloudflare Dashboard → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
2. GitHub repository সিলেক্ট করুন
3. Build settings:
   - **Framework preset:** `Next.js` (অথবা None)
   - **Build command:** `npm run build:cf`
   - **Build output directory:** `.open-next`
   - **Root directory:** `/` (default)
4. **Environment variables** যোগ করুন (Settings → Environment variables):
   - `CF_DEPLOY` = `true`
   - `ADMIN_PASSWORD` = `your-strong-password`
   - `NEXTAUTH_SECRET` = `your-random-secret`
   - `DATABASE_URL` = (empty — D1 binding ব্যবহার হবে)
5. **D1 database binding** যোগ করুন (Settings → Functions → D1 database bindings):
   - **Variable name:** `DB`
   - **D1 database:** `genztv` (Step 1 এ তৈরি করা)
6. **Save and Deploy** ক্লিক করুন

> ⚠️ **গুরুত্বপূর্ণ:** `database_id` যদি `wrangler.jsonc` এ সেট করা থাকে, তাহলে Pages direct git integration-এ ওই একই D1 database ব্যবহার করুন।

#### ৪. Custom Domain (Optional)

Cloudflare dashboard:
- Workers & Pages → genztv → Settings → Triggers → Custom Domains
- আপনার domain যোগ করুন

### 🔍 D1 Schema Apply (গুরুত্বপূর্ণ!)

Deploy এর পর যদি admin panel-এ চ্যানেল/ম্যাচ অ্যাড করতে error আসে, তাহলে **D1 ডাটাবেসে schema apply হয়নি**। এটি ঠিক করতে হবে।

#### উপায় ১: Local থেকে wrangler দিয়ে (recommended)

```bash
# wrangler login করা থাকলে
bun run cf:schema
# অথবা: npx wrangler d1 execute genztv --remote --file=prisma/d1-schema.sql
```

#### উপায় ২: Cloudflare dashboard থেকে

1. Cloudflare Dashboard → **Workers & Pages** → **D1**
2. `genztv` ডাটাবেসে ক্লিক করুন
3. **Query** tab এ যান
4. `prisma/d1-schema.sql` ফাইলের পুরো content copy করে paste করুন
5. **Execute** ক্লিক করুন

#### Verify করুন

Browser এ গিয়ে এই URL খুলুন:
```
https://your-app-url.workers.dev/api/db-health
```

সব ঠিক থাকলে এরকম দেখাবে:
```json
{
  "checks": {
    "env_CF_DEPLOY": "true",
    "db_client_init": "OK",
    "tables": {
      "channel": "OK (0 rows)",
      "match": "OK (0 rows)",
      "category": "OK (0 rows)",
      "appSetting": "OK (1 rows)"
    },
    "summary": "ALL TABLES OK"
  }
}
```

### 🚨 Troubleshooting

#### সমস্যা ১: "no such table: Channel" / চ্যানেল অ্যাড করা যাচ্ছে না

**কারণ:** D1 তে schema apply হয়নি।

**সমাধান:** উপরের "D1 Schema Apply" section ফলো করুন।

#### সমস্যা ২: `/api/db-health` এ `env_CF_DEPLOY: "NOT SET"` দেখাচ্ছে

**কারণ:** Cloudflare Pages এ `CF_DEPLOY` env var সেট হয়নি।

**সমাধান:**
1. Cloudflare Dashboard → Workers & Pages → genztv → **Settings** → **Environment variables**
2. `CF_DEPLOY` = `true` যোগ করুন
3. Redeploy করুন

#### সমস্যা ৩: `db_client_init: FAILED` — D1 binding missing

**কারণ:** D1 binding "DB" সেট হয়নি।

**সমাধান:**
1. Cloudflare Dashboard → Workers & Pages → genztv → **Settings** → **Functions** → **D1 database bindings**
2. **Variable name:** `DB`, **D1 database:** `genztv` সেট করুন
3. Redeploy করুন

#### সমস্যা ৪: Build error

Build log এ যদি error আসে, নিচের ফাইলগুলো ঠিক আছে কিনা চেক করুন:
- `package.json` — `build:cf` script আছে কিনা
- `open-next.config.ts` — `proxyExternalRequest: "fetch"` আছে কিনা
- `src/middleware.ts` — `runtime = 'experimental-edge'` আছে কিনা

### Schema আপডেট (পরবর্তীতে)

যদি `prisma/schema.prisma` পরিবর্তন করেন:

```bash
# Local dev এ apply
bun run db:push

# D1 এ apply (schema.sql regenerate + apply)
bun run cf:migrate

# Re-deploy
bun run cf:build && bun run cf:deploy
```

## 🗄️ Database Schema

মূল মডেল (Prisma schema — `prisma/schema.prisma`):

| Model | কাজ |
|-------|-----|
| `Channel` | লাইভ চ্যানেল (name, streamType, streamUrl, logo, category, ...) |
| `Match` | স্পোর্টস ম্যাচ (teamA, teamB, league, startTime, status) |
| `MatchStream` | ম্যাচের সাথে যুক্ত স্ট্রিম |
| `Category` | চ্যানেল ক্যাটাগরি |
| `AppSetting` | গ্লোবাল সেটিংস (singleton, id="app") |
| `Feedback` | ইউজার ফিডব্যাক |
| `PageView` / `DailyStat` / `VisitorSession` | অ্যানালিটিক্স |
| `PushSubscription` | ওয়েব পুশ সাবস্ক্রাইবার |
| `Notice` / `AppNotification` | নোটিফিকেশন |

## 🎬 Player System

| streamType | প্লেয়ার | ব্যবহার |
|------------|---------|---------|
| `m3u` | hls-player | Legacy auto-fallback |
| `m3u8_direct` | direct-hls-player | CORS-open, low-latency |
| `m3u8_proxy` | proxy-hls-player | CORS/Referer bypass |
| `m3u8_jw` | jw-hls-player | JW Player |
| `mpegts` | ts-player | MPEG-TS (.ts) স্ট্রিম |
| `iframe` | iframe-player | এম্বেড URL |

## 📂 Project Structure

```
├── prisma/
│   └── schema.prisma          # Database schema (SQLite/D1)
├── public/
│   ├── uploads/               # APK file
│   ├── manifest.json          # PWA manifest
│   ├── sw.js                  # Service worker
│   └── notif-worker.js        # Push notification worker
├── scripts/
│   ├── deploy-cloudflare.sh   # D1 deploy helper
│   ├── import-jsss.ts         # JSSS চ্যানেল ইম্পোর্ট
│   └── ...                    # Channel/match utility scripts
├── src/
│   ├── app/
│   │   ├── api/               # ৪০+ API routes
│   │   ├── layout.tsx
│   │   ├── page.tsx           # একমাত্র route (lazy loads AppShell)
│   │   └── globals.css
│   ├── components/
│   │   ├── layout/            # AppShell, top-nav, sidebar, bottom-nav
│   │   ├── player/            # HLS/MPEG-TS/iFrame প্লেয়ার
│   │   ├── providers/         # Theme + Security providers
│   │   ├── ads/               # বিজ্ঞাপন কম্পোনেন্ট
│   │   └── ui/                # shadcn/ui components
│   ├── lib/
│   │   ├── db.ts              # Hybrid Prisma client (local SQLite / D1)
│   │   ├── auth.ts            # Admin auth helpers
│   │   ├── api.ts             # Frontend API client
│   │   ├── store.ts           # Zustand global store
│   │   └── ...
│   └── views/                 # Page views (home, live, admin, ...)
├── next.config.ts
├── open-next.config.ts        # OpenNext (Cloudflare) config
├── wrangler.jsonc             # Cloudflare Workers + D1 config
├── package.json
└── .env.example
```

## 🎛️ Admin Panel

শুধু ৪টি পেজ:

1. **Channels** — চ্যানেল CRUD, IPTV/File import, streamType selector
2. **Matches** — ম্যাচ CRUD, MatchStream যোগ, status sync
3. **Settings** — অ্যাপ সেটিংস, ads, security toggle, APK upload
4. **Data** — ডেটা export/import, hosting guide

## ⚠️ Important Notes

### Web Push Notifications
বর্তমানে **disabled** (stub implementation)। `web-push` npm package Node crypto ব্যবহার করে যা Cloudflare Workers-এ আংশিক কাজ করে। Enable করতে হলে:
1. VAPID keys জেনারেট করুন: `bunx web-push generate-vapid-keys`
2. `wrangler.jsonc` vars এ `VAPID_PUBLIC_KEY` ও `VAPID_PRIVATE_KEY` সেট করুন
3. `src/lib/push.ts` এ Web Crypto API দিয়ে implementation করুন

### Cloudflare Workers Limits
- CPU time: 10ms (ফ্রি) / 30s (পেইড) per request
- Memory: 128 MB
- D1 row reads: 5M/day (ফ্রি), 25B/day (পেইড)
- অ্যানালিটিক্স cleanup cron কাজ করবে না (Workers-এ cron আলাদা)

### Cloudflare Pages vs Workers
এই প্রজেক্ট **Cloudflare Workers** (Static Assets সহ) এ deploy হয়, Pages এ নয়। কারণ:
- Next.js 16 এর জন্য Cloudflare Workers বর্তমান recommendation
- Pages deprecated হচ্ছে
- একই feature পাবেন (custom domain, SSL, CDN, সব)

## 📜 Scripts Reference

| Command | কাজ |
|---------|-----|
| `bun run dev` | Local dev server (port 3000) |
| `bun run build` | Next.js standalone build |
| `bun run lint` | ESLint check |
| `bun run db:push` | Prisma schema → local SQLite |
| `bun run db:generate` | Prisma client regenerate |
| `bun run cf:setup` | D1 database তৈরি + schema apply (one-time) |
| `bun run cf:migrate` | Schema drift D1 এ apply |
| `bun run cf:build` | OpenNext build for Cloudflare |
| `bun run cf:deploy` | Deploy to Cloudflare Workers |

## 📄 License

Private project.

---

**Built with ❤️ for GenZ TV**
