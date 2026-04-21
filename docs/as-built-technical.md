# PPG Estimator — Technical As-Built

**Version:** 1.0 (single-tenant production, multi-tenant schema groundwork)
**Date:** 2026-04-21
**Audience:** Developers, DevOps, security reviewers

---

## 1. System Overview

PPG Estimator is a containerised, LAN-deployed plumbing takeoff and estimation platform. It ingests architectural drawings (DWG / DXF / PDF), extracts fixtures, fittings and pipe runs, maps CAD symbols to rate-card items using an LLM-assisted suggestion engine with a feedback loop, and exports live-formula Excel estimates.

Target host: Dell Precision 3280 (Intel i7, 32 GB DDR5, NVIDIA T1000 8 GB), Windows 11 Pro with Docker Desktop + WSL2. No internet exposure; accessed via internal DNS and self-signed HTTPS.

## 2. Architecture

```
[LAN client]
     │  HTTPS (self-signed)
     ▼
[nginx:alpine]  :443 → TLS termination, client_max_body_size 500M
     │
     ├── /                → web (Next.js 16)          :3000
     ├── /api/*           → web (Next.js API routes)  :3000
     └── /extract/*       → backend (FastAPI)          :8000
                                │
                                ├── ezdxf + ODA File Converter  (DWG/DXF)
                                ├── PyMuPDF + OpenCV             (PDF)
                                ├── YOLOv8                       (GPU: symbol detection)
                                ├── PaddleOCR                    (GPU: text extraction)
                                └── Anthropic SDK → Claude Opus 4.7
                                                     (legend_parser)

[web] ────────── pg (node-postgres) ─────────────► [postgres:16-alpine]
[web] ────────── @anthropic-ai/sdk ──────────────► Claude Opus 4.7
                                                    (mapping_suggester)
```

All services run via `docker-compose.yml`. GPU is reserved for the `backend` service via the NVIDIA container runtime.

## 3. Technology Stack

| Layer | Technology | Version |
| --- | --- | --- |
| Reverse proxy | nginx | alpine |
| Frontend | Next.js + React + TypeScript | 16.2.4 / 19.2.4 / 5 |
| Auth | NextAuth.js + Google OAuth | 5.0.0-beta.31 |
| UI | Tailwind CSS, ag-grid-community, lucide-react | 4 / 35.2.1 |
| API client | pg (node-postgres), @anthropic-ai/sdk | 8.20.0 / 0.90.0 |
| Backend API | FastAPI + Uvicorn | 0.115.12 / 0.34.2 |
| CAD parsing | ezdxf + ODA File Converter | — |
| PDF / vision | PyMuPDF + OpenCV + YOLOv8 + PaddleOCR | 1.25.5 / latest / 8.x / 3.x |
| AI | Anthropic Python SDK | ≥ 0.39 |
| Database | PostgreSQL + pg_trgm | 16-alpine |
| Testing | pytest (backend), vitest (frontend scaffolded) | 8.3.5 / 4.1.4 |

Approximate size: backend ~1,240 lines of Python, frontend ~2,860 lines of TypeScript, 9 SQL migrations.

## 4. Data Model

Migrations live in `database/migrations/` (001–009). Core tables:

- `tenants` — multi-tenant root; seeded with `id = 1` (PPG).
- `users` — NextAuth-managed; `tenant_id`, `role` (`admin` / `estimator`), `email` unique.
- `projects` — project_name, client, address, rate_card_version_id, tenant_id, margin_percent.
- `drawings` — per-project file references + extraction results (JSONB), status, uploaded_by.
- `rate_card_versions` and `rate_card_items` — versioned rate cards keyed by tenant; section / description / unit / labour_rate / material_rate / plant_rate; production rates; pg_trgm index for fuzzy search.
- `takeoff_items` — one row per (project, rate_card_item, location): extracted_qty, final_qty, confidence, reviewed, drawing coordinates JSONB.
- `symbol_mappings` — canonical (cad_block_name → rate_card_item_id) resolved mappings, tenant-scoped.
- `mapping_suggestions` — Claude suggestions cache keyed by (tenant_id, cad_block_name, rate_card_version_id); stores confidence + reasoning; avoids duplicate LLM calls.
- `mapping_suggestion_feedback` — estimator overrides of suggestions; fed back into subsequent prompts as few-shot examples.
- `prompts` — per-tenant versioned system prompts (enables non-engineer prompt iteration).
- `llm_usage` — per-call model, input/output tokens, cache metrics, cost USD, purpose (`mapping_suggester` / `legend_parser`), pricing snapshot at call time.
- `audit_log` — user_id, action, entity_type, entity_id, details JSONB, timestamp (populated partially; see gaps).
- `estimates`, `corrections` — auxiliary; estimate rollups and per-item corrections.

