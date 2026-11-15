CREATE TABLE IF NOT EXISTS saas_fx_rates (
  id SERIAL PRIMARY KEY,
  pair VARCHAR(16) NOT NULL UNIQUE,
  rate NUMERIC(14, 4) NOT NULL CHECK (rate > 0),
  rate_scaled_10000 BIGINT NOT NULL CHECK (rate_scaled_10000 > 0),
  updated_by_user_id INTEGER,
  updated_by_email VARCHAR(255),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saas_fx_rate_history (
  id SERIAL PRIMARY KEY,
  pair VARCHAR(16) NOT NULL,
  previous_rate NUMERIC(14, 4),
  new_rate NUMERIC(14, 4) NOT NULL CHECK (new_rate > 0),
  previous_rate_scaled_10000 BIGINT,
  new_rate_scaled_10000 BIGINT NOT NULL CHECK (new_rate_scaled_10000 > 0),
  actor_user_id INTEGER,
  actor_email VARCHAR(255),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saas_fx_rate_history_pair_created
  ON saas_fx_rate_history (pair, created_at DESC, id DESC);
