-- GenZ TV — Complete D1 SQL Schema (FIXED)
-- Run this in Cloudflare Dashboard → D1 → genztv-db → Console
-- This creates ALL tables matching the Prisma schema exactly
--
-- FIXES:
--   1. DROP old tables first (so CREATE TABLE IF NOT EXISTS gets full schema)
--   2. "order" is a SQL reserved keyword → quoted as "order"
--
-- Usage: wrangler d1 execute genztv-db --file=./d1-schema.sql --remote

-- ============================================================
-- STEP 1: Drop all existing tables (clean slate)
-- ============================================================
DROP TABLE IF EXISTS ChatMessage;
DROP TABLE IF EXISTS Notice;
DROP TABLE IF EXISTS AppNotification;
DROP TABLE IF EXISTS Notification;
DROP TABLE IF EXISTS PushSubscription;
DROP TABLE IF EXISTS VisitorSession;
DROP TABLE IF EXISTS DailyStat;
DROP TABLE IF EXISTS PageView;
DROP TABLE IF EXISTS Feedback;
DROP TABLE IF EXISTS AppSetting;
DROP TABLE IF EXISTS Category;
DROP TABLE IF EXISTS MatchStream;
DROP TABLE IF EXISTS Match;
DROP TABLE IF EXISTS Channel;

-- ============================================================
-- STEP 2: Create all tables
-- ============================================================

-- Channel table
CREATE TABLE Channel (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  logo TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'entertainment',
  streamType TEXT NOT NULL DEFAULT 'm3u',
  streamUrl TEXT NOT NULL DEFAULT '',
  githubM3uPath TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  isFeatured BOOLEAN NOT NULL DEFAULT false,
  isActive BOOLEAN NOT NULL DEFAULT true,
  viewCount INTEGER NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sourcePageUrl TEXT NOT NULL DEFAULT '',
  refreshPattern TEXT NOT NULL DEFAULT '',
  tokenExpiresAt DATETIME,
  lastRefreshedAt DATETIME,
  autoRefresh BOOLEAN NOT NULL DEFAULT false,
  refreshError TEXT NOT NULL DEFAULT ''
);

CREATE INDEX Channel_isActive_idx ON Channel(isActive);
CREATE INDEX Channel_isActive_category_idx ON Channel(isActive, category);
CREATE INDEX Channel_autoRefresh_isActive_idx ON Channel(autoRefresh, isActive);

