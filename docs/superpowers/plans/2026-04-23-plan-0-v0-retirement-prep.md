# Plan 0 — v0 Retirement Prep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze v0 as a referenceable git tag + docs snapshot, branch `v1-pdf-pipeline` from master, add all v1 database migrations (012–019), delete v0-only services/tests, stub the DWG route to return 501 so the app stays bootable.

**Architecture:** Pure preparation work — no new pipeline code. The branch, tag, migrations, and service-file deletions set the clean slate that Plans 1–6 will build on. The stubbed DWG route keeps the FastAPI app importable/bootable so subsequent plans can run integration tests without the whole app failing to start.

**Tech Stack:** PostgreSQL 16 (raw SQL migrations applied via `psql` in the `ppg-estimator-db-1` container), Python 3.12 FastAPI, pytest, git, Docker Compose.

---

## Spec reference

This plan implements the retirement prep described in §11 of the spec at
`docs/superpowers/specs/2026-04-23-pdf-first-extraction-pipeline-design.md`
and creates all migrations listed in §7.7 (012 through 019).

## File Structure

**New files:**
- `docs/v0-reference/services-overview.md` — one-page summary of what each retired v0 service did (pointer-only; source lives at git tag `v0-final-reference`)
- `database/migrations/012_eval_runs.sql`
- `database/migrations/013_symbol_fingerprints.sql`
- `database/migrations/014_page_classifications.sql`
- `database/migrations/015_extractions.sql`
- `database/migrations/016_cross_discipline_resolutions.sql`
- `database/migrations/017_mapping_suggestions_fingerprint_key.sql`
- `database/migrations/018_mapping_suggestion_feedback_led_to_fingerprint.sql`
- `database/migrations/019_projects_source_format.sql`

**Modified files:**
- `backend/app/routers/extraction.py` — stubbed to return 501 so the app boots without v0 services
- `backend/app/main.py` — keep the extraction router registered, but the `/extract` DWG branch points at a 501-returning stub instead of importing from `app.routers.extraction.extract_dwg`
- `backend/tests/conftest.py` — remove DXF fixture autouse (no v0 tests remain to need them)

**Deleted files (v0 services):**
- `backend/app/services/dwg_parser.py`
- `backend/app/services/block_counter.py`
- `backend/app/services/layer_analyzer.py`
- `backend/app/services/annotation_reader.py`
- `backend/app/services/fitting_inferrer.py`

**Deleted files (v0 tests):**
- `backend/tests/test_annotation_reader.py`
- `backend/tests/test_block_counter.py`
- `backend/tests/test_fitting_inferrer.py`
- `backend/tests/test_layer_analyzer.py`
- `backend/tests/test_extraction_api.py`
- `backend/tests/fixtures/create_test_dxf.py` (the tests that need this are gone)

**Preserved (shared between v0 and v1):**
- `backend/app/services/pdf_renderer.py`
- `backend/app/services/ocr_reader.py`
- `backend/app/services/symbol_detector.py`
- `backend/app/services/pipe_detector.py`
- `backend/app/services/polyline_measurer.py`
- `backend/app/services/scale_extractor.py`
- `backend/app/services/annotation_associator.py`
- `backend/app/services/legend_parser.py`
- `backend/tests/test_pdf_renderer.py`
- `backend/tests/test_polyline_measurer.py`
- `backend/tests/test_scale_extractor.py`

---

### Task 1: Verify clean working tree and tag v0-final-reference

**Files:**
- None created; git operation only.

- [ ] **Step 1: Confirm working tree is clean**

Run:
```bash
git status --short
```

