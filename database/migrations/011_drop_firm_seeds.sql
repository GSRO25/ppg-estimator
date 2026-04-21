-- 011_drop_firm_seeds.sql
-- Remove pre-populated consulting engineer + builder rows. Going forward
-- these tables only contain firms that have actually been detected in a
-- drawing (auto-upserted by the detector) or manually added via the UI.
--
-- Safe because no projects reference seed rows yet — the only project
-- (id 31) was created before CE/builder columns existed and has both
-- NULL. Seed rows have no FK dependencies.

DELETE FROM consulting_engineers WHERE is_seed = TRUE;
DELETE FROM builders WHERE is_seed = TRUE;
