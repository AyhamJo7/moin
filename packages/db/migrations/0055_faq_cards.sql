-- 0055 — FAQ cards with approved spoken answers (P09.04).
-- migration-check: allow create-index-blocking because every index here is on a table created
-- earlier in this same migration, so it is new and empty.
--
-- ## Why a NEW table, not knowledge_versions cards
--
-- knowledge_versions (0052) governs long-form card bodies through the publish door
-- (draft → approved → retired with versions). FAQ cards are a different contract:
-- a canonical question + match variants + a SHORT spoken answer (≤ 350 chars) that a
-- voice agent speaks VERBATIM, plus an optional longer written answer (email, later).
-- The spoken answer carries voice-specific lint (no URLs, read-out numbers,
-- pronunciation hints) that makes no sense on knowledge bodies, and FAQ matching
-- needs a variants array + trigram matching — not the knowledge live-pointer.
-- So: one row per card, staff-direct with optimistic locking (profile.ts shape),
-- sensitivity-gated retrieval (sensitive = approved-card only, never grounded).
--
-- ## Sensitivity (T-22, ADR-0014)
--
-- public | internal | sensitive. Sensitive categories (allergens, prices,
-- legal/policy statements) are approved-card mode ONLY: the retrieval gate
-- (`retrievable_cards`, P10 side) excludes them from grounded generation —
-- enforced here by the `sensitive` marker test at the service layer, and by the
-- category naming convention (allergene|preise|rechtliches flagged at creation).
--
-- Tenant rows: organisation_id, composite unique, RLS + FORCE, moin_app DML
-- (no DELETE — cards deactivate via active=false; erasure runs privileged).

CREATE TABLE faq_cards (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  -- Canonical question (owner wording) + match variants (caller phrasings).
  canonical       text        NOT NULL CHECK (length(btrim(canonical)) BETWEEN 1 AND 300),
  variants        text[]      NOT NULL DEFAULT '{}'
                    CHECK (cardinality(variants) <= 20),
  -- Spoken answer: ≤ 350 chars, voice-linted at the service layer (no URLs,
  -- long numbers need read-out, pronunciation hints). Written answer optional
  -- (email channel, later) — longer, same lint minus the length cap.
  spoken_answer   text        NOT NULL CHECK (length(btrim(spoken_answer)) BETWEEN 1 AND 350),
  written_answer  text        CHECK (written_answer IS NULL OR length(btrim(written_answer)) BETWEEN 1 AND 2000),
  sensitivity     text        NOT NULL DEFAULT 'public'
                    CHECK (sensitivity IN ('public', 'internal', 'sensitive')),
  allowed_channels text[]     NOT NULL DEFAULT '{call,message}'
                    CHECK (allowed_channels <@ '{call,message}' AND allowed_channels <> '{}'),
  location_id     uuid,
  active          boolean     NOT NULL DEFAULT true,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  FOREIGN KEY (organisation_id, location_id) REFERENCES locations (organisation_id, id) ON DELETE RESTRICT
);

CREATE INDEX faq_cards_canonical_idx ON faq_cards (organisation_id, canonical);
-- Trigram on the canonical question (array elements have no trgm opclass —
-- gin_trgm_ops rejects text[]; variants match via unnest()+% at query time).
CREATE INDEX faq_cards_canonical_trgm_idx ON faq_cards USING gin (canonical gin_trgm_ops);

COMMENT ON TABLE faq_cards IS 'FAQ cards with approved spoken answers (P09.04, BR-064). Canonical + variants for matching; spoken ≤350 chars voice-linted; sensitive = approved-card only (T-22).';
COMMENT ON COLUMN faq_cards.spoken_answer IS 'Owner-approved text spoken VERBATIM on voice (ADR-0014). Lint: no URLs, read-out numbers, pronunciation hints.';
COMMENT ON COLUMN faq_cards.variants IS 'Caller phrasings that match this card (≤20). Trigram-matched at retrieval.';

SELECT app.apply_tenant_rls('faq_cards');

REVOKE ALL ON TABLE faq_cards
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT, UPDATE ON faq_cards TO moin_app;

-- Reviewed audit argument keys (P06.10.03, P06.10.07, INV-12). Markers only — never Q&A text.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('faq.upsert', 'sensitivity', 'count', 'card sensitivity as opaque marker (0=public,1=internal,2=sensitive); no question or answer text'),
  ('faq.upsert', 'version', 'count', 'row version after write; concurrency marker, no content')
ON CONFLICT (operation, argument_key) DO NOTHING;
