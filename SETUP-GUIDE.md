# GenZ TV — Cloudflare Pages সেটআপ গাইড

## ১. প্রজেক্ট সেটআপ

### লোকাল ডেভেলপমেন্ট সেটআপ

1. **Node.js 18+ ইনস্টল করুন** (যদি না থাকে):
   - Download from https://nodejs.org
   - অথবা nvm ব্যবহার করুন: `nvm install 18`

2. **প্রজেক্ট ক্লোন করুন এবং dependencies ইনস্টল করুন**:
   ```bash
   git clone https://github.com/Ronnie-77/genztv-cf-pages.git
   cd genztv-cf-pages
   npm install
   ```

3. **ডাটাবেজ সেটআপ করুন** (লোকাল SQLite):
   ```bash
   npm run db:push
   ```

4. **Environment variables সেট করুন**:
   ```bash
   cp .env.example .env
   # .env ফাইলে ADMIN_PASSWORD এবং VAPID keys সেট করুন
   ```

5. **ডেভ সার্ভার চালু করুন**:
   ```bash
   npm run dev
   ```
   সার্ভার `http://localhost:3000` এ চলবে।

6. **Seed ডাটা (অপশনাল)** — ডাটাবেজে কিছু ডেমো চ্যানেল যোগ করুন:
   ```bash
   curl http://localhost:3000/api/seed
   ```

---

## ২. Cloudflare Pages ডিপ্লয়

### ধাপ ১: GitHub রিপো তৈরি

1. GitHub.com এ যান → **New repository**
2. Repository name: `genztv-cf-pages`
3. **Private** বা **Public** সিলেক্ট করুন
4. লোকাল প্রজেক্ট push করুন:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: GenZ TV for CF Pages"
   git remote add origin https://github.com/YOUR_USERNAME/genztv-cf-pages.git
   git push -u origin main
   ```

### ধাপ ২: Cloudflare Pages প্রজেক্ট তৈরি

1. **Cloudflare Dashboard** → Workers & Pages → **Create application** → Pages
2. **Connect to Git** → আপনার GitHub রিপো সিলেক্ট করুন
3. Build settings:
   - **Framework preset**: Next.js (Static)
   - **Build command**: `npm run build`
   - **Build output directory**: `.vercel/output/static`
   - **Node.js version**: 18
   - **Install command**: `npm install`

4. ⚠️ **গুরুত্বপূর্ণ**: Build command হবে:
   ```
   prisma generate && next build && npx opennextjs-cloudflare build
   ```
   Cloudflare Pages-এর বিল্ড কনফিগারেশনে এই কমান্ড ব্যবহার করুন।

### ধাপ ৩: Environment Variables সেট

Cloudflare Dashboard → Pages → Settings → Environment variables:

| Variable | Value |
|----------|-------|
| `ADMIN_PASSWORD` | আপনার পছন্দের admin password |
| `VAPID_PUBLIC_KEY` | Web Push public key |
| `VAPID_PRIVATE_KEY` | Web Push private key |
| `VAPID_SUBJECT` | `mailto:your@email.com` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push public key (same as VAPID_PUBLIC_KEY) |
| `CRON_SECRET` | র্যান্ডম স্ট্রিং (cron সুরক্ষা) |

VAPID keys জেনারেট করুন:
```bash
npx web-push generate-vapid-keys
```

### ধাপ ৪: D1 ডাটাবেজ তৈরি ও কনফিগার

(দেখুন ধারা ৩ — D1 ডাটাবেজ সেটআপ)

### ধাপ ৫: ডিপ্লয়

1. প্রথম ডিপ্লয় — Git push করলে অটো-ডিপ্লয় হবে
2. অথবা ম্যানুয়াল ডিপ্লয়:
   ```bash
   npm run build
   npm run cf-deploy
   ```

3. ডিপ্লয় URL পাবেন: `https://genztv.pages.dev`

---

## ৩. D1 ডাটাবেজ সেটআপ

### ধাপ ১: D1 ডাটাবেজ তৈরি

