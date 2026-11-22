-- Marks the local database as one that may hold fixture data (ROADMAP S2).
--
-- `pnpm db:seed` refuses to write to a database without this setting, so pointing the seed at the
-- production migration connection by mistake writes nothing. Only local bootstraps set it; the
-- production database is created by Terraform and never is (INV-16).
--
-- A local volume created before this file existed does not have it. Set it once by hand:
--   ALTER DATABASE moin SET moin.fixture_data = 'allowed';
ALTER DATABASE moin SET moin.fixture_data = 'allowed';
