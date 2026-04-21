# PPG Estimator — Plain English As-Built

**Version:** 1.0
**Date:** 2026-04-21
**Audience:** Plumbing business owners and operations leaders (no IT background needed)

---

## What is it?

PPG Estimator is a custom-built estimating tool for Prime Plumbing Group. It takes architectural drawings (the same DWG or PDF files your architects and builders send through), automatically reads the fixtures and pipework, matches them to your rate card, and produces a priced estimate you can export to Excel. It runs on a single computer in your office — no cloud, no subscription, no per-user seat fees.

Think of it as having a digital estimator that works 24/7, reads every drawing the same way, never forgets a fixture, and gets smarter each time you correct it.

## What does a typical job look like?

1. **Log in** from any computer on the office network using your work Google account.
2. **Create a project** — name, client, site address, and choose which rate card version to price against.
3. **Upload the drawings** — drag in the DWG, DXF or PDF files. You can drop up to 500 MB in one go.
4. **Wait a few minutes** while the system reads the drawings. It picks up toilets, basins, taps, pipe runs, fittings, legend symbols and schedule notes.
5. **Review the mappings.** The system shows you what it thinks each symbol on the drawing is and how it should be priced. You either tick "accept" or change it.
6. **Check the takeoff sheet.** Spreadsheet-style view with every fixture, quantity and where on the drawing it came from. Edit any quantity inline.
7. **Export to Excel.** You get a formatted spreadsheet with sections, subtotals, margin and a grand total — all live formulas, so your team can keep tweaking.

The first time you run a new type of drawing it can take a few minutes per plan. As the system learns your preferences, reviewing goes faster each time.

## What makes it different from Buildxact, Simpro, Groundplan or AroFlo?

Most Australian tools give you one of two things:
- **Digital measuring** (Groundplan, Bluebeam Revu) — you still click every fixture yourself; the software just stores the counts.
- **Job management with estimating modules** (Simpro, AroFlo, Buildxact) — good at quoting, scheduling and invoicing, but they still expect you to do the takeoff by hand or link out to another tool.