Extensions: `pg_trgm` (rate-card search).

## 5. Key Code Paths

| Responsibility | Path |
| --- | --- |
| DWG/DXF extraction | `backend/app/services/dwg_parser.py`, `block_counter.py`, `polyline_measurer.py`, `layer_analyzer.py` |
| PDF vision pipeline | `backend/app/routers/vision.py`, `services/symbol_detector.py`, `pdf_renderer.py`, `ocr_reader.py` |
| Annotation + legend LLM | `backend/app/services/annotation_reader.py`, `annotation_associator.py`, `legend_parser.py` |
| FastAPI routes | `backend/app/main.py`, `routers/*` |
| Tenant enforcement | `frontend/src/lib/require-tenant.ts` |
| Mapping suggester (Claude) | `frontend/src/lib/mapping-suggester.ts` |
| Takeoff editor | `frontend/src/components/takeoff-grid.tsx` |
| Drawing viewer | `frontend/src/components/drawing-viewer.tsx` |
| Excel export | `frontend/src/app/api/projects/[id]/export/route.ts` |
| Usage tracking UI | `frontend/src/app/dashboard/settings/ai-usage/` |

## 6. Request Lifecycles

### 6.1 Drawing upload → extraction
1. Estimator drops files into `/dashboard/projects/[id]`.
2. Client enforces ≤ 490 MB; nginx enforces 500 MB; API route validates extension `{dwg, dxf, pdf}`.
3. File written to `UPLOAD_DIR/<projectId>/`; `drawings` row inserted (`status=pending`).
4. API calls FastAPI `/extract/dwg` or `/extract/pdf`.
5. FastAPI parses file; returns `ExtractionResult` (fixtures, fittings, pipes, bounds).
6. Legend parser (if `ANTHROPIC_API_KEY` set) annotates result with legend / schedule context.
7. API persists extraction JSON; status `extracted`.

### 6.2 Mapping suggestion flow
1. For each unmapped CAD block, client batches a Claude call via `mapping-suggester.ts`.
2. Before calling the LLM, check `mapping_suggestions` cache (keyed by tenant + block name + rate-card version) — cache hit returns instantly.
3. On cache miss: pull tenant prompt from `prompts`, include rejected suggestions from `mapping_suggestion_feedback` as negative examples, call Claude.
4. Response parsed for `(rate_card_item_id, confidence, reasoning)` and cached.
5. Estimator reviews in `/dashboard/settings/mappings`; accept → write to `symbol_mappings`; reject → write to `mapping_suggestion_feedback`.
6. `llm_usage` row recorded with pricing snapshot.

### 6.3 Estimate export
1. `/api/projects/[id]/export` rolls up `takeoff_items` with joined rate-card rates.
2. Sections become Excel sheet groups; subtotals and grand total wired via live formulas (`SUM`, `INDIRECT`).
3. Margin applied per project.

## 7. Security Posture

**Authentication / session**
- Google OAuth via NextAuth (JWT session, HTTP-only cookie).
- `ALLOWED_EMAILS` whitelist enforced in `signIn` callback.
- `middleware.ts` protects `/dashboard/*`.

**Authorisation**
- `requireTenant()` wraps every API handler; extracts `(userId, tenantId, role, email)`.
- Auto-provisions `users` row on first authed request (role `estimator`, tenant `1`).
- **Gap:** `role` exists but no RBAC enforcement — any authed user can reach admin pages.

