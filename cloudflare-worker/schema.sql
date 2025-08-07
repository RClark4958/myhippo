-- Database schema for tracking transcription jobs
CREATE TABLE IF NOT EXISTS transcription_jobs (
  id TEXT PRIMARY KEY,
  audio_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME,
  error_message TEXT,
  file_size INTEGER,
  duration_seconds REAL,
  word_count INTEGER,
  deepgram_request_id TEXT,
  cost_cents INTEGER
);

CREATE INDEX idx_status ON transcription_jobs(status);
CREATE INDEX idx_created_at ON transcription_jobs(created_at);
CREATE INDEX idx_audio_key ON transcription_jobs(audio_key);

-- Table for storing transcription metadata
CREATE TABLE IF NOT EXISTS transcription_metadata (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  transcription_key TEXT NOT NULL,
  speakers_detected INTEGER,
  confidence_score REAL,
  language_detected TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES transcription_jobs(id)
);

-- Table for tracking daily usage (for cost monitoring)
CREATE TABLE IF NOT EXISTS daily_usage (
  date TEXT PRIMARY KEY,
  audio_minutes REAL DEFAULT 0,
  cost_cents INTEGER DEFAULT 0,
  file_count INTEGER DEFAULT 0
);