PPG Estimator does the takeoff automatically. It uses two techniques side by side:
- For CAD drawings (DWG/DXF), it literally reads the drawing file and counts the blocks — so it's exact, not a guess.
- For PDF scans, it uses AI vision (object detection + text recognition) to spot symbols and labels.
- It then asks Claude (Anthropic's AI) to match each symbol against your rate card, with reasoning you can audit.
- Every time you correct a mapping, it remembers. The next project with the same architect or builder needs fewer corrections.

US-based AI tools like Togal.AI, Beam AI, TaksoAi and Exayard do similar work, but they are cloud SaaS, US-priced, and usually built for the American market (imperial units, US fixture conventions, US rate structures). PPG Estimator is tuned to your rate card, your conventions, and stays on your own hardware.

## Is it secure?

Short version: for a LAN-only tool inside your office, it is solid. For going on the public internet or sharing with multiple companies, there is more work to do first.

**What's in place today**
- Login requires a Google work account on an approved email list. Random people cannot sign up.
- Each request to the system checks who you are and which company (tenant) you belong to.
- The database separates companies by tenant so, as soon as a second company is added, their data stays walled off.
- Files travel over HTTPS (encrypted) inside your network.
- The database uses parameterised queries, which is the standard defence against the most common style of hacking attack (SQL injection).
- Passwords for your database and API keys are kept out of the code and in an environment file on the server only.
- Nightly database backups run automatically and keep 30 days of history.

**What we haven't done yet (honest list)**
- No role separation. Today, every logged-in user can see everything. If you want "admin vs estimator" permissions, that's a next step.
- No rate limiting. A rogue insider could upload thousands of drawings in a row and run up an AI bill. Mitigated only by the fact that it's LAN-only.
- No virus scanning on uploaded files. Anyone who can log in could theoretically upload a malicious file. Again, LAN-only mitigates this.
- The HTTPS certificate is self-signed. That's fine inside the office but would need upgrading if you ever want remote access.

**Net:** inside your office with a trusted team, it is production-ready. Exposing it to the internet, adding external subcontractors, or running multiple plumbing companies on it would require a short hardening phase first.

## Is there a market for this?

Yes — but it's a market that's currently being filled by three types of tool and none of them hit the sweet spot for an Australian mid-size plumbing business:

1. **All-in-one job management** (Simpro, AroFlo, ServiceM8, Buildxact) — strong for quoting, scheduling and invoicing, weak on automated takeoff. Prices run A$100–A$300+ per user per month.
2. **Dedicated takeoff** (Groundplan, Bluebeam Revu, Countfire) — fast manual measuring, but you still do the counting. Groundplan is Aussie-built and popular with plumbers.
3. **US AI takeoff** (Togal.AI, Beam AI, TaksoAi, Exayard) — genuinely automates counting and measuring, but priced in USD, built for US fixture conventions, and is cloud SaaS — your drawings leave your network.

The gap is: **an Australian-tuned, AI-driven takeoff that keeps drawings private and plugs into your existing rate card.** That's exactly what PPG Estimator is. The wider Australian commercial plumbing industry (thousands of firms in the $5–50M band) has the same pain — architects still send messy PDFs, junior estimators take days per job, and margins are tight. A tool that compresses a 2-day takeoff into 2 hours has obvious commercial value.

Commercialising it would need: a clean UI polish, multi-tenant rollout (groundwork is already in), RBAC, cloud hosting option, a pricing model (we'd suggest per-drawing or per-project rather than per-seat), and a support function.

## Would I buy this as a $5–$10M plumbing company?

Honest answer: **yes, if the price and setup friction were right — but with eyes open.**

**What you get**
- Faster estimating. A typical commercial takeoff that takes a senior estimator a full day could realistically drop to a couple of hours. Even a 50% reduction on an estimator salary of A$120k saves A$60k/year, and you can bid more work.
- Consistency. Every estimate is priced against the same rate card in the same way. No more "Dave does it one way, Sam does it another."
- An audit trail on why each item was priced the way it was — useful for variations and client disputes.
- Drawings stay on your network. For government and defence jobs where confidentiality matters, that's a real advantage.
- You own it. No per-seat subscription creep.

**What you're trading off**
- You need someone in the office who is comfortable keeping a Docker-based server running. Not hard, but not zero either. Typically half a day a month.
- The AI costs money per drawing (cents, not dollars, but real). Budget a few hundred dollars a month in Claude API fees for a busy estimating team.
- It's version 1.0. There will be rough edges, and if something breaks on a Friday afternoon you're calling the developer, not a 24/7 support line.
- Features like remote access, mobile apps, scheduling, invoicing, purchase orders — these are not in scope. You still need your job-management tool for that. PPG Estimator is an *estimating* tool, not a replacement for Simpro or AroFlo.

**Verdict for a $5–$10M plumber**
- Buy it (or something like it) if: you run a dedicated estimating team, bid 5+ commercial jobs a month, have a stable rate card, and want margin accuracy.
- Don't buy it if: you're mainly service/maintenance, your jobs are small and repeat, and you already quote from memory. The ROI needs volume.

At typical Aussie commercial plumbing rates, the software pays for itself on roughly the third or fourth larger tender it helps win or price more accurately. That's the honest commercial case.

## What's the recommended next step?

1. Use it on every estimate for the next 90 days and track actual time saved versus the old workflow.
2. Pick a handful of repeat builders / architects and let the mapping feedback loop build up — that's where the accuracy curve really bends.
3. Start a short "hardening" list before opening it up beyond PPG: RBAC, rate limiting, upload scanning, cert upgrade.
4. If the 90-day numbers look good, decide whether to keep it internal or productise it for sale to other Australian plumbing firms. The technical groundwork (multi-tenant schema, per-tenant prompts and rate cards, per-tenant usage billing) is already there.