**Tenant isolation**
- All queries filter `WHERE tenant_id = $1`; cross-tenant resource checks via `assertProjectInTenant` helper.
- Schema enforces FKs to `tenants(id)`.

**Input validation**
- Pydantic at FastAPI boundary; manual type parsing in Next.js API routes.
- All SQL parameterised (`$1, $2`); no observed string concatenation into queries.
- File uploads: extension whitelist + size limits at nginx and client.

**Secrets**
- `.env` (git-ignored): `POSTGRES_PASSWORD`, `NEXTAUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ANTHROPIC_API_KEY`.
- No secrets baked into images; all loaded via docker-compose `env_file`.

**Transport**
- nginx terminates TLS on 443 with self-signed cert (`certs/`); 80 redirects to 443.
- No external exposure; LAN-only deployment.

**Known gaps (production hardening backlog)**
- No rate limiting on extraction or LLM endpoints.
- No upload content scanning (malware, zip bombs).
- Filename persisted as-provided (path-traversal mitigated by `path.join` but not sanitised).
- `audit_log` populated partially — not every write is logged, `ip_address` column never filled.
- CORS on FastAPI is `allow_origins=["*"]`; safe only because service is not directly exposed through nginx.
- No secret rotation or key-scoped credentials for the Anthropic key.
- No RBAC enforcement for `admin` role.

## 8. Observability and Operations

- Container logs via `docker compose logs -f <service>`.
- `/api/health` and `http://<host>:8000/health` for liveness.
- `llm_usage` provides per-tenant, per-purpose cost breakdown surfaced at `/dashboard/settings/ai-usage`.
- Nightly Postgres backup via PowerShell Task Scheduler → `database/scripts/run-backup.ps1`; 30-day rolling retention.
- Docker volumes: `postgres-data`, `uploads`, `exports`.

## 9. Testing

- Backend: 9 pytest modules covering annotation reader, block counter, extraction API, fitting inferrer, health, layer analyzer, pdf renderer, polyline measurer, scale extractor.
- Frontend: `vitest` configured but no test files committed yet.
- Manual QA drives most feature validation today.

## 10. Deployment Procedure

Reference: `docs/deployment.md`.

1. Install Docker Desktop with WSL2 and NVIDIA GPU support.
2. Place ODA File Converter `.deb` in `backend/` before build.
3. Copy `.env.example` → `.env`; populate Google OAuth, NextAuth secret, Postgres password, Anthropic API key.
4. Generate a self-signed cert into `certs/`.
5. `docker compose build && docker compose up -d`.
6. Run database migrations (executed automatically on first boot via entrypoint).
7. Import rate card via `/api/rate-cards/import`.
8. Configure Google OAuth client (authorised redirect `https://<host>/api/auth/callback/google`).
9. Verify `/api/health` and `:8000/health`.

## 11. Roadmap Signals (from Git)

Recent active areas:
- Full-screen drawing viewer with floating takeoff panel (PR series).
- Legend/schedule LLM parsing + spatial annotation context.
- Claude mapping suggester with rejection feedback.
- Per-tenant Claude cost tracking.
- Upload-limit and error-surfacing polish.

Anticipated next work: RBAC enforcement, fine-tuned plumbing symbol detection (replacing pre-trained YOLOv8), vision-first PDF extraction, richer audit log, rate limiting.

## 12. Risk Register (Summary)

| Risk | Severity | Mitigation today | Follow-up |
| --- | --- | --- | --- |
| LLM cost runaway | Medium | Cache in `mapping_suggestions`, per-call usage log | Hard monthly budget caps |
| Malicious upload | Medium | Extension whitelist, LAN only | Content scanning / mime sniffing |
| Cross-tenant leak when opened to second tenant | High (future) | Tenant filter in every query | Automated integration test per route |
| Admin privilege escalation | Medium | Role stored but not enforced | Implement RBAC middleware |
| Self-signed cert trust drift | Low | Documented openssl generation | Move to internal CA or Tailscale |
| GPU / ODA converter single point of failure | Medium | Docker restart policies | Replica host, healthcheck escalation |
