CREATE TABLE telegram_allowed_chats (
  chat_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE telegram_allowed_senders (
  chat_id TEXT NOT NULL REFERENCES telegram_allowed_chats(chat_id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (chat_id, sender_id)
);

CREATE TABLE telegram_enabled_commands (
  command TEXT PRIMARY KEY CHECK (command ~ '^[a-z0-9_]+$'),
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE telegram_events (
  event_id TEXT PRIMARY KEY,
  update_id BIGINT NOT NULL UNIQUE,
  received_at TIMESTAMPTZ NOT NULL,
  chat_id TEXT NOT NULL,
  chat_type TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  username TEXT,
  kind TEXT NOT NULL CHECK (kind = 'message'),
  text TEXT NOT NULL
);

CREATE INDEX telegram_events_received_at_idx ON telegram_events (received_at);