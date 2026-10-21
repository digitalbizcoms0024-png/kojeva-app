-- The written part of each fortnightly CS report (learnings and read): Claude's draft
-- (source 'claude') until someone edits it in the hub (source 'edited'), after which drafts
-- never replace it. The numbers are computed from stored data each time (worker/report.ts).
CREATE TABLE reports (
  period_from TEXT PRIMARY KEY,
  period_to   TEXT NOT NULL,
  learnings   TEXT NOT NULL,
  read        TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('claude', 'edited')),
  updated_by  TEXT,
  updated_at  TEXT NOT NULL
);
