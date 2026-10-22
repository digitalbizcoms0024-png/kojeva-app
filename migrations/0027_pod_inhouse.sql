-- Which pods are Kojeva's own teams (the "In-house pods" preset). The four built-in pods and pods
-- added from now on default to in-house; pods added before (Trybe, a partner) and the agency aren't.
ALTER TABLE pods ADD COLUMN inhouse INTEGER NOT NULL DEFAULT 1;
UPDATE pods SET inhouse = 0 WHERE prefix IS NOT NULL OR kind = 'agency';
