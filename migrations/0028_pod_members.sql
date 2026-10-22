-- A pod's strategists (JSON list of names), for a per-strategist hit rate: Pod 0 is Andrei, Reika and
-- Adrian, each named in their ad sets ("POD0 | Andrei | …"). Empty for pods that are one strategist.
ALTER TABLE pods ADD COLUMN members TEXT;