```bash
# Cloudflare CLI (wrangler) দিয়ে D1 ডাটাবেজ তৈরি
npx wrangler d1 create genztv-db
```

Output থেকে `database_id` কপি করুন। এটি দেখতে এমন হবে:
```
database_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```

### ধাপ ২: wrangler.toml-এ database_id আপডেট

`wrangler.toml` ফাইলে `YOUR_D1_DATABASE_ID` রিপ্লেস করুন আপনার প্রাপ্ত database_id দিয়ে:

```toml
[[d1_databases]]
binding = "DB"
database_name = "genztv-db"
database_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"  # ← আপনার ID
```

### ধাপ ৩: Schema আপলোড (ডাটাবেজ টেবিল তৈরি)

Prisma D1 adapter ব্যবহার করে ডাটাবেজ স্কিমা আপলোড করুন:

```bash
# লোকাল ডেভেলপমেন্টে স্কিমা টেস্ট করুন
npm run db:push

# D1-এ স্কিমা আপলোড — wrangler CLI দিয়ে
npx wrangler d1 execute genztv-db --file=./prisma/schema.sql
```

⚠️ **নোট**: Prisma অটো-জেনারেট `schema.sql` ফাইল তৈরি করে যখন `prisma generate` চালান। যদি ফাইল না পান, ম্যানুয়াল SQL ব্যবহার করুন:

```bash
# ম্যানুয়াল SQL আপলোড
npx wrangler d1 execute genztv-db --command="
CREATE TABLE IF NOT EXISTS Channel (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo TEXT DEFAULT '',
  category TEXT DEFAULT 'entertainment',
  streamType TEXT DEFAULT 'm3u',
  streamUrl TEXT DEFAULT '',
  ...
);
"
```

### ধাপ ৪: Seed ডাটা ইনজেক্ট

ডিপ্লয় করার পর seed API কল করুন:

```bash
curl https://your-app.pages.dev/api/seed
```

অথবা ম্যানুয়াল SQL:

```bash
npx wrangler d1 execute genztv-db --command="
INSERT INTO AppSetting (id, appName) VALUES ('app', 'GenZ TV');
"
```

---

## ৪. স্ট্রিমিং আর্কিটেকচার

### কী কী পরিবর্তন হয়েছে এবং কেন

#### Simple Proxy → Stream Multiplexer বদলে

**পূর্বে (Render/Vercel)**:
```
Viewer 1 ──→ Proxy ──→ Upstream
Viewer 2 ──→ Proxy ──→ Upstream  ← 100 viewers = 100 upstream connections!
Viewer 3 ──→ Proxy ──→ Upstream
```
Stream Multiplexer একটি upstream connection থেকে সব viewers-কে ডাটা ফান-আউট করত।

**এখন (Cloudflare Pages)**:
```
Viewer 1 ──→ Proxy ──→ Upstream  ← 1 viewer = 1 upstream connection
Viewer 2 ──→ Proxy ──→ Upstream  ← প্রত্যেক viewer নিজের connection পায়
Viewer 3 ──→ Proxy ──→ Upstream
```

**কেন?** Workers runtime ephemeral — কোনো persistent in-memory state নেই। Stream Multiplexer এবং ring buffer চালানো সম্ভব নয়।

#### সরাসরি HLS প্লেয়ার

- m3u8 manifest → proxy দিয়ে URLs rewrite হয় → browser-এ hls.js দিয়ে প্লে
- .ts segments → proxy দিয়ে direct stream
- প্রত্যেক viewer আলাদা upstream connection পায় — কিন্তু CDN caching দিয়ে segment load কমানো যায়

#### HEVC/codec fallback

- পূর্বে: FFmpeg transcoding (HEVC → H.264) চালানো যেত Render server-এ
- এখন: **FFmpeg transcoding অসম্ভব** Workers runtime-এ
- সমাধান: প্লেয়ার-এ HEVC support detect করুন → fallback message দেখান

---

## ৫. সীমাবদ্ধতা

