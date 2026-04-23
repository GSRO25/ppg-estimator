# v1 — PDF-First Extraction Pipeline

**Status:** Draft — awaiting user review
**Date:** 2026-04-23
**Author:** Brainstormed with Claude
**Supersedes:** v0 DWG-first pipeline (to be retired, snapshotted at tag `v0-final-reference`)

---

## 1. Purpose and goals

Replace the current DWG-first extraction pipeline with a PDF-first pipeline that:

- Treats PDF as the primary input format (the common case from consultants).
- Treats DWG as a second-class input, converted to vector PDF via ODA File Converter and processed through the same pipeline.
- Preserves and extends the accuracy feedback loop (`mapping_suggestions` + `mapping_suggestion_feedback`) with deterministic per-CE symbol-fingerprint overrides.
- Classifies multi-page drawing sets by **discipline** (title block) and **content** (on-page plumbing signals), so fixtures on architectural sheets are captured alongside primary hydraulic sheets.
- Ships an evaluation harness on day one so progress toward "matches or beats manual takeoff" (Parity) is measurable from v1.0.

### Non-goals (v1)

- Matching manual takeoff accuracy on day one. v1 ships at **Assistive** accuracy (system gets most things right; estimator finalises in UI; feedback loop improves accuracy per job). Parity is the goal to measure toward, not the ship criterion.
- Supporting scanned/raster-only PDFs at full accuracy. Vision fallback (YOLO+OCR) is present for graceful degradation, but vector-native PDFs are the optimisation target.
- Multi-tenant rollout. Single tenant (PPG, tenant_id=1) remains in practice. Schema stays multi-tenant-ready.

---

## 2. Architecture overview

End-to-end flow for a single job:

```
upload (PDF or DWG)
   │
   ├── [DWG only] ODA File Converter → vector PDF
   │
   ▼
1. Ingest       — split PDF into per-page artefacts; compute page hash
2. Classify     — two parallel passes:
                    Pass A: discipline from title block
                    Pass B: plumbing content from on-page signals
                  → assemble page role
3. Select       — UI grid; estimator ticks pages to extract from
                  (future: auto-select at per-CE confidence threshold)
4. Extract      — per selected page:
                    vector pass (fitz) OR vision fallback (YOLO+OCR)
                    → normalised output (symbols, pipes, text, legend)
5. Map          — three-tier mapping of symbols → rate codes:
                    Tier 1: per-CE XObject-hash override (deterministic)
                    Tier 2: per-CE AI-learned suggestion
                    Tier 3: Claude fallback
6. Review       — takeoff grid; estimator corrects counts/mappings
7. Log          — corrections → mapping_suggestion_feedback
                  → promote Tier 2/3 to Tier 1 after N consecutive matches
8. Export       — Excel with live formulas (reused from v0)
9. Evaluate     — if job is a reference dataset, compute metrics
```

---

## 3. Classification (Step 2) — detail

### 3.1 Pass A — discipline from title block

- Scan each page for sheet-code tokens matching `\b[A-Z]{1,3}\d{2,4}[A-Z]?\b`.
- Score each candidate by:
  1. Proximity (within ~200pt on x-axis, ~30pt on y-axis) to a label matching `SHEET\s*No|DRAWING\s*No|PLAN\s*No|DWG\s*No`.
  2. Font size (title-block codes are typically the largest sheet-code text on the page).
  3. Edge proximity (title blocks hug page edges).
- Highest-scoring candidate wins. Prefix determines discipline:
  - `CD`, `C` → Civil
  - `H`, `HY` → Hydraulic
  - `P` → Plumbing (subject to disambiguation — see 3.3)
  - `DA`, `AR`, `A` → Architectural
  - `S`, `ST` → Structural
  - `E`, `EL` → Electrical
  - `M`, `ME` → Mechanical
  - `L` → Landscape
- If no candidate scores above threshold → `Unknown` (typically cover pages, index sheets).

### 3.2 Pass B — plumbing content on the page

A page passes Pass B if **any** of these signal:

- **Text signals** — any substring match on room labels (`AMENITIES`, `BATHROOM`, `WC`, `TOILETS`, `KITCHEN`, `WET AREA`, `SHOWER`) or pipework labels (`CW`, `SEW`, `FS`, `SW`, `RCW`, `FHR`, `HWU`).
- **Shape signals** — at least N (initially N=3) small repeated vector-path clusters (candidate fixture symbols) on the page.
- **Legend signals** — a legend block on any page in the set has been parsed, and at least one of its symbols appears on this page.

