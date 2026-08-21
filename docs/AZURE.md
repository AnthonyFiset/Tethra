# Azure — Microsoft for Startups credits

_Updated 2026-08-21. These are the public, load-bearing facts. The full milestone
plan (balances, workload list, clock strategy) lives in `AZURE-PLAN.md` at the
repo root — **local-only and gitignored; never commit it**. No keys, balances, or
subscription identifiers belong in this file — see hard rule 12._

## Three hard facts

1. **Startup credits cannot buy Marketplace partner models.** Claude in Microsoft
   Foundry (GA since 2026-06-29) is a Marketplace partner offering, and
   credit-based subscriptions are explicitly excluded. With a card on file, the
   *card* is charged, not the credits. Azure OpenAI (first-party) works fine
   against credits. **Never design anything assuming credits can back Claude.**
2. **Milestones are workload-count driven, not spend driven,** until the top
   tier: 5 workloads → $25k, 7 → $50k, 10 + $3k/month spend → $150k — each
   sustained over ~60 continuous days.
3. **Milestone 3 grants a one-time two-year credit extension.** Current expiry is
   **2027-04-13**. The extension is worth more than the credit increase.

## How this shapes the product

- Anthony's personal Assist default is **Azure OpenAI on startup credits** — the
  preset ships in the catalog; the key lives in local app settings only
  ([`ROADMAP.md`](../ROADMAP.md) Part 5, Phase 1).
- The one legitimate product use for the credits is **hosting the Phase 2
  ciphertext-only sync prototype**.
- **Azure Trusted Signing** ($9.99/mo, Windows code signing) is restricted to
  US/CA/EU/UK registered entities — verify eligibility before planning around it
  ([`ROADMAP.md`](../ROADMAP.md) §3.4).
