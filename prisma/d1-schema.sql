-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "logo" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'entertainment',
    "streamType" TEXT NOT NULL DEFAULT 'm3u',
    "streamUrl" TEXT NOT NULL DEFAULT '',
    "githubM3uPath" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sourcePageUrl" TEXT NOT NULL DEFAULT '',
    "refreshPattern" TEXT NOT NULL DEFAULT '',
    "tokenExpiresAt" DATETIME,
    "lastRefreshedAt" DATETIME,
    "autoRefresh" BOOLEAN NOT NULL DEFAULT false,
    "refreshError" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "sport" TEXT NOT NULL DEFAULT 'football',
    "teamA" TEXT NOT NULL,
    "teamALogo" TEXT NOT NULL DEFAULT '',
    "teamB" TEXT NOT NULL,
    "teamBLogo" TEXT NOT NULL DEFAULT '',
    "league" TEXT NOT NULL DEFAULT '',
    "thumbnail" TEXT NOT NULL DEFAULT '',
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "liveNotifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MatchStream" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Stream 1',
    "channel" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'iframe',
    "url" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "MatchStream_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    "channelCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'app',
    "appName" TEXT NOT NULL DEFAULT 'GenZ TV',
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "featuredChannelId" TEXT NOT NULL DEFAULT '',
    "heroBannerText" TEXT NOT NULL DEFAULT '',
    "defaultQuality" TEXT NOT NULL DEFAULT 'auto',
    "bannerAdScript" TEXT NOT NULL DEFAULT '',
    "socialBarAdScript" TEXT NOT NULL DEFAULT '',
    "customAdScripts" TEXT NOT NULL DEFAULT '[]',
    "adsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "homeAdsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "videoAdsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "apkUrl" TEXT NOT NULL DEFAULT '',
    "ga4MeasurementId" TEXT NOT NULL DEFAULT '',
    "firebaseConfig" TEXT NOT NULL DEFAULT '{}',
    "securityEnabled" BOOLEAN NOT NULL DEFAULT true,
    "redirectAdUrl" TEXT NOT NULL DEFAULT '',
    "redirectAdEnabled" BOOLEAN NOT NULL DEFAULT false,
    "redirectAdIntervalMinutes" INTEGER NOT NULL DEFAULT 5,
    "monetagEnabled" BOOLEAN NOT NULL DEFAULT false,
    "monetagZoneId" TEXT NOT NULL DEFAULT '',
    "monetagDomain" TEXT NOT NULL DEFAULT '5gvci.com'
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL DEFAULT 'other',
    "email" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "page" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "device" TEXT NOT NULL DEFAULT '',
    "browser" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'new',
    "adminNote" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Notice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL DEFAULT 'popup',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "pushSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AppNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL DEFAULT 'notice',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sendPush" BOOLEAN NOT NULL DEFAULT false,
    "pushSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PageView" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "channelId" TEXT,
    "matchId" TEXT,
    "referrer" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',
    "device" TEXT NOT NULL DEFAULT '',
    "browser" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DailyStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "totalViews" INTEGER NOT NULL DEFAULT 0,
    "uniqueVisitors" INTEGER NOT NULL DEFAULT 0,
    "peakVisitors" INTEGER NOT NULL DEFAULT 0,
    "topPages" TEXT NOT NULL DEFAULT '{}',
    "topChannels" TEXT NOT NULL DEFAULT '{}',
    "topCountries" TEXT NOT NULL DEFAULT '{}',
    "topDevices" TEXT NOT NULL DEFAULT '{}',
    "topBrowsers" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VisitorSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "firstSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "country" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',
    "device" TEXT NOT NULL DEFAULT '',
    "browser" TEXT NOT NULL DEFAULT '',
    "currentChannelId" TEXT,
    "currentMatchId" TEXT
);

-- CreateIndex
CREATE INDEX "Channel_isActive_idx" ON "Channel"("isActive");

-- CreateIndex
CREATE INDEX "Channel_isActive_category_idx" ON "Channel"("isActive", "category");

-- CreateIndex
CREATE INDEX "Channel_autoRefresh_isActive_idx" ON "Channel"("autoRefresh", "isActive");

-- CreateIndex
CREATE INDEX "Match_status_idx" ON "Match"("status");

-- CreateIndex
CREATE INDEX "Match_status_startTime_idx" ON "Match"("status", "startTime");

-- CreateIndex
CREATE INDEX "Match_status_endTime_idx" ON "Match"("status", "endTime");

-- CreateIndex
CREATE INDEX "MatchStream_matchId_idx" ON "MatchStream"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PageView_sessionId_idx" ON "PageView"("sessionId");

-- CreateIndex
CREATE INDEX "PageView_sessionId_createdAt_idx" ON "PageView"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "PageView_createdAt_idx" ON "PageView"("createdAt");

-- CreateIndex
CREATE INDEX "PageView_channelId_idx" ON "PageView"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyStat_date_key" ON "DailyStat"("date");

-- CreateIndex
CREATE UNIQUE INDEX "VisitorSession_sessionId_key" ON "VisitorSession"("sessionId");

-- CreateIndex
CREATE INDEX "VisitorSession_lastSeen_idx" ON "VisitorSession"("lastSeen");

-- CreateIndex
CREATE INDEX "VisitorSession_currentChannelId_idx" ON "VisitorSession"("currentChannelId");

-- CreateIndex
CREATE INDEX "VisitorSession_currentMatchId_idx" ON "VisitorSession"("currentMatchId");


-- Insert default AppSetting row (singleton, id="app")
INSERT INTO "AppSetting" ("id", "appName", "logoUrl", "maintenanceMode", "featuredChannelId", "heroBannerText", "defaultQuality", "bannerAdScript", "socialBarAdScript", "customAdScripts", "adsEnabled", "homeAdsEnabled", "videoAdsEnabled", "apkUrl", "ga4MeasurementId", "firebaseConfig", "securityEnabled", "redirectAdUrl", "redirectAdEnabled", "redirectAdIntervalMinutes", "monetagEnabled", "monetagZoneId", "monetagDomain") VALUES ('app', 'GenZ TV', '', false, '', '', 'auto', '', '', '[]', true, true, true, '', '', '{}', true, '', false, 5, false, '', '5gvci.com') ON CONFLICT (id) DO NOTHING;
