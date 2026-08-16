-- Additive: 001_create_users already ran. Email confirmation is
-- short-circuited for now (docs/journal.md, dette à reprendre) — signup
-- sets this immediately instead of sending a real confirmation email.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