Pass B output: `{ has_plumbing_content: bool, confidence: 0–1, signals: [...] }`.

### 3.3 The `P##` disambiguation problem

Observed: `nettletontribe` architectural sets use `P##` as a **page stamp** ("P28" = page 28), which a naive regex mistakes for a plumbing sheet code.

Mitigations, in order:

1. Require a candidate to be adjacent to a `SHEET No` / `DRAWING No` label to be treated as a sheet code.
2. Prefer longer prefixes (`DA`, `CD`, `HD`) over single-letter prefixes (`P`, `H`, `A`) when multiple codes are present.
3. Claude fallback: when the top two candidates have conflicting disciplines, send the top text clusters to Claude with the question "what's the sheet code and discipline?". Log the answer.
4. Per-CE overrides learned from `page_classifications` feedback (see §7.3).

### 3.4 Page role assembly

```
role =
  PRIMARY_HYDRAULIC     if discipline ∈ {H, P} AND has_plumbing_content
  FIXTURE_BEARING_ARCH  if discipline ∈ {A, DA, AR} AND has_plumbing_content
  CONTEXTUAL_CIVIL      if discipline ∈ {C, CD} AND (stormwater | fire) signal
  NON_RELEVANT          otherwise
```

Roles drive extraction behaviour in §4 and conflict resolution in §5.

---

## 4. Extraction engine (Step 4) — detail

### 4.1 Service boundaries

| Service | Single purpose | Reused from v0? |
|---|---|---|
| `pdf_probe` | classify page as vector vs raster | new |
| `title_block_reader` | sheet code, discipline, scale, project metadata | new |
| `legend_reader` | build symbol + line-style dictionary for page/set | new |
| `xobject_symbol_counter` | enumerate Form XObjects, hash their stream bytes, count references | new |
| `shape_cluster_fallback` | repeated-path grouping when no XObjects | new |
| `pipe_tracer` | polyline → (service, length_m) via legend match + page scale | new |
| `vision_extractor` | YOLOv8 + PaddleOCR for scanned pages | **reused** |
| `legend_parser` (Claude) | parse unknown legend blocks | **reused** |
| `annotation_associator` | bind nearby text labels to symbols/pipes | **reused** |
| `extraction_merger` | combine all signals into normalised output | new |

### 4.2 Vector path (default, when `pdf_probe` says vector)

1. **Text** — `fitz.Page.get_text('dict')` gives text with bbox. Parsed into:
   - title block fields
   - legend entries
   - annotations (size callouts, fixture labels, RL levels)
   - dimension strings
2. **Symbols via XObjects** — enumerate `Page.get_xobjects()` + CTM of each reference. For each unique XObject stream, `key = sha256(stream_bytes)`. Count = number of references. Position = CTM translation.
3. **Symbols fallback (shape clustering)** — if XObject count is zero but Pass B says plumbing content exists: group small repeated path groups by normalised shape-hash (bbox-normalised + stroke-pattern signature).
4. **Pipe tracing** — long polylines grouped by (colour, line-style). Each group matched against the legend (if parsed) to assign a service. Lengths summed in page units, converted via page scale to metres.

### 4.3 Vision fallback (when `pdf_probe` says raster)

- Rasterize at 300 DPI.
- `vision_extractor` returns bbox + class for each detected symbol and positioned OCR text.
- `annotation_associator` binds OCR labels to bboxes.
- Same normalised output shape as the vector path.

### 4.4 Normalised output

Stored to the `extractions` table as JSONB, one row per `(pdf_document_id, page_number, engine_version)`:

```json
{
  "page": 7,
  "role": "FIXTURE_BEARING_ARCH",
  "source_format": "pdf",
  "vector_or_vision": "vector",
  "symbols": [
    {
      "fingerprint_type": "xobject_hash",
      "fingerprint_key": "a3f9c8...",
      "label": "WC",
      "count": 12,
      "positions": [[x, y], [x, y], ...]
    }
  ],
  "pipes": [
    {
      "service": "CW",
      "length_m": 18.4,
      "colour": "#1f77b4",
      "style": "solid"
    }
  ],
  "legend_entries": [
    {"symbol_key": "a3f9c8...", "label": "WC"},
    {"line_style_key": "solid-blue-0.5", "label": "CW"}
  ],
  "text_annotations": [
    {"text": "Ø100 PVC", "bbox": [x0, y0, x1, y1]}
  ],
  "title_block": {
    "sheet_code": "DA103",
    "discipline": "Architectural",
    "scale": "1:100 at A1",
    "drawing_title": "Ground Floor Plan — Amenities",
    "ce_detected": "nettletontribe"
  }
}
```

