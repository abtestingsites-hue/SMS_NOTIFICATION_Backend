-- =========================================================================
-- SMS Campaign System v2.6.0 - Enterprise Database Migration
-- 001_create_job_queue.sql: Production Relational Queue & Execution Schema
-- Compatible with PostgreSQL 14+, AWS RDS, Neon, Supabase
-- =========================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Campaigns Table
CREATE TABLE IF NOT EXISTS campaigns (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    channel VARCHAR(32) NOT NULL DEFAULT 'sms', -- 'sms', 'whatsapp', 'both'
    target_audience VARCHAR(64) NOT NULL DEFAULT 'All',
    template_content TEXT NOT NULL,
    offer_code VARCHAR(64),
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', -- 'DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED'
    total_recipients INTEGER DEFAULT 0,
    dispatched_count INTEGER DEFAULT 0,
    suppressed_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Message Schedules Table
CREATE TABLE IF NOT EXISTS schedules (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(32) NOT NULL DEFAULT 'ONCE', -- 'ONCE', 'DAILY', 'WEEKLY', 'MONTHLY'
    cron_expression VARCHAR(64),
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    timezone VARCHAR(64) DEFAULT 'Asia/Kolkata',
    channel VARCHAR(32) NOT NULL DEFAULT 'both',
    target_audience VARCHAR(64) NOT NULL DEFAULT 'All',
    template_content TEXT NOT NULL,
    offer_code VARCHAR(64),
    media_id VARCHAR(64),
    idempotency_key VARCHAR(128) UNIQUE NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED', -- 'SCHEDULED', 'RUNNING', 'COMPLETED', 'RETRYING', 'DEAD_LETTER', 'CANCELLED'
    execution_count INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    last_run_at TIMESTAMP WITH TIME ZONE,
    locked_by VARCHAR(128),
    locked_at TIMESTAMP WITH TIME ZONE,
    lock_expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for scheduler polling
CREATE INDEX IF NOT EXISTS idx_schedules_due 
ON schedules (status, scheduled_at) 
WHERE status IN ('SCHEDULED', 'RETRYING');

-- 3. Worker Job Queue (BullMQ / PgBoss Queue Schema)
CREATE TABLE IF NOT EXISTS job_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    queue_name VARCHAR(64) NOT NULL DEFAULT 'campaign-dispatch',
    schedule_id VARCHAR(64) REFERENCES schedules(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    priority INTEGER DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    state VARCHAR(32) NOT NULL DEFAULT 'WAITING', -- 'WAITING', 'ACTIVE', 'COMPLETED', 'FAILED', 'DELAYED'
    failed_reason TEXT,
    locked_by VARCHAR(128),
    locked_at TIMESTAMP WITH TIME ZONE,
    lock_expires_at TIMESTAMP WITH TIME ZONE,
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_job_queue_fetch 
ON job_queue (queue_name, state, scheduled_for, priority DESC);

-- 4. Inbound Telephony Webhook Messages
CREATE TABLE IF NOT EXISTS inbound_messages (
    id VARCHAR(64) PRIMARY KEY,
    message_sid VARCHAR(128) UNIQUE NOT NULL,
    from_number VARCHAR(32) NOT NULL,
    to_number VARCHAR(32) NOT NULL,
    channel VARCHAR(16) NOT NULL, -- 'sms', 'whatsapp'
    body TEXT,
    profile_name VARCHAR(128),
    is_opt_out BOOLEAN DEFAULT FALSE,
    is_conversion BOOLEAN DEFAULT FALSE,
    customer_id VARCHAR(64),
    cancelled_followups_count INTEGER DEFAULT 0,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(32) DEFAULT 'PROCESSED'
);

CREATE INDEX IF NOT EXISTS idx_inbound_from ON inbound_messages (from_number);
CREATE INDEX IF NOT EXISTS idx_inbound_sid ON inbound_messages (message_sid);

-- 5. Customer Suppression Registry (Opt-Outs & Anti-Fatigue)
CREATE TABLE IF NOT EXISTS customer_suppressions (
    phone VARCHAR(32) PRIMARY KEY,
    reason TEXT NOT NULL,
    source VARCHAR(64) NOT NULL, -- 'TWILIO_INBOUND_WEBHOOK', 'MANUAL_OVERRIDE', 'FATIGUE_LIMIT'
    suppressed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Durable Media Assets Catalog
CREATE TABLE IF NOT EXISTS media_assets (
    id VARCHAR(64) PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(64) NOT NULL,
    media_type VARCHAR(32) NOT NULL, -- 'image', 'video', 'document'
    size_bytes BIGINT NOT NULL,
    checksum_sha256 VARCHAR(64) NOT NULL,
    storage_driver VARCHAR(64) DEFAULT 'DURABLE_OBJECT_STORAGE',
    magic_bytes_verified BOOLEAN DEFAULT TRUE,
    url VARCHAR(512) NOT NULL,
    caption TEXT,
    tags JSONB DEFAULT '[]'::jsonb,
    references JSONB DEFAULT '[]'::jsonb,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_media_checksum ON media_assets (checksum_sha256);

