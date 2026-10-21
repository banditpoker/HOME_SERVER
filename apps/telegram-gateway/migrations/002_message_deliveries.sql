CREATE TABLE message_deliveries (
  delivery_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  chat_id TEXT NOT NULL,
  text TEXT NOT NULL,
  parse_mode TEXT NOT NULL CHECK (parse_mode = 'plain'),
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'sending', 'retry_wait', 'delivered', 'failed')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX message_deliveries_queue_idx
  ON message_deliveries (status, next_attempt_at, created_at);