-- Match table
CREATE TABLE Match (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'football',
  teamA TEXT NOT NULL,
  teamALogo TEXT NOT NULL DEFAULT '',
  teamB TEXT NOT NULL,
  teamBLogo TEXT NOT NULL DEFAULT '',
  league TEXT NOT NULL DEFAULT '',
  thumbnail TEXT NOT NULL DEFAULT '',
  startTime DATETIME NOT NULL,
  endTime DATETIME,
  status TEXT NOT NULL DEFAULT 'upcoming',
  isFeatured BOOLEAN NOT NULL DEFAULT false,
  liveNotifiedAt DATETIME,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX Match_status_idx ON Match(status);
CREATE INDEX Match_status_startTime_idx ON Match(status, startTime);
CREATE INDEX Match_status_endTime_idx ON Match(status, endTime);

-- MatchStream table
CREATE TABLE MatchStream (
  id TEXT PRIMARY KEY NOT NULL,
  matchId TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Stream 1',
  channel TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'iframe',
  url TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (matchId) REFERENCES Match(id) ON DELETE CASCADE
);

CREATE INDEX MatchStream_matchId_idx ON MatchStream(matchId);

-- Category table
-- NOTE: "order" is a SQL reserved keyword, must be quoted
CREATE TABLE Category (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  "order" INTEGER NOT NULL DEFAULT 0,
  channelCount INTEGER NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- AppSetting table (single row, id = 'app')
CREATE TABLE AppSetting (
  id TEXT PRIMARY KEY NOT NULL DEFAULT 'app',
  appName TEXT NOT NULL DEFAULT 'GenZ TV',
  logoUrl TEXT NOT NULL DEFAULT '',
  maintenanceMode BOOLEAN NOT NULL DEFAULT false,
  featuredChannelId TEXT NOT NULL DEFAULT '',
  heroBannerText TEXT NOT NULL DEFAULT '',
  defaultQuality TEXT NOT NULL DEFAULT 'auto',
  bannerAdScript TEXT NOT NULL DEFAULT '',
  socialBarAdScript TEXT NOT NULL DEFAULT '',
  customAdScripts TEXT NOT NULL DEFAULT '[]',
  adsEnabled BOOLEAN NOT NULL DEFAULT true,
  homeAdsEnabled BOOLEAN NOT NULL DEFAULT true,
  videoAdsEnabled BOOLEAN NOT NULL DEFAULT true,
  apkUrl TEXT NOT NULL DEFAULT '',
  ga4MeasurementId TEXT NOT NULL DEFAULT '',
  firebaseConfig TEXT NOT NULL DEFAULT '{}',
  securityEnabled BOOLEAN NOT NULL DEFAULT true,
  redirectAdUrl TEXT NOT NULL DEFAULT '',
  redirectAdEnabled BOOLEAN NOT NULL DEFAULT false,
  redirectAdIntervalMinutes INTEGER NOT NULL DEFAULT 5,
  monetagEnabled BOOLEAN NOT NULL DEFAULT false,
  monetagZoneId TEXT NOT NULL DEFAULT '',
  monetagDomain TEXT NOT NULL DEFAULT '5gvci.com'
);

-- Feedback table
CREATE TABLE Feedback (
  id TEXT PRIMARY KEY NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  email TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  page TEXT NOT NULL DEFAULT '',
  userAgent TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  browser TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  adminNote TEXT NOT NULL DEFAULT '',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- PageView table
CREATE TABLE PageView (
  id TEXT PRIMARY KEY NOT NULL,
  sessionId TEXT NOT NULL,
  page TEXT NOT NULL,
  channelId TEXT,
  matchId TEXT,
  referrer TEXT NOT NULL DEFAULT '',
  userAgent TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  browser TEXT NOT NULL DEFAULT '',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX PageView_sessionId_idx ON PageView(sessionId);
CREATE INDEX PageView_sessionId_createdAt_idx ON PageView(sessionId, createdAt);
CREATE INDEX PageView_createdAt_idx ON PageView(createdAt);
CREATE INDEX PageView_channelId_idx ON PageView(channelId);

-- DailyStat table
CREATE TABLE DailyStat (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL UNIQUE,
  totalViews INTEGER NOT NULL DEFAULT 0,
  uniqueVisitors INTEGER NOT NULL DEFAULT 0,
  peakVisitors INTEGER NOT NULL DEFAULT 0,
  topPages TEXT NOT NULL DEFAULT '{}',
  topChannels TEXT NOT NULL DEFAULT '{}',
  topCountries TEXT NOT NULL DEFAULT '{}',
  topDevices TEXT NOT NULL DEFAULT '{}',
  topBrowsers TEXT NOT NULL DEFAULT '{}',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- VisitorSession table
CREATE TABLE VisitorSession (
  id TEXT PRIMARY KEY NOT NULL,
  sessionId TEXT NOT NULL UNIQUE,
  firstSeen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lastSeen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pageCount INTEGER NOT NULL DEFAULT 0,
  country TEXT NOT NULL DEFAULT '',
  userAgent TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  browser TEXT NOT NULL DEFAULT '',
  currentChannelId TEXT,
  currentMatchId TEXT
);

CREATE INDEX VisitorSession_lastSeen_idx ON VisitorSession(lastSeen);
CREATE INDEX VisitorSession_currentChannelId_idx ON VisitorSession(currentChannelId);
CREATE INDEX VisitorSession_currentMatchId_idx ON VisitorSession(currentMatchId);

-- PushSubscription table
CREATE TABLE PushSubscription (
  id TEXT PRIMARY KEY NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Notification table (for push notifications)
CREATE TABLE Notification (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'general',
  isActive BOOLEAN NOT NULL DEFAULT true,
  pushSent BOOLEAN NOT NULL DEFAULT false,
  sentCount INTEGER NOT NULL DEFAULT 0,
  failCount INTEGER NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- AppNotification table (in-app bell notifications)
CREATE TABLE AppNotification (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL DEFAULT 'notice',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  imageUrl TEXT NOT NULL DEFAULT '',
  isActive BOOLEAN NOT NULL DEFAULT true,
  sendPush BOOLEAN NOT NULL DEFAULT false,
  pushSent BOOLEAN NOT NULL DEFAULT false,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Notice table (popup/push notices on site entry)
CREATE TABLE Notice (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL DEFAULT 'popup',
  title TEXT NOT NULL,
  body TEXT,
  url TEXT NOT NULL DEFAULT '',
  imageUrl TEXT NOT NULL DEFAULT '',
  isActive BOOLEAN NOT NULL DEFAULT true,
  pushSent BOOLEAN NOT NULL DEFAULT false,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ChatMessage table
CREATE TABLE ChatMessage (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT 'male',
  content TEXT NOT NULL,
  reactions TEXT NOT NULL DEFAULT '{}',
  replyToId TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (replyToId) REFERENCES ChatMessage(id)
);

CREATE INDEX ChatMessage_createdAt_idx ON ChatMessage(createdAt);
CREATE INDEX ChatMessage_replyToId_idx ON ChatMessage(replyToId);

-- ============================================================
-- STEP 3: Insert default data
-- ============================================================
INSERT OR IGNORE INTO AppSetting (id) VALUES ('app');
