-- Who can change things in the hub (emails, lower case). While empty, everyone signed in
-- through Cloudflare Access can edit; once someone is added, everyone else is view-only.
CREATE TABLE edit_access (
  email TEXT PRIMARY KEY,
  added_by TEXT,
  added_at TEXT NOT NULL
);