### কী কী Cloudflare Pages-এ কাজ করবে না

| Feature | Status | Alternative |
|---------|--------|-------------|
| **Stream Multiplexer** | ❌ কাজ করবে না | প্রত্যেক viewer = নিজের upstream connection |
| **FFmpeg transcoding** | ❌ অসম্ভব | HEVC fallback message দেখান |
| **In-memory cache** | ❌ কাজ করবে না | Workers KV (optional, পরে যোগ করা যায়) |
| **Rate limiting (in-memory)** | ❌ কাজ করবে না | Cloudflare Rate Limiting rules ব্যবহার করুন |
| **Persistent WebSocket** | ❌ কাজ করবে না | Polling-based chat (REST API) |
| **web-push (ECDH)** | ⚠️ অসম্ভব হতে পারে | nodejs_compat flag-এ পার্শিয়াল support; graceful fallback |
| **NextAuth (Google login)** | ❌ কাজ করবে না | Custom admin auth (already implemented) |
| **Image optimization** | ❌ কাজ করবে না | `images: { unoptimized: true }` |

### CPU Time সীমাবদ্ধতা

- **Free tier**: 10ms CPU time per request (I/O wait কাউন্ট হয় না)
- **Paid tier (Workers Paid)**: 30ms CPU time
- **Workers Unbound**: 30 seconds CPU time (বেশি খরচ)

m3u8 manifest rewrite এবং iframe proxy HTML processing 10ms-এর মধ্যে সম্ভব — কিন্তু বড় HTML page process করতে সময় লাগতে পারে।

---

## ৬. ফ্রি টায়ার বিস্তারিত

### Cloudflare Pages Free Tier

| Metric | Limit |
|--------|-------|
| **Requests** | 100,000 / month |
| **Bandwidth** | Unlimited (free!) |
| **Builds** | 500 / month |
| **Build timeout** | 20 minutes |
| **D1 reads** | 5 million / month |
| **D1 writes** | 100,000 / month |
| **D1 storage** | 5 GB |
| **CPU time per request** | 10ms |
| **Worker size** | 1 MB |
| **Environment variables** | Unlimited |

### কখন Paid tier দরকার?

- 100K requests/month পার হলে → Workers Paid ($5/month)
- CPU time 10ms-এর বেশি দরকার হলে → Workers Unbound
- D1 writes 100K/month পার হলে → D1 Paid

---

## ৭. ক্রন সেটআপ

### কেন external cron দরকার?

Workers runtime-এ কোনো persistent timer নেই। `src/app/api/cron/sync-matches/route.ts` ম্যাচ status sync করে — এটি external cron service দিয়ে নিয়মিত কল করতে হবে।

### cron-job.org ব্যবহার করুন (ফ্রি)

1. **cron-job.org**-এ account তৈরি করুন: https://cron-job.org
2. **New cron job** তৈরি করুন:
   - URL: `https://your-app.pages.dev/api/cron/sync-matches?secret=YOUR_CRON_SECRET`
   - Schedule: Every 5 minutes (`*/5 * * * *`)
   - Method: GET
3. **CRON_SECRET** দিয়ে সুরক্ষা — `.env.example` থেকে সেট করুন

### অন্যান্য cron service

| Service | Free Tier |
|---------|-----------|
| cron-job.org | Unlimited jobs, ফ্রি |
| EasyCron | 50 jobs, ফ্রি |
| Cloudflare Workers Cron Triggers | Paid plan ($5/month) |

### অতিরিক্ত cron jobs (অপশনাল)

| Endpoint | Schedule | Description |
|----------|----------|-------------|
| `/api/cron/sync-matches?secret=XXX` | `*/5 * * * *` | ম্যাচ status sync |
| `/api/analytics/daily-reset?secret=XXX` | `0 0 * * *` | Daily analytics reset |
| `/api/analytics/cleanup?secret=XXX` | `0 3 * * *` | Old analytics cleanup |
| `/api/channels/refresh-expired?secret=XXX` | `*/30 * * * *` | Expired channel token refresh |

