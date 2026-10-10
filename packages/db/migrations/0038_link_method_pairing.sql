-- 0038 — pair contact and method on resolution verdicts (P07.03 round-1).
--
-- `interaction_links` references its contact and its method through two independent composite FKs
-- that co-locate by tenant only: nothing stops a verdict pairing contact A with contact B's
-- method. 0035's `contact_methods` has `UNIQUE (organisation_id, id)` but no triple unique, and
-- 0035 is merged (immutable), so this migration adds `UNIQUE (organisation_id, contact_id, id)`
-- and a composite FK `(organisation_id, contact_id, method_id)` on the links. A mismatched triple
-- is then rejected at write time (23503), not discovered in a report. `none` rows carry NULLs and
-- are unaffected (a composite FK with any NULL leg matches no row and constrains nothing).

ALTER TABLE contact_methods ADD UNIQUE (organisation_id, contact_id, id);

ALTER TABLE interaction_links ADD FOREIGN KEY (organisation_id, contact_id, method_id)
  REFERENCES contact_methods (organisation_id, contact_id, id) ON DELETE CASCADE;
