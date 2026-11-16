CREATE TABLE gradebook_revisions (
  owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  saved_at TEXT NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (owner_id, revision)
);
