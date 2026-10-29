-- A second pod credited with a post or concept: a partner (Trybe) named in an ad set together with an
-- in-house pod ("Shameer | Trybe | UGC | …"). Both count it in full (owner, Oct 29); totals count it once.
ALTER TABLE assignments ADD COLUMN co_pod_id TEXT;
ALTER TABLE concepts ADD COLUMN co_pod_id TEXT;
