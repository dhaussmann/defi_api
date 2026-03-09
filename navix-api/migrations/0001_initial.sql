-- User alert strategies
CREATE TABLE IF NOT EXISTS user_strategies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_chat_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    short_exchange TEXT NOT NULL,
    long_exchange TEXT NOT NULL,
    threshold_apr REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Telegram notification cooldown tracking (4h cooldown)
CREATE TABLE IF NOT EXISTS sent_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id INTEGER NOT NULL,
    apr_value REAL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (strategy_id) REFERENCES user_strategies(id)
);

-- Expo push token registration
CREATE TABLE IF NOT EXISTS push_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_chat_id TEXT NOT NULL,
    expo_push_token TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    device_name TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Push notification cooldown tracking (24h cooldown)
CREATE TABLE IF NOT EXISTS push_sent_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id INTEGER NOT NULL,
    apr_value REAL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (strategy_id) REFERENCES user_strategies(id)
);

-- User subscription profiles
CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_chat_id TEXT UNIQUE NOT NULL,
    subscription_tier TEXT DEFAULT 'free',
    subscription_expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User configuration (exchange selection, filters)
CREATE TABLE IF NOT EXISTS user_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_chat_id TEXT NOT NULL,
    name TEXT,
    enabled_exchanges TEXT DEFAULT '[]',
    spot_strategies_enabled INTEGER DEFAULT 0,
    min_open_interest REAL DEFAULT 0,
    max_open_interest REAL,
    min_volume_24h REAL DEFAULT 0,
    max_volume_24h REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- XP marketplace requests
CREATE TABLE IF NOT EXISTS xp_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_username TEXT NOT NULL,
    xp_amount REAL NOT NULL,
    price REAL NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('sell', 'buy')),
    total_value REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_strategies_chat_id ON user_strategies(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_strategies_active ON user_strategies(is_active);
CREATE INDEX IF NOT EXISTS idx_sent_notifications_strategy ON sent_notifications(strategy_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_push_tokens_chat_id ON push_tokens(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_push_sent_strategy ON push_sent_notifications(strategy_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_profiles_chat_id ON profiles(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_user_config_chat_id ON user_config(telegram_chat_id);