---

## 5. Mapping (Step 5) — detail

Three tiers, short-circuit evaluation:

### 5.1 Tier 1 — deterministic XObject-hash / shape-hash override

Lookup in `symbol_fingerprints` scoped by `(tenant_id, ce_id, fingerprint_type, fingerprint_key)`.
Hit → `confidence = 1.0`, no further tiers called.

### 5.2 Tier 2 — per-CE AI-learned suggestion

Existing `mapping_suggestions` table, scoped by CE. Uses fuzzy geometry + text context + legend label.
Hit above confidence threshold → return with tier source annotation.

### 5.3 Tier 3 — Claude fallback

Only called for symbols unresolved by Tier 1 and Tier 2. Usage tracked and budget-capped (existing infrastructure).
Claude receives: legend text, nearby annotations, symbol shape/XObject hash, rate card schema. Returns suggested rate code + rationale.

### 5.4 Conflict resolution across pages

When the same fixture type appears on both PRIMARY_HYDRAULIC and FIXTURE_BEARING_ARCH pages in the same zone:

- Default: trust hydraulic count.
- Surface an inline banner in the takeoff grid: "H001 shows 3 WCs, DA103 shows 4 WCs — review".
- Estimator's resolution ("trust H" / "trust A") writes to a `cross_discipline_resolutions` record (small new table — see §7.4) that teaches per-CE trust policy for future jobs.

---

## 6. Feedback loop — promotion rules

Corrections to `mapping_suggestion_feedback` drive Tier 2 → Tier 1 promotion.

```
On correction write:
  if same (ce_id, fingerprint_key, rate_code) has been confirmed ≥ 2 times consecutively:
    insert row into symbol_fingerprints with
      source = 'promoted_from_ai',
      confidence = 1.00
    set mapping_suggestion_feedback.led_to_fingerprint_id = new_row.id
  else:
    adjust mapping_suggestions.confidence score
```

Threshold N=2 is tunable.

---

## 7. Database schema

### 7.1 New table: `symbol_fingerprints`

```sql
CREATE TABLE symbol_fingerprints (
  id               BIGSERIAL PRIMARY KEY,
  tenant_id        BIGINT NOT NULL REFERENCES tenants(id),
  ce_id            BIGINT REFERENCES consulting_engineers(id),
  fingerprint_type TEXT NOT NULL,  -- 'xobject_hash' | 'shape_cluster_hash'
  fingerprint_key  TEXT NOT NULL,
  label            TEXT,
  rate_code        TEXT NOT NULL REFERENCES rate_card_items(code),
  confidence       NUMERIC(3,2) NOT NULL DEFAULT 1.00,
  source           TEXT NOT NULL,  -- 'estimator_correction' | 'initial_seed' | 'promoted_from_ai'
  created_by       BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_by    BIGINT REFERENCES symbol_fingerprints(id),
  UNIQUE (tenant_id, ce_id, fingerprint_type, fingerprint_key)
);

CREATE INDEX idx_sf_lookup ON symbol_fingerprints
  (tenant_id, ce_id, fingerprint_type, fingerprint_key)
  WHERE superseded_by IS NULL;
```

### 7.2 New table: `extractions`

```sql
CREATE TABLE extractions (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       BIGINT NOT NULL,
  project_id      BIGINT NOT NULL REFERENCES projects(id),
  pdf_document_id BIGINT NOT NULL,
  page_number     INT NOT NULL,
  payload         JSONB NOT NULL,
  engine_version  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pdf_document_id, page_number, engine_version)
);
```

### 7.3 New table: `page_classifications`

```sql
CREATE TABLE page_classifications (
  id                    BIGSERIAL PRIMARY KEY,
  tenant_id             BIGINT NOT NULL,
  project_id            BIGINT NOT NULL REFERENCES projects(id),
  pdf_document_id       BIGINT NOT NULL,
  page_number           INT NOT NULL,
  sheet_code            TEXT,
  discipline_predicted  TEXT NOT NULL,
  discipline_confirmed  TEXT,
  role_predicted        TEXT NOT NULL,
  role_confirmed        TEXT,
  title_block_bbox      JSONB,
  confirmed_at          TIMESTAMPTZ,
  confirmed_by          BIGINT REFERENCES users(id)
);
```

### 7.4 New table: `cross_discipline_resolutions`