Expected output: empty (or only untracked `scripts/` — that's fine).
If anything else is modified or staged, stop and resolve before continuing.

- [ ] **Step 2: Confirm we are on master**

Run:
```bash
git rev-parse --abbrev-ref HEAD
```

Expected output: `master`

- [ ] **Step 3: Create the tag pointing at current master**

Run:
```bash
git tag -a v0-final-reference -m "Final v0 DWG-first pipeline snapshot. Referenced by Plan 0 of the v1 PDF-first rebuild. Use 'git show v0-final-reference:<path>' to read retired v0 code."
```

- [ ] **Step 4: Verify the tag exists**

Run:
```bash
git tag --list v0-final-reference
git show --stat v0-final-reference | head -5
```

Expected: tag listed; first line of `show` is the tagged commit SHA (should match current master's HEAD).

- [ ] **Step 5: Push the tag to origin**

Run:
```bash
git push origin v0-final-reference
```

Expected: `* [new tag]         v0-final-reference -> v0-final-reference`

No commit needed — tags are pushed directly.

---

### Task 2: Create v0 services reference doc

**Files:**
- Create: `docs/v0-reference/services-overview.md`

- [ ] **Step 1: Create the v0 reference directory and file**

Create file `docs/v0-reference/services-overview.md` with exactly this content:

```markdown
# v0 Services — Reference Only

**Status:** Retired on 2026-04-23. Code lives permanently at git tag `v0-final-reference`.

To read any file from v0:
```
git show v0-final-reference:backend/app/services/dwg_parser.py
```

## Why these were retired

v0 was DWG-first: it parsed DXF entities directly, used block names and layer names as the primary signal, and inferred fittings from block attributes. v1 pivots to PDF-first extraction (vector path + vision fallback) with a per-CE XObject-hash feedback loop. The services below were specific to the DXF entity model and do not apply to vector PDFs.

See `docs/superpowers/specs/2026-04-23-pdf-first-extraction-pipeline-design.md` for the v1 design.

## Retired services

### `dwg_parser.py`
Top-level orchestrator for DWG/DXF ingestion. Called ODA File Converter to produce a DXF from DWG input, opened it with `ezdxf`, and dispatched to the other v0 services below. Returned a single `ExtractionResult` per drawing.

### `block_counter.py`
Counted `INSERT` entity references per block name in model space. Treated each unique block name as a potential fixture type; delivered raw counts before fitting inference.

### `layer_analyzer.py`
Walked the DXF layer table, categorised layers by name convention (e.g. `P-*` plumbing, `H-*` hydraulic), and used layer membership as a discipline signal. Discipline detection in v1 moves to title-block reading on PDFs.

### `annotation_reader.py`
Extracted MTEXT / TEXT entities from DXF model space plus block attribute values (`ATTDEF`/`ATTRIB`) and associated them spatially with nearby block references. The PDF world has no block attributes; v1 uses on-page text via `fitz` plus `annotation_associator` (preserved).

### `fitting_inferrer.py`
Read fixture block attributes (`TAG`, `SIZE`, `MODEL`) and matched them to rate card items. v1 replaces this with the three-tier mapper (`symbol_fingerprints` Tier 1 → `mapping_suggestions` Tier 2 → Claude Tier 3).

## Services preserved from v0 (still used in v1)

- `pdf_renderer.py`, `ocr_reader.py`, `symbol_detector.py`, `pipe_detector.py`, `polyline_measurer.py`, `scale_extractor.py`, `annotation_associator.py`, `legend_parser.py` — these operate on rasters or geometry and are format-agnostic.
```

- [ ] **Step 2: Stage and commit the reference doc**

Run:
```bash
git add docs/v0-reference/services-overview.md
git commit -m "docs(v0-reference): summary pointer to retired v0 services

Snapshots what each retired v0 service did so v1 can consult it without
re-reading the full source. Full source lives permanently at tag
v0-final-reference.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Create and check out branch `v1-pdf-pipeline`

**Files:**
- None created; git operation only.

- [ ] **Step 1: Branch from current HEAD**

Run:
```bash
git checkout -b v1-pdf-pipeline
```

Expected output: `Switched to a new branch 'v1-pdf-pipeline'`

- [ ] **Step 2: Confirm branch**

Run:
```bash
git rev-parse --abbrev-ref HEAD
```

Expected output: `v1-pdf-pipeline`

No commit needed.

---

### Task 4: Migration 012 — `eval_runs` table

**Files:**
- Create: `database/migrations/012_eval_runs.sql`

- [ ] **Step 1: Write the migration SQL**

Create file `database/migrations/012_eval_runs.sql`:

```sql
-- 012_eval_runs.sql
--
-- Accuracy tracking table for the evaluation harness (Plan 4).
-- Each row is one run of run_eval.py against a named dataset at a
-- specific engine_version (git SHA). Metrics JSON format is owned
-- by the harness; schema-wise it's opaque here.

CREATE TABLE eval_runs (
  id             SERIAL PRIMARY KEY,
  dataset_name   TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  git_sha        TEXT NOT NULL,
  metrics        JSONB NOT NULL,
  ran_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_eval_runs_dataset_ran ON eval_runs(dataset_name, ran_at DESC);
```

- [ ] **Step 2: Apply the migration to the local dev DB**

Run:
```bash
docker exec -i ppg-estimator-db-1 psql -U postgres -d ppg_estimator -v ON_ERROR_STOP=1 < database/migrations/012_eval_runs.sql
```

Expected output:
```
CREATE TABLE
CREATE INDEX
```

If you get a "database does not exist" or "relation exists" error, stop and investigate — do not continue.

- [ ] **Step 3: Verify the table exists with the right shape**

Run:
```bash
docker exec ppg-estimator-db-1 psql -U postgres -d ppg_estimator -c "\d eval_runs"
```

Expected output includes columns:
- `id integer` (nextval)
- `dataset_name text not null`
- `engine_version text not null`
- `git_sha text not null`
- `metrics jsonb not null`
- `ran_at timestamp with time zone not null default now()`

And index `idx_eval_runs_dataset_ran`.

- [ ] **Step 4: Commit**

```bash
git add database/migrations/012_eval_runs.sql
git commit -m "feat(db): migration 012 — eval_runs table

Accuracy tracking for the evaluation harness. Plan 4 will write to this
table when run_eval.py executes. Schema is intentionally minimal: dataset
name, engine version, git SHA, and a JSONB metrics blob owned by the
harness.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Migration 013 — `symbol_fingerprints` table

**Files:**
- Create: `database/migrations/013_symbol_fingerprints.sql`

- [ ] **Step 1: Write the migration SQL**

Create file `database/migrations/013_symbol_fingerprints.sql`:

```sql
-- 013_symbol_fingerprints.sql
--
-- Tier 1 deterministic mapping table. Each row is a per-CE (or
-- tenant-wide when consulting_engineer_id IS NULL) exact match from a
-- fingerprint_key to a rate card item.
--
-- fingerprint_type = 'xobject_hash'      — sha256 of a PDF Form XObject
--                                           stream (deterministic; one
--                                           hash per consultant's symbol).
-- fingerprint_type = 'shape_cluster_hash' — fuzzier geometric hash used
--                                           when XObjects are flattened.
--
-- Promotions from mapping_suggestions land here with source =
-- 'promoted_from_ai' after N consecutive correct corrections.

CREATE TABLE symbol_fingerprints (
  id                     SERIAL PRIMARY KEY,
  tenant_id              INTEGER NOT NULL REFERENCES tenants(id),
  consulting_engineer_id INTEGER REFERENCES consulting_engineers(id),
  fingerprint_type       TEXT NOT NULL,
  fingerprint_key        TEXT NOT NULL,
  label                  TEXT,
  rate_card_item_id      INTEGER NOT NULL REFERENCES rate_card_items(id),
  confidence             confidence_level NOT NULL DEFAULT 'high',
  source                 TEXT NOT NULL,  -- 'estimator_correction' | 'initial_seed' | 'promoted_from_ai'
  created_by             INTEGER REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_by          INTEGER REFERENCES symbol_fingerprints(id)
);

-- Active (non-superseded) rows must be unique within their scope.
-- COALESCE(consulting_engineer_id, 0) lets tenant-wide and CE-specific
-- rows coexist for the same fingerprint_key.
CREATE UNIQUE INDEX symbol_fingerprints_scope_unique
  ON symbol_fingerprints
    (tenant_id, COALESCE(consulting_engineer_id, 0), fingerprint_type, fingerprint_key)
  WHERE superseded_by IS NULL;

CREATE INDEX idx_symbol_fingerprints_lookup
  ON symbol_fingerprints(tenant_id, consulting_engineer_id, fingerprint_type, fingerprint_key)
  WHERE superseded_by IS NULL;
```

- [ ] **Step 2: Apply the migration**

Run:
```bash
docker exec -i ppg-estimator-db-1 psql -U postgres -d ppg_estimator -v ON_ERROR_STOP=1 < database/migrations/013_symbol_fingerprints.sql
```

Expected output:
```
CREATE TABLE
CREATE UNIQUE INDEX
CREATE INDEX
```

- [ ] **Step 3: Verify**

Run:
```bash
docker exec ppg-estimator-db-1 psql -U postgres -d ppg_estimator -c "\d symbol_fingerprints"
```

Check the output contains all columns listed in the SQL above, that `confidence` is the custom enum `confidence_level`, and that both indexes are listed.

- [ ] **Step 4: Commit**

```bash
git add database/migrations/013_symbol_fingerprints.sql
git commit -m "feat(db): migration 013 — symbol_fingerprints table

Tier 1 deterministic mapping: per-CE (or tenant-wide) exact-match
fingerprint_key -> rate_card_item_id overrides. Sourced from estimator
corrections or promoted from the fuzzy mapping_suggestions tier after
N consecutive confirmations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Migration 014 — `page_classifications` table

**Files:**
- Create: `database/migrations/014_page_classifications.sql`

- [ ] **Step 1: Write the migration SQL**

Create file `database/migrations/014_page_classifications.sql`:

```sql
-- 014_page_classifications.sql
--
-- One row per (drawing, page_number). Stores both the classifier's
-- prediction (discipline + role) and the estimator's confirmation if
-- they override it. Confirmations are the training signal that lets
-- Plan 1's classifier move toward auto-select per-CE.
--
-- role_predicted / role_confirmed values:
--   'PRIMARY_HYDRAULIC'    — discipline in {H, P} AND plumbing content
--   'FIXTURE_BEARING_ARCH' — discipline in {A, DA, AR} AND plumbing content
--   'CONTEXTUAL_CIVIL'     — discipline in {C, CD} AND stormwater/fire signal
--   'NON_RELEVANT'         — otherwise

CREATE TABLE page_classifications (
  id                    SERIAL PRIMARY KEY,
  tenant_id             INTEGER NOT NULL REFERENCES tenants(id),
  project_id            INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  drawing_id            INTEGER NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  page_number           INTEGER NOT NULL,
  sheet_code            TEXT,
  discipline_predicted  TEXT NOT NULL,
  discipline_confirmed  TEXT,
  role_predicted        TEXT NOT NULL,
  role_confirmed        TEXT,
  title_block_bbox      JSONB,
  confirmed_at          TIMESTAMPTZ,
  confirmed_by          INTEGER REFERENCES users(id),
  UNIQUE (drawing_id, page_number)
);
CREATE INDEX idx_page_class_project ON page_classifications(project_id);
```

- [ ] **Step 2: Apply**

Run:
```bash
docker exec -i ppg-estimator-db-1 psql -U postgres -d ppg_estimator -v ON_ERROR_STOP=1 < database/migrations/014_page_classifications.sql
```

Expected output:
```
CREATE TABLE
CREATE INDEX
```

- [ ] **Step 3: Verify**

```bash
docker exec ppg-estimator-db-1 psql -U postgres -d ppg_estimator -c "\d page_classifications"
```

All columns present; unique constraint on `(drawing_id, page_number)` listed; foreign keys to `tenants`, `projects`, `drawings`, `users`.

- [ ] **Step 4: Commit**

```bash
git add database/migrations/014_page_classifications.sql
git commit -m "feat(db): migration 014 — page_classifications table

Predicted vs confirmed discipline and role per page. Estimator
overrides teach the classifier per-CE conventions (title block bbox,
sheet code format) so it can eventually auto-select pages.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Migration 015 — `extractions` table

**Files:**
- Create: `database/migrations/015_extractions.sql`

- [ ] **Step 1: Write the migration SQL**

Create file `database/migrations/015_extractions.sql`:

```sql
-- 015_extractions.sql
--
-- One row per (drawing_id, page_number, engine_version). Stores the
-- normalised extraction payload as JSONB so that a rate-card change
-- can trigger re-mapping without re-extracting.
--
-- payload shape is documented in the v1 spec §4.4. engine_version is a
-- string like 'v1-pdf-0.1.0' that changes when the extraction contract
-- changes, making older payloads re-runnable but not re-used silently.

CREATE TABLE extractions (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  drawing_id      INTEGER NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  page_number     INTEGER NOT NULL,
  payload         JSONB NOT NULL,
  engine_version  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (drawing_id, page_number, engine_version)
);
CREATE INDEX idx_extractions_project ON extractions(project_id);
```

- [ ] **Step 2: Apply**

```bash
docker exec -i ppg-estimator-db-1 psql -U postgres -d ppg_estimator -v ON_ERROR_STOP=1 < database/migrations/015_extractions.sql
```

Expected:
```
CREATE TABLE
CREATE INDEX
```

- [ ] **Step 3: Verify**

```bash
docker exec ppg-estimator-db-1 psql -U postgres -d ppg_estimator -c "\d extractions"
```

Confirm `UNIQUE (drawing_id, page_number, engine_version)` and foreign keys.

- [ ] **Step 4: Commit**

```bash
git add database/migrations/015_extractions.sql
git commit -m "feat(db): migration 015 — extractions table

Immutable JSONB payloads from the v1 extractor, keyed by
(drawing_id, page_number, engine_version). Rate-card changes trigger
re-mapping only; extraction is cached.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Migration 016 — `cross_discipline_resolutions` table

**Files:**
- Create: `database/migrations/016_cross_discipline_resolutions.sql`

- [ ] **Step 1: Write the migration SQL**

Create file `database/migrations/016_cross_discipline_resolutions.sql`:

```sql
-- 016_cross_discipline_resolutions.sql
--
-- Records which discipline to trust when the same fixture type shows
-- different counts on hydraulic and architectural sheets of the same
-- job. The estimator's choice is scoped per-CE so future jobs from the
-- same consultant default to the learned trust policy.

CREATE TABLE cross_discipline_resolutions (
  id                     SERIAL PRIMARY KEY,
  tenant_id              INTEGER NOT NULL REFERENCES tenants(id),
  consulting_engineer_id INTEGER REFERENCES consulting_engineers(id),
  fixture_type           TEXT NOT NULL,  -- e.g. 'WC', 'BSN'
  trust                  TEXT NOT NULL,  -- 'hydraulic' | 'architectural'
  project_id             INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  created_by             INTEGER REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_cdr_ce_fixture ON cross_discipline_resolutions(tenant_id, consulting_engineer_id, fixture_type);
```

- [ ] **Step 2: Apply**

```bash
docker exec -i ppg-estimator-db-1 psql -U postgres -d ppg_estimator -v ON_ERROR_STOP=1 < database/migrations/016_cross_discipline_resolutions.sql
```

Expected:
```
CREATE TABLE
CREATE INDEX
```

- [ ] **Step 3: Verify**

```bash
docker exec ppg-estimator-db-1 psql -U postgres -d ppg_estimator -c "\d cross_discipline_resolutions"
```

- [ ] **Step 4: Commit**

```bash
git add database/migrations/016_cross_discipline_resolutions.sql
git commit -m "feat(db): migration 016 — cross_discipline_resolutions table

Per-CE learned trust policy for hydraulic-vs-architectural count
conflicts. Written when the estimator resolves an inline conflict
banner in the takeoff grid.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Migration 017 — add `fingerprint_key` to `mapping_suggestions`

**Files:**
- Create: `database/migrations/017_mapping_suggestions_fingerprint_key.sql`

- [ ] **Step 1: Write the migration SQL**

Create file `database/migrations/017_mapping_suggestions_fingerprint_key.sql`:

```sql
-- 017_mapping_suggestions_fingerprint_key.sql
--
-- Links a Tier 2 AI suggestion to the Tier 1 fingerprint that would
-- apply if the suggestion is promoted. Nullable because legacy
-- suggestions (from v0) have no fingerprint concept.

ALTER TABLE mapping_suggestions
  ADD COLUMN fingerprint_key TEXT NULL;

CREATE INDEX idx_mapping_suggestions_fingerprint
  ON mapping_suggestions(tenant_id, consulting_engineer_id, fingerprint_key)
  WHERE fingerprint_key IS NOT NULL;
```

- [ ] **Step 2: Apply**

```bash
docker exec -i ppg-estimator-db-1 psql -U postgres -d ppg_estimator -v ON_ERROR_STOP=1 < database/migrations/017_mapping_suggestions_fingerprint_key.sql
```

Expected:
```
ALTER TABLE
CREATE INDEX
```

- [ ] **Step 3: Verify the column exists**

```bash
docker exec ppg-estimator-db-1 psql -U postgres -d ppg_estimator -c "\d mapping_suggestions" | grep fingerprint_key
```

Expected output shows `fingerprint_key | text |`.

- [ ] **Step 4: Commit**

```bash
git add database/migrations/017_mapping_suggestions_fingerprint_key.sql
git commit -m "feat(db): migration 017 — mapping_suggestions.fingerprint_key

Nullable link from a Tier 2 AI suggestion to the Tier 1 fingerprint it
would promote to. Partial index keeps lookups on populated rows cheap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Migration 018 — add `led_to_fingerprint_id` to `mapping_suggestion_feedback`

**Files:**
- Create: `database/migrations/018_mapping_suggestion_feedback_led_to_fingerprint.sql`

- [ ] **Step 1: Write the migration SQL**

Create file `database/migrations/018_mapping_suggestion_feedback_led_to_fingerprint.sql`:

```sql
-- 018_mapping_suggestion_feedback_led_to_fingerprint.sql
--
-- When a correction triggers a Tier 2 -> Tier 1 promotion, record the
-- resulting symbol_fingerprints row id here so we can audit which
-- corrections crystallised into deterministic overrides.

ALTER TABLE mapping_suggestion_feedback
  ADD COLUMN led_to_fingerprint_id INTEGER NULL REFERENCES symbol_fingerprints(id) ON DELETE SET NULL;

CREATE INDEX idx_feedback_led_to_fingerprint
  ON mapping_suggestion_feedback(led_to_fingerprint_id)
  WHERE led_to_fingerprint_id IS NOT NULL;
```

- [ ] **Step 2: Apply**

```bash
docker exec -i ppg-estimator-db-1 psql -U postgres -d ppg_estimator -v ON_ERROR_STOP=1 < database/migrations/018_mapping_suggestion_feedback_led_to_fingerprint.sql
```

Expected:
```
ALTER TABLE
CREATE INDEX
```

- [ ] **Step 3: Verify**

```bash
docker exec ppg-estimator-db-1 psql -U postgres -d ppg_estimator -c "\d mapping_suggestion_feedback" | grep led_to_fingerprint
```

Expected output shows the column referencing `symbol_fingerprints(id)`.

- [ ] **Step 4: Commit**

```bash
git add database/migrations/018_mapping_suggestion_feedback_led_to_fingerprint.sql
git commit -m "feat(db): migration 018 — feedback.led_to_fingerprint_id

Audit trail for Tier 2 -> Tier 1 promotions: which correction created
which fingerprint override.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Migration 019 — add `source_format` to `projects`

**Files:**
- Create: `database/migrations/019_projects_source_format.sql`

- [ ] **Step 1: Write the migration SQL**

Create file `database/migrations/019_projects_source_format.sql`:

```sql
-- 019_projects_source_format.sql
--
-- Records whether a project's drawings arrived as native PDFs or were
-- converted from DWG via ODA File Converter. Exposed in the UI as a
-- badge on the project page for provenance transparency.

ALTER TABLE projects
  ADD COLUMN source_format TEXT NOT NULL DEFAULT 'pdf';

ALTER TABLE projects
  ADD CONSTRAINT projects_source_format_check
  CHECK (source_format IN ('pdf', 'dwg_via_oda'));
```

- [ ] **Step 2: Apply**

```bash
docker exec -i ppg-estimator-db-1 psql -U postgres -d ppg_estimator -v ON_ERROR_STOP=1 < database/migrations/019_projects_source_format.sql
```

Expected:
```
ALTER TABLE
ALTER TABLE
```

- [ ] **Step 3: Verify**

```bash
docker exec ppg-estimator-db-1 psql -U postgres -d ppg_estimator -c "\d projects" | grep source_format
docker exec ppg-estimator-db-1 psql -U postgres -d ppg_estimator -c "SELECT source_format, count(*) FROM projects GROUP BY source_format"
```

First command shows the column with default `'pdf'::text`. Second shows existing rows defaulted to `pdf`.

- [ ] **Step 4: Commit**

```bash
git add database/migrations/019_projects_source_format.sql
git commit -m "feat(db): migration 019 — projects.source_format

Records whether a project is PDF-native or DWG-via-ODA. Defaults to
'pdf' since v1 is PDF-first. CHECK constraint enforces the two
allowed values.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Stub the extraction router so the app boots without v0 services

**Files:**
- Modify: `backend/app/routers/extraction.py`

- [ ] **Step 1: Replace the contents of `backend/app/routers/extraction.py`**

Overwrite the file with exactly:

```python
"""v0 extraction router — retired.

The DWG/DXF pipeline was removed in Plan 0 of the v1 PDF-first rebuild.
This stub returns HTTP 501 so the FastAPI app still boots and routes
resolve, but no real extraction happens here. Plan 1 will replace this
router with the PDF-first classify + extract endpoints.

Historical code: `git show v0-final-reference:backend/app/routers/extraction.py`.
"""

from fastapi import APIRouter, HTTPException, UploadFile, File

router = APIRouter()


@router.post("/extract/dwg")
async def extract_dwg_retired(file: UploadFile = File(...)):
    raise HTTPException(
        status_code=501,
        detail=(
            "v0 DWG extraction has been retired. v1 PDF-first pipeline "
            "is under construction. Upload PDFs once v1 routes land."
        ),
    )
```

- [ ] **Step 2: Verify no syntax errors by importing the module**

Run:
```bash
docker exec ppg-estimator-extraction-1 python -c "from app.routers import extraction; print('OK')"
```

Expected output: `OK`

Do not commit yet — wait until service deletions in later tasks are done, then commit them together with the stub.

---

### Task 13: Update `main.py` to drop the dynamic import from the retired router

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Read the current file**

Run:
```bash
cat backend/app/main.py
```

Note the current `extract_universal` block at the bottom and its dynamic import `from app.routers.extraction import extract_dwg`.

- [ ] **Step 2: Replace the `extract_universal` handler**

In `backend/app/main.py`, locate the block starting with `@app.post("/extract")` and its `extract_universal` function. Replace that block with:

```python
@app.post("/extract")
async def extract_universal(file: UploadFile = File(...)):
    """Universal extraction endpoint.

    v0 DWG path is retired (returns 501 via /extract/dwg stub). PDF path
    in vision.extract_pdf still works and will be replaced by v1's
    classify + extract endpoints in Plan 1.
    """
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext in {".dwg", ".dxf"}:
        raise HTTPException(
            status_code=501,
            detail=(
                "v0 DWG extraction retired; v1 PDF-first pipeline under construction. "
                "Please upload the drawing as PDF."
            ),
        )
    elif ext == ".pdf":
        from app.routers.vision import extract_pdf
        return await extract_pdf(file)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")
```

Leave the rest of `main.py` unchanged.

- [ ] **Step 3: Verify the app module still imports**

```bash
docker exec ppg-estimator-extraction-1 python -c "from app.main import app; print('routes:', [r.path for r in app.routes])"
```

Expected: prints a list that includes `/extract`, `/extract/dwg`, `/health`, `/extract/pdf` (whichever routes the existing routers declare). No ImportError.

Do not commit yet.

---

### Task 14: Delete v0-only test files

**Files:**
- Delete: `backend/tests/test_annotation_reader.py`
- Delete: `backend/tests/test_block_counter.py`
- Delete: `backend/tests/test_fitting_inferrer.py`
- Delete: `backend/tests/test_layer_analyzer.py`
- Delete: `backend/tests/test_extraction_api.py`

- [ ] **Step 1: Delete the v0 test files**

Run:
```bash
rm backend/tests/test_annotation_reader.py \
   backend/tests/test_block_counter.py \
   backend/tests/test_fitting_inferrer.py \
   backend/tests/test_layer_analyzer.py \
   backend/tests/test_extraction_api.py
```

- [ ] **Step 2: Verify deletion**

Run:
```bash
ls backend/tests/
```

Expected: the 5 files above are gone; `test_pdf_renderer.py`, `test_polyline_measurer.py`, `test_scale_extractor.py`, `test_health.py`, `conftest.py`, `fixtures/`, `__init__.py` remain.

Do not commit yet.

---

### Task 15: Remove DXF fixture autouse from `conftest.py`

**Files:**
- Modify: `backend/tests/conftest.py`
- Delete: `backend/tests/fixtures/create_test_dxf.py` (only if no remaining test imports it — verify in Step 2)

- [ ] **Step 1: Overwrite `backend/tests/conftest.py`**

Replace the entire contents of `backend/tests/conftest.py` with:

```python
"""Shared pytest fixtures.

v0 auto-generated DXF fixtures were removed with the v0 tests. PDF
fixtures (if/when needed by v1 tests) will be added by Plan 1 and
subsequent plans next to the tests that use them.
"""
```

- [ ] **Step 2: Confirm no remaining test imports `create_test_dxf`**

Run:
```bash
grep -r "create_test_dxf\|create_simple_dxf\|create_complex_dxf" backend/ || echo "NO MATCHES"
```

Expected: `NO MATCHES`. If there are matches, stop and inspect — a test we thought was v0-only still references the fixtures.

- [ ] **Step 3: Delete the now-unused fixture generator**

```bash
rm backend/tests/fixtures/create_test_dxf.py
```

- [ ] **Step 4: Also delete any generated sample DXFs that shipped alongside**

```bash
ls backend/tests/fixtures/ 2>/dev/null || true
rm -f backend/tests/fixtures/sample_simple.dxf backend/tests/fixtures/sample_complex.dxf
```

- [ ] **Step 5: Check whether the fixtures directory is now empty**

```bash
ls -A backend/tests/fixtures/ 2>/dev/null
```

If the directory is empty, remove it:
```bash
rmdir backend/tests/fixtures/ 2>/dev/null || true
```

Do not commit yet.

---

### Task 16: Delete v0-only service files

**Files:**
- Delete: `backend/app/services/dwg_parser.py`
- Delete: `backend/app/services/block_counter.py`
- Delete: `backend/app/services/layer_analyzer.py`
- Delete: `backend/app/services/annotation_reader.py`
- Delete: `backend/app/services/fitting_inferrer.py`

- [ ] **Step 1: Delete the files**

Run:
```bash
rm backend/app/services/dwg_parser.py \
   backend/app/services/block_counter.py \
   backend/app/services/layer_analyzer.py \
   backend/app/services/annotation_reader.py \
   backend/app/services/fitting_inferrer.py
```

- [ ] **Step 2: Confirm no remaining import references**

Run:
```bash
grep -Rn "from app.services.dwg_parser\|from app.services.block_counter\|from app.services.layer_analyzer\|from app.services.annotation_reader\|from app.services.fitting_inferrer\|import dwg_parser\|import block_counter\|import layer_analyzer\|import annotation_reader\|import fitting_inferrer" backend/ || echo "NO MATCHES"
```

Expected: `NO MATCHES`.

If matches appear, stop and inspect — another file still depends on the deleted services and must be updated before continuing.

Do not commit yet.

---

### Task 17: Verify backend imports cleanly, app boots, remaining tests pass

**Files:**
- None changed; verification only.

- [ ] **Step 1: Import-check the backend**

```bash
docker exec ppg-estimator-extraction-1 python -c "import app.main; print('app import OK')"
```

Expected: `app import OK`. Any ImportError here means a dangling reference from Tasks 14–16 — resolve before continuing.

- [ ] **Step 2: Restart the extraction container**

```bash
docker compose restart extraction
```

Wait ~10 seconds, then:

```bash
docker compose logs --tail=30 extraction
```

Expected: FastAPI / uvicorn startup logs with no ImportError or traceback.

- [ ] **Step 3: Health-check the running service**

```bash
curl -s http://localhost:8001/health
```

Expected: a JSON body (existing `/health` response — unchanged by this plan).

- [ ] **Step 4: Run the remaining backend tests**

```bash
docker exec ppg-estimator-extraction-1 pytest -x -q tests/
```

Expected: all remaining tests pass (`test_health.py`, `test_pdf_renderer.py`, `test_polyline_measurer.py`, `test_scale_extractor.py`). If any fail due to a missing v0 import that should have been deleted, fix it now.

- [ ] **Step 5: Hit the retired DWG endpoint and confirm 501**

```bash
# Create a small dummy file and POST it
printf "dummy" > /tmp/dummy.dxf
curl -s -o /tmp/resp.json -w "%{http_code}\n" -F "file=@/tmp/dummy.dxf" http://localhost:8001/extract/dwg
cat /tmp/resp.json; echo
rm /tmp/dummy.dxf
```

Expected: HTTP status `501` and a JSON body mentioning "v0 DWG extraction has been retired".

---

### Task 18: Commit all v0 deletions + stub together

**Files:**
- None new; commits the staged deletions from Tasks 12–16.

- [ ] **Step 1: Stage deletions and modifications**

```bash
git add -A backend/app/routers/extraction.py \
           backend/app/main.py \
           backend/app/services/ \
           backend/tests/
```

Note: `-A` is safe here because the only changes in these paths are the ones made by this plan.

- [ ] **Step 2: Confirm the staging set**

```bash
git status --short
```

Expected: shows only deletions of the five v0 service files, five v0 test files, fixture generator + sample DXFs, and modifications to `extraction.py`, `main.py`, and `conftest.py`. No surprises.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(v0): retire DWG-first extraction pipeline

Deletes DXF-entity-specific services and their tests:
  - dwg_parser, block_counter, layer_analyzer
  - annotation_reader, fitting_inferrer
  - their test modules and DXF fixture generator

Stubs /extract/dwg to return 501 so the app still boots while
v1 PDF-first routes are being built in Plan 1. Historical code
lives at tag v0-final-reference.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Confirm branch state**

```bash
git log --oneline -12
git status
```

Expected: commits for each of Tasks 2, 4, 5, 6, 7, 8, 9, 10, 11, and this task (18), plus the spec commit from brainstorming on master. Working tree clean.

---

### Task 19: Final Plan 0 verification checklist

**Files:**
- None changed; final sanity sweep.

- [ ] **Step 1: Verify tag + branch state**

```bash
git tag --list v0-final-reference
git rev-parse --abbrev-ref HEAD
```

Expected: tag is listed; branch is `v1-pdf-pipeline`.

- [ ] **Step 2: Confirm all 8 migrations are on disk and applied**

```bash
ls database/migrations/01[2-9]_*.sql
```

Expected: 8 files (012 through 019).

```bash
docker exec ppg-estimator-db-1 psql -U postgres -d ppg_estimator -c "SELECT to_regclass('public.eval_runs'), to_regclass('public.symbol_fingerprints'), to_regclass('public.page_classifications'), to_regclass('public.extractions'), to_regclass('public.cross_discipline_resolutions');"
```

Expected: each `to_regclass` returns the table name (not NULL).

```bash
docker exec ppg-estimator-db-1 psql -U postgres -d ppg_estimator -c "\d mapping_suggestions" | grep fingerprint_key
docker exec ppg-estimator-db-1 psql -U postgres -d ppg_estimator -c "\d mapping_suggestion_feedback" | grep led_to_fingerprint_id
docker exec ppg-estimator-db-1 psql -U postgres -d ppg_estimator -c "\d projects" | grep source_format
```

Each grep must return one line showing the column.

- [ ] **Step 3: App + tests**

```bash
docker exec ppg-estimator-extraction-1 pytest -q tests/
curl -s http://localhost:8001/health
```

Both must succeed.

- [ ] **Step 4: Sanity check — no v0 references linger**

```bash
grep -Rn "dwg_parser\|block_counter\|layer_analyzer\|fitting_inferrer" backend/app/ || echo "CLEAN"
grep -Rn "annotation_reader" backend/app/ || echo "CLEAN"
```

Expected: `CLEAN` for both. (The `annotation_associator` service is preserved and different; the check specifically targets `annotation_reader`.)

- [ ] **Step 5: Stop, report to the user**

Plan 0 is complete. Report:
- tag `v0-final-reference` pushed
- branch `v1-pdf-pipeline` checked out with 10 new commits
- 8 migrations applied and verified
- 5 v0 services + 5 v0 tests + DXF fixtures deleted
- app boots, remaining tests pass, `/extract/dwg` returns 501

Await user sign-off before starting Plan 1.

---

## Self-review

**Spec coverage (against §11 and §7.7 of the spec):**
- §11.1 "Tag current master as `v0-final-reference`" — Task 1 ✓
- §11.2 `docs/v0-reference/services-overview.md` — Task 2 ✓
- §11.3 "Branch `v1-pdf-pipeline` from master" — Task 3 ✓
- §11.4 "Delete v0-only services up front" — Tasks 14, 16 ✓
- §7.7 migrations 012–019 — Tasks 4–11 ✓
- Migration numbering corrected to match existing 011 as the latest — ✓

**No placeholders:** every SQL migration has exact DDL; every bash step has exact commands and expected output; every file modification shows the full replacement contents. No TBD/TODO strings.

**Type consistency:** `confidence_level` enum reused where the spec originally said `NUMERIC(3,2)`. `rate_card_item_id INTEGER` throughout (not `rate_code TEXT`). `consulting_engineer_id INTEGER` matches existing convention. All primary keys are `SERIAL`.

**Sequencing risk:** migrations 017 and 018 depend on existing tables `mapping_suggestions` (migration 008) and `mapping_suggestion_feedback` (migration 008), and on the new `symbol_fingerprints` (migration 013). Migration order in the plan (013 before 017/018) is correct.

**Rollback:** all migrations are additive; a `git revert` of the branch's merge to master plus `DROP TABLE ... IF EXISTS` would undo the changes. The v0 tag preserves the previous state.
