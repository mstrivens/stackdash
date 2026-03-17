-- Initial schema for stackdash D1 database

CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  original_issue TEXT NOT NULL,  -- JSON blob of PylonIssue
  priority TEXT NOT NULL DEFAULT 'medium',
  priority_confidence REAL DEFAULT 0,
  summary TEXT DEFAULT '',
  investigation_outline TEXT DEFAULT '[]',  -- JSON array
  triage_timestamp TEXT,
  retry_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_issues_status ON issues(status);
CREATE INDEX idx_issues_priority ON issues(priority);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE metadata (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