```sql
CREATE TABLE cross_discipline_resolutions (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    BIGINT NOT NULL,
  ce_id        BIGINT REFERENCES consulting_engineers(id),
  fixture_type TEXT NOT NULL,      -- e.g. 'WC', 'BSN'
  trust        TEXT NOT NULL,      -- 'hydraulic' | 'architectural'
  project_id   BIGINT REFERENCES projects(id),
  created_by   BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 7.5 New table: `eval_runs`

```sql
CREATE TABLE eval_runs (
  id             BIGSERIAL PRIMARY KEY,
  dataset_name   TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  git_sha        TEXT NOT NULL,
  metrics        JSONB NOT NULL,
  ran_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 7.6 Existing table additions

- `mapping_suggestions` ← `fingerprint_key TEXT NULL` (links to the fingerprint that would apply if promoted)
- `mapping_suggestion_feedback` ← `led_to_fingerprint_id BIGINT NULL REFERENCES symbol_fingerprints(id)`
- `projects` ← `source_format TEXT NOT NULL DEFAULT 'pdf'` (values: `'pdf'`, `'dwg_via_oda'`)

### 7.7 Migration list

```
011  eval_runs
012  symbol_fingerprints
013  page_classifications
014  extractions
015  cross_discipline_resolutions
016  mapping_suggestions.fingerprint_key
017  mapping_suggestion_feedback.led_to_fingerprint_id
018  projects.source_format
```

All additive. No destructive changes.

---

## 8. Evaluation harness

### 8.1 Dataset structure

```
backend/tests/eval/
  datasets/
    westlink_lot2/
      source/
        arch.pdf
        civil.pdf
        h001.pdf
      reference/
        manual_takeoff.json
        notes.md
  harness/
    run_eval.py
    metrics.py
```

### 8.2 `manual_takeoff.json` schema

```json
{
  "job": "westlink_lot2",
  "consulting_engineer": "nettletontribe",
  "rate_card_version": "2.3",
  "pages_processed": [7, 8, 11, 12, 15],
  "fixtures": [
    {"rate_code": "PLM-WC-001", "count": 12, "source_page": 7}
  ],
  "pipes": [
    {"service": "CW", "length_m": 145.3}
  ],
  "total_value_aud": 48720.00
}
```

### 8.3 Metrics

| Metric | Question | Formula |
|---|---|---|
| Classification F1 | Right pages picked? | per-page precision/recall on role_predicted |
| Fixture count accuracy | Right count per rate code? | `1 − Σ|pred − actual| / Σ actual` |
| Pipe length accuracy | Right length per service? | `1 − Σ|pred − actual| / Σ actual` |
| Mapping precision | Right rate code? | correct / total matched |
| Total value delta | Dollar impact | `$pred − $actual` |
| Estimator touch count | UI corrections to finalise | count of feedback rows during job |

Measured twice per job: **pre-correction** (raw system output) and **post-correction** (finalised takeoff). Post = 0 delta → v1 successfully assisted. Pre improving over time → feedback loop working.

### 8.4 CI integration

- Commit to extraction/mapping code → run `run_eval.py` on full dataset.
- Regression rule: >2% drop on any metric → block merge.
- Weekly CI run replays all past production jobs against a read-only DB snapshot.

### 8.5 Seeding

- Dataset #1: Westlink Lot 2 (files already available).
- Target: 10 past jobs with `manual_takeoff.json` by v1.0. Converted once from the finalised Excel takeoff.

### 8.6 Internal accuracy dashboard

`/admin/accuracy` route — trendlines per metric per dataset. Not user-facing.

---

## 9. DWG handling (second-class input)

```
upload.dwg → ODA File Converter → vector .pdf → same pipeline from Step 2
```

- ODA produces vector PDFs (not raster) → vector-first path still works.
- No DXF entity parsing, no block-attribute inference, no layer-based discipline detection. All retired with v0.
- Failure mode: if ODA conversion fails, surface a clear error and increment a `dwg_conversion_failures` counter. Estimator is offered manual conversion as a workaround.
- UI shows badge: `Imported from DWG` when `projects.source_format = 'dwg_via_oda'`.

---

## 10. Frontend changes

### 10.1 Preserved

- Auth, project list, project detail (CE/builder pickers, rate card selector)
- Takeoff grid + priced-vs-unpriced progress banner
- Review Queue
- Excel export
- Usage/cost surfaces
- Snapshots

### 10.2 New

- **Upload flow** — "Upload PDF" primary, DWG accepted with explanation.
- **Page selection grid** — `/projects/[id]/pages` route. Thumbnails, filter chips by discipline and role, auto-tick by role classification, estimator override writes to `page_classifications`.
- **Source provenance column** in takeoff grid — Tier 1 / 2 / 3 badge per line, with hover explanation.
- **Cross-discipline conflict banner** — inline in takeoff grid when H-sheet and A-sheet counts disagree.
- **Accuracy dashboard** (`/admin/accuracy`) — internal-only, eval_runs trends.

### 10.3 Removed / relabelled

- Any "DWG/DXF" labelling → "PDF (or DWG, auto-converted)".
- v0 detector admin panels tied to DXF entity logic → reviewed, removed if no longer relevant.

---

## 11. Migration strategy

1. Tag current master as `v0-final-reference`; push tag to origin.
2. Create `docs/v0-reference/services-overview.md` — one-page map of what each retired v0 service did, for lookup during v1 build.
3. Branch `v1-pdf-pipeline` from master.
4. On the branch, delete v0-only services up front:
   - `backend/app/services/dwg_parser.py`
   - `backend/app/services/block_counter.py`
   - `backend/app/services/layer_analyzer.py`
   - `backend/app/services/annotation_reader.py` (DXF-specific — a PDF variant may replace it under a new name)
   - `backend/app/services/fitting_inferrer.py`
   - v0-only routers / tests
5. Build v1 from there, referring to `git show v0-final-reference:<path>` when historical context is needed.
6. Eval harness gates merge: v1 must pass on Westlink dataset + any other reference datasets before merge to master.
7. Merge in one cut. No feature flag. Next incoming job runs on v1.

**Rollback:** `git revert` the merge. DB migrations are additive, so no schema rollback is needed.

**No in-flight v0 jobs** need to be preserved in running form (confirmed by user during brainstorming).

---

## 12. Success criteria

### v1.0 ships when:

1. Full pipeline (ingest → classify → select → extract → map → review → log → export) runs end-to-end on the Westlink Lot 2 dataset without manual intervention.
2. Post-correction total value delta on Westlink ≤ $0 (estimator can always reach the correct answer from v1's output via UI corrections).
3. Pre-correction fixture count accuracy ≥ 70% on Westlink.
4. Eval harness runs in CI and produces all metrics in §8.3.
5. Feedback loop: at least one Tier 2 → Tier 1 promotion observed during Westlink processing (proves the accuracy-ratchet works).
6. DWG upload path produces identical output to uploading the same drawing as a PDF (round-trip test with one DWG + its exported PDF).

### Progress-to-Parity tracking (post-ship):

- Pre-correction fixture count accuracy is charted over time per dataset.
- Target: ≥ 95% pre-correction accuracy on fixture counts by v1.5 (after N real jobs feed the feedback loop).

---

## 13. Open questions / risks

1. **Shape-cluster fallback accuracy** — when a consultant flattens their PDF (no XObjects), shape-hash clustering is fuzzier. Unknown hit rate until we test on flattened samples. Mitigation: Tier 2 AI mapping still applies, Tier 3 Claude fallback still applies.
2. **Page scale per viewport** — some sheets have multiple scales (e.g., site plan + detail at 1:20). Pipe tracing assumes a single scale per page. First pass: use the dominant scale; flag multi-scale pages for estimator review.
3. **Shadow-dataset availability** — need 10 past jobs converted to `manual_takeoff.json`. Conversion effort non-trivial. Mitigation: start with 1 (Westlink), grow the set as jobs complete on v1.
4. **Claude Tier 3 cost** — new Tier 3 calls per unknown symbol could spike API spend on a large set. Mitigation: hard per-job budget cap, cache by fingerprint_key.
5. **Cross-discipline duplicate detection** — matching "same WC across H and A sheets" requires zone/region alignment. Zones aren't explicitly tagged in the PDFs. Heuristic: spatial proximity after page registration + label match. Known to be fuzzy; the banner simply surfaces any disagreement rather than silently merging.

---

## 14. Decisions locked during brainstorming

- **Option C migration** — replace in-place; retire v0 rather than running parallel pipelines.
- **Approach 3 extraction** — hybrid vector-first with vision fallback.
- **Page selection: B now → A later** — estimator ticks pages in UI; auto-select once per-CE confidence is high enough.
- **Feedback loop scope: C** — both per-symbol and per-CE-override learning.
- **v1 ship criterion: Assistive**, with eval harness tracking progress toward Parity.
- **v0 retained only as git tag** — no runtime, no flag, no shadow.
- **Promotion threshold**: N=2 consecutive confirmations to promote Tier 2 → Tier 1 (tunable).