---

## ৮. প্রবলেম সলভিং

### সাধারণ সমস্যা এবং সমাধান

#### ❌ "getCloudflareContext is not available" error

**কারণ**: `@opennextjs/cloudflare`-এর `getCloudflareContext()` শুধু Workers runtime-এ কাজ করে। লোকাল ডেভেলপমেন্টে এটি unavailable।

**সমাধান**:
- লোকাল ডেভেলপমেন্টে `DATABASE_URL=file:./dev.db` দিয়ে regular Prisma SQLite ব্যবহার করুন
- ডিপ্লয়ড প্রজেক্টে D1 binding অটো-কাজ করবে
- `db.ts`-এ fallback logic আছে: `getCloudflareContext()` unavailable হলে regular PrismaClient ব্যবহার হবে

#### ❌ D1 ডাটাবেজ টেবিল না পাওয়া

**কারণ**: D1-এ schema আপলোড করা হয়নি।

**সমাধান**:
```bash
# Schema SQL আপলোড
npx wrangler d1 execute genztv-db --file=./prisma/schema.sql

# অথবা ম্যানুয়াল
npx wrangler d1 execute genztv-db --command="CREATE TABLE ..."
```

#### ❌ Stream proxy timeout

**কারণ**: Workers runtime 10ms CPU limit — বড় m3u8 manifest process করতে সময় বেশি লাগতে পারে।

**সমাধান**:
- m3u8 manifest সাধারণত 10ms-এর মধ্যে process হয়
- বড় manifest → Workers Paid tier (30ms) ব্যবহার করুন
- Segment proxy শুধু I/O — CPU time খুব কম

#### ❌ "web-push is not available" warning

**কারণ**: `web-push` library Node.js crypto (ECDH) ব্যবহার করে, Workers runtime-এ সম্পূর্ণ কাজ করবে না।

**সমাধান**:
- Push notification gracefully disabled (push-sender.ts fallback logic আছে)
- `VAPID_PRIVATE_KEY` empty রাখুন → push sending skip হবে
- Notification bell UI এ "Push not available" message দেখাবে

#### ❌ 100K requests exceeded

**কারণ**: Free tier 100,000 requests/month limit।

**সমাধান**:
- Workers Paid plan ($5/month) → unlimited requests
- Analytics/heartbeat requests minimize করুন
- Static assets CDN caching ব্যবহার করুন

#### ❌ বড় API response — CPU timeout

**কারণ**: `/api/data/import` (100MB backup) Workers-এ কাজ করবে না।

**সমাধান**:
- Import/export শুধু small JSON files (< 1MB)
- `bodySizeLimit: '10mb'` নেক্সট কনফিগারেশনে সেট করা আছে
- বড় ডাটা import → D1-এ সরাসরি wrangler CLI দিয়ে করুন

#### ❌ NextAuth কাজ করবে না

**কারণ**: NextAuth (Google login) Node.js dependencies ব্যবহার করে।

**সমাধান**:
- Custom admin auth ব্যবহার করুন (ইমপ্লিমেন্টেড আছে — `src/lib/auth.ts`)
- NextAuth route (`src/app/api/auth/[...nextauth]/route.ts`) ডিলিট করা আছে
- Admin login: password → signed token → cookie

---

### ডিপ্লয় করার পর চেক করুন

1. **Health check**: `https://your-app.pages.dev/api/health`
2. **Admin panel**: `https://your-app.pages.dev/#/admin`
3. **Channels list**: `https://your-app.pages.dev/api/channels`
4. **Settings**: `https://your-app.pages.dev/api/settings`

---

### আরও সাহায্য

- Cloudflare Pages Docs: https://developers.cloudflare.com/pages/
- D1 Docs: https://developers.cloudflare.com/d1/
- OpenNext for Cloudflare: https://opennext.js.org/cloudflare
- Prisma D1 Adapter: https://www.prisma.io/docs/adapter/d1

---

**Happy Streaming! 📺**
