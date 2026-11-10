# TAREQ AI — Source Capability Index Snapshot

Generated from `src/lib/capabilities/index.ts`. This file records source mappings and cited test references only; it is not production acceptance.

Use [the evidence-based register](PHASE1_100_CAPABILITY_REGISTER.md) for requirements, UI/API wiring, blockers and production evidence.

Total: 100; unique IDs: 100.

| Status | Count |
|---|---:|
| VERIFIED_PRODUCTION | 0 |
| IMPLEMENTED_NOT_VERIFIED | 19 |
| PARTIAL | 9 |
| UI_ONLY | 0 |
| BACKEND_ONLY | 72 |
| BLOCKED_BY_CONFIG | 0 |
| NOT_IMPLEMENTED | 0 |
| DEPRECATED_OR_DUPLICATE | 0 |

| # | Capability | Source status | Code mapping | Declared dependencies | Cited test/live reference |
|---:|---|---|---|---|---|
| 1 | Foundation & independent architecture | IMPLEMENTED_NOT_VERIFIED | `prisma/schema.prisma, src/lib/core/*` | postgresql, prisma | live run this session |
| 2 | Agent Orchestrator | IMPLEMENTED_NOT_VERIFIED | `src/lib/core/orchestrator.ts` | — | live run this session |
| 3 | Planner | IMPLEMENTED_NOT_VERIFIED | `src/lib/planner/index.ts` | — | tests/intent.test.ts |
| 4 | Durable Task Queue | IMPLEMENTED_NOT_VERIFIED | `src/lib/queue/tasks.ts` | postgresql, prisma | live run this session |
| 5 | Worker / Scheduler | PARTIAL | `worker/main.ts, src/lib/queue/scheduler.ts` | postgresql, prisma | live run this session |
| 6 | Tool Registry | IMPLEMENTED_NOT_VERIFIED | `src/lib/tools/registry.ts, src/lib/tools/index.ts` | — | live run this session |
| 7 | Permission Engine | IMPLEMENTED_NOT_VERIFIED | `src/lib/security/permissions.ts` | postgresql, prisma | tests/security.test.ts |
| 8 | Model Router & provider layer | IMPLEMENTED_NOT_VERIFIED | `src/lib/providers/*` | openai/deepseek | live run this session |
| 9 | Research (lawful sources) | IMPLEMENTED_NOT_VERIFIED | `src/lib/tools/research.ts, src/lib/integrations/publicdata.ts` | public-internet | tests/buyers.test.ts / tests/publicdata.test.ts |
| 10 | Demand validation | IMPLEMENTED_NOT_VERIFIED | `src/lib/commercial/engines.ts (advanceProof)` | — | tests/commercial.test.ts |
| 11 | Buyer discovery & scoring | IMPLEMENTED_NOT_VERIFIED | `src/lib/sales/leads.ts, src/lib/sales/discovery.ts, src/lib/integrations/buyers.ts` | postgresql, prisma, public-internet | tests/buyers.test.ts / tests/publicdata.test.ts |
| 12 | Competitor analysis | IMPLEMENTED_NOT_VERIFIED | `src/lib/commercial/engines.ts (predictCompetitorMoves, stressTest)` | — | tests/commercial.test.ts |
| 13 | Product building | PARTIAL | `src/lib/sandbox/exec.ts, src/lib/sandbox/persist.ts, src/lib/capabilities/engines.ts (productize)` | — | tests/sandbox.test.ts; tests/capabilities.test.ts |
| 14 | Service design | IMPLEMENTED_NOT_VERIFIED | `src/lib/capabilities/engines.ts (productize, designPov)` | — | tests/capabilities.test.ts |
| 15 | Sales pipeline | PARTIAL | `src/lib/sales/leads.ts, src/lib/sales/outreach.ts, src/lib/sales/discovery.ts (followUpPlan)` | postgresql, prisma | tests/buyers.test.ts / tests/publicdata.test.ts |
| 16 | Delivery & quality gates | IMPLEMENTED_NOT_VERIFIED | `src/lib/commercial/decision-engine.ts, src/lib/capabilities/engines.ts (verifyOutcome)` | postgresql, prisma | tests/capabilities.test.ts |
| 17 | Pricing & offers | IMPLEMENTED_NOT_VERIFIED | `src/lib/commercial/engines.ts (forgeMicroOffer, offerFit), src/lib/capabilities/engines.ts (painToCash)` | — | tests/commercial.test.ts; tests/capabilities.test.ts |
| 18 | Finance & profit accounting | PARTIAL | `src/lib/finance/ledger.ts, src/lib/finance/report.ts` | postgresql, prisma | tests/phase18-finance.test.ts |
| 19 | Memory (working/long-term) | IMPLEMENTED_NOT_VERIFIED | `src/lib/memory/index.ts` | postgresql, prisma | live run this session |
| 20 | Continuous operation (background) | PARTIAL | `worker/main.ts, src/lib/queue/scheduler.ts` | postgresql, prisma | live run this session |
| 21 | Security & governance | PARTIAL | `src/lib/security/*, src/lib/security/controls.ts, src/lib/core/logger.ts` | postgresql, prisma | tests/security.test.ts; tests/supervisor.test.ts |
| 22 | Testing | IMPLEMENTED_NOT_VERIFIED | `tests/*.test.ts` | — | live run this session |
| 23 | Recovery & retries | IMPLEMENTED_NOT_VERIFIED | `src/lib/queue/tasks.ts (reclaimStale, fail/backoff, dead letters), src/lib/core/supervisor.ts` | postgresql, prisma | tests/supervisor.test.ts |
| 24 | Observability | IMPLEMENTED_NOT_VERIFIED | `src/lib/observability/health.ts, src/lib/core/audit.ts, src/lib/commercial/optimization.ts` | postgresql, prisma | tests/optimization.test.ts |
| 25 | Audit logging (hash-chained) | IMPLEMENTED_NOT_VERIFIED | `src/lib/core/audit.ts` | postgresql, prisma | live run this session |
| 26 | Owner dashboard & API | PARTIAL | `src/app/server.ts, src/app/dashboard.html` | postgresql, prisma | tests/dashboard.test.ts |
| 27 | Integrations framework | PARTIAL | `src/lib/integrations/{telegram,gmail,hubspot,stripe}.ts` | gmail-oauth, hubspot-token | tests/integrations.test.ts |
| 28 | Notifications & approvals | PARTIAL | `src/lib/security/permissions.ts, src/lib/integrations/telegram.ts` | postgresql, prisma | tests/security.test.ts |
| 29 | Opportunity Genome — Commercial Knowledge Graph | BACKEND_ONLY | `src/lib/commercial/engines.ts (buildGenomeGraph)` | — | tests/commercial.test.ts |
| 30 | Buyer Intent Interceptor | BACKEND_ONLY | `engines.ts (scoreIntent)` | — | tests/commercial.test.ts |
| 31 | Demand Proof Ladder | BACKEND_ONLY | `engines.ts (advanceProof)` | — | tests/commercial.test.ts |
| 32 | Revenue Path Compiler | BACKEND_ONLY | `engines.ts (compileRevenuePath)` | — | tests/commercial.test.ts |
| 33 | Market White-Space Mapper | BACKEND_ONLY | `engines.ts (mapWhiteSpace)` | — | tests/commercial.test.ts |
| 34 | Buyer-Now Radar | BACKEND_ONLY | `engines.ts (rankBuyersNow)` | — | tests/commercial.test.ts |
| 35 | Decision-Maker Lock | BACKEND_ONLY | `engines.ts (lockDecisionMaker)` | — | tests/commercial.test.ts |
| 36 | Instant Value Leak Scanner | BACKEND_ONLY | `engines.ts (scanValueLeak)` | — | tests/commercial.test.ts |
| 37 | 90-Second Proof Engine | BACKEND_ONLY | `engines.ts (ninetySecondProof)` | — | tests/commercial.test.ts |
| 38 | Response-Time Sniper | BACKEND_ONLY | `engines.ts (responsePriority)` | — | tests/commercial.test.ts |
| 39 | Deal Revival Engine | BACKEND_ONLY | `engines.ts (revivalCandidates)` | — | tests/commercial.test.ts |
| 40 | One-Click Cash Path | BACKEND_ONLY | `engines.ts (oneClickCashPath)` | — | tests/commercial.test.ts |
| 41 | Micro-Offer Forge | BACKEND_ONLY | `engines.ts (forgeMicroOffer)` | — | tests/commercial.test.ts |
| 42 | Trust-Transfer Engine | BACKEND_ONLY | `src/lib/commercial/engines.ts (assessTrust, trustAssets)` | — | tests/trust-transfer.test.ts |
| 43 | Lead Memory Shield | BACKEND_ONLY | `engines.ts (shieldLeads)` | — | tests/commercial.test.ts |
| 44 | Market Pulse Anomaly Detector | BACKEND_ONLY | `engines.ts (detectAnomalies)` | — | tests/commercial.test.ts |
| 45 | Pain Cluster Fusion | BACKEND_ONLY | `engines.ts (fusePainClusters)` | — | tests/commercial.test.ts |
| 46 | Competitor Move Predictor | BACKEND_ONLY | `engines.ts (predictCompetitorMoves)` | — | tests/commercial.test.ts |
| 47 | Opportunity Expiry Clock | BACKEND_ONLY | `engines.ts (expiryClock)` | — | tests/commercial.test.ts |
| 48 | Demand Migration Tracker | BACKEND_ONLY | `engines.ts (demandMigration)` | — | tests/commercial.test.ts |
| 49 | Buying Friction Autopsy | BACKEND_ONLY | `engines.ts (autopsyFriction)` | — | tests/commercial.test.ts |
| 50 | Offer Fit Fingerprint | BACKEND_ONLY | `engines.ts (offerFit)` | — | tests/commercial.test.ts |
| 51 | Objection Preemption Lab | BACKEND_ONLY | `engines.ts (preemptObjections)` | — | tests/commercial.test.ts |
| 52 | Frictionless Purchase Architect | BACKEND_ONLY | `engines.ts (frictionlessCheckout)` | — | tests/commercial.test.ts |
| 53 | Conversation Momentum Engine | BACKEND_ONLY | `engines.ts (conversationMomentum)` | — | tests/commercial.test.ts |
| 54 | Task Critical Path Optimizer | BACKEND_ONLY | `engines.ts (criticalPath)` | — | tests/commercial.test.ts |
| 55 | Intelligence Cost Arbitrage | BACKEND_ONLY | `engines.ts (arbitrageModel)` | — | tests/commercial.test.ts |
| 56 | Reusable Asset Miner | BACKEND_ONLY | `engines.ts (mineAssets)` | — | tests/commercial.test.ts |
| 57 | Failure Containment Mesh | BACKEND_ONLY | `engines.ts (CircuitBreaker)` | — | tests/commercial.test.ts |
| 58 | Preflight Business Simulator | BACKEND_ONLY | `engines.ts (simulate)` | — | tests/commercial.test.ts |
| 59 | Marginal Profit Compass | BACKEND_ONLY | `engines.ts (marginalProfit)` | — | tests/commercial.test.ts |
| 60 | Cashflow Survival Engine | BACKEND_ONLY | `engines.ts (cashflowSurvival)` | — | tests/commercial.test.ts |
| 61 | Customer Value Expansion Graph | BACKEND_ONLY | `engines.ts (expansionGraph)` | — | tests/commercial.test.ts |
| 62 | Risk-Adjusted Opportunity Portfolio | BACKEND_ONLY | `engines.ts (riskPortfolio)` | — | tests/commercial.test.ts |
| 63 | Revenue Causality Lab | BACKEND_ONLY | `engines.ts (causalityLab)` | — | tests/commercial.test.ts |
| 64 | Revenue Opportunity DNA Mapper | BACKEND_ONLY | `src/lib/capabilities/engines.ts (opportunityDNA)` | — | tests/capabilities.test.ts |
| 65 | Live Willingness-to-Pay Laboratory | BACKEND_ONLY | `capabilities/engines.ts (wtpLab)` | — | tests/capabilities.test.ts |
| 66 | Pre-Sale Evidence Vault | BACKEND_ONLY | `src/lib/memory/evidence.ts, capabilities/engines.ts (publishableClaims)` | postgresql, prisma | tests/capabilities.test.ts |
| 67 | Customer Pain-to-Cash Compiler | BACKEND_ONLY | `capabilities/engines.ts (painToCash)` | — | tests/capabilities.test.ts |
| 68 | Demand Collision Detector | BACKEND_ONLY | `capabilities/engines.ts (demandCollisions)` | — | tests/capabilities.test.ts |
| 69 | Unserved Buyer Network | BACKEND_ONLY | `capabilities/engines.ts (unservedNetwork)` | — | tests/capabilities.test.ts |
| 70 | Commercial Timing Window Engine | BACKEND_ONLY | `capabilities/engines.ts (timingWindow)` | — | tests/capabilities.test.ts |
| 71 | Proof-of-Value Contract Designer | BACKEND_ONLY | `capabilities/engines.ts (designPov)` | — | tests/capabilities.test.ts |
| 72 | Revenue Precursor Detector | BACKEND_ONLY | `capabilities/engines.ts (precursorDetector)` | — | tests/capabilities.test.ts |
| 73 | Micro-Market Launch Sequencer | BACKEND_ONLY | `capabilities/engines.ts (sequenceLaunch)` | — | tests/capabilities.test.ts |
| 74 | Offer Cannibalization Sentinel | BACKEND_ONLY | `capabilities/engines.ts (cannibalization)` | — | tests/capabilities.test.ts |
| 75 | Delivery Capacity Forecaster | BACKEND_ONLY | `capabilities/engines.ts (capacityForecast)` | — | tests/capabilities.test.ts |
| 76 | Margin Leakage Forensics | BACKEND_ONLY | `capabilities/engines.ts (marginLeakage)` | — | tests/capabilities.test.ts |
| 77 | Customer Outcome Verification Engine | BACKEND_ONLY | `capabilities/engines.ts (verifyOutcome)` | — | tests/capabilities.test.ts |
| 78 | Ethical Demand Validation Simulator | BACKEND_ONLY | `capabilities/engines.ts (ethicalSimulation)` | — | tests/capabilities.test.ts |
| 79 | Revenue Dependency Breaker | BACKEND_ONLY | `capabilities/engines.ts (dependencyBreaker)` | — | tests/capabilities.test.ts |
| 80 | Buyer Objection Evidence Graph | BACKEND_ONLY | `capabilities/engines.ts (objectionEvidenceGraph)` | — | tests/capabilities.test.ts |
| 81 | Deal Probability Calibration Engine | BACKEND_ONLY | `capabilities/engines.ts (calibrate)` | — | tests/capabilities.test.ts |
| 82 | Revenue Recovery Investigator | BACKEND_ONLY | `capabilities/engines.ts (recoveryInvestigator)` | — | tests/capabilities.test.ts |
| 83 | Commercial Asset Yield Monitor | BACKEND_ONLY | `capabilities/engines.ts (assetYield)` | — | tests/capabilities.test.ts |
| 84 | Opportunity Kill-Switch Intelligence | BACKEND_ONLY | `capabilities/engines.ts (killSwitch), commercial/decision-engine.ts (kill)` | postgresql, prisma | tests/capabilities.test.ts |
| 85 | Competitive Response Stress Tester | BACKEND_ONLY | `capabilities/engines.ts (stressTest)` | — | tests/capabilities.test.ts |
| 86 | Customer Switching Cost Mapper | BACKEND_ONLY | `capabilities/engines.ts (switchingCost)` | — | tests/capabilities.test.ts |
| 87 | Cross-Border Revenue Route Planner | BACKEND_ONLY | `capabilities/engines.ts (crossBorderRoutes)` | — | tests/capabilities.test.ts |
| 88 | Revenue Collection Reliability Score | BACKEND_ONLY | `capabilities/engines.ts (collectionReliability)` | — | tests/capabilities.test.ts |
| 89 | Trust Deficit Repair Engine | BACKEND_ONLY | `capabilities/engines.ts (trustRepair)` | — | tests/capabilities.test.ts |
| 90 | Business Model Mutation Lab | BACKEND_ONLY | `capabilities/engines.ts (modelLab)` | — | tests/capabilities.test.ts |
| 91 | Autonomous Experiment Budget Governor | BACKEND_ONLY | `capabilities/engines.ts (ExperimentBudgetGovernor)` | — | tests/capabilities.test.ts |
| 92 | Multi-Channel Attribution Integrity Engine | BACKEND_ONLY | `capabilities/engines.ts (attributeDeals)` | — | tests/capabilities.test.ts |
| 93 | Service Failure Compensation Planner | BACKEND_ONLY | `capabilities/engines.ts (compensationPlan)` | — | tests/capabilities.test.ts |
| 94 | Hidden Workload Cost Detector | BACKEND_ONLY | `capabilities/engines.ts (hiddenWorkload)` | — | tests/capabilities.test.ts |
| 95 | Market Evidence Freshness Engine | BACKEND_ONLY | `capabilities/engines.ts (freshnessReport, FRESHNESS_DAYS)` | — | tests/capabilities.test.ts |
| 96 | Productized Service Assembly Line | BACKEND_ONLY | `capabilities/engines.ts (productize)` | — | tests/capabilities.test.ts |
| 97 | Revenue-to-Capability Feedback Loop | BACKEND_ONLY | `capabilities/engines.ts (capabilityFeedback)` | — | tests/capabilities.test.ts |
| 98 | Commercial Opportunity Collision Avoidance | BACKEND_ONLY | `capabilities/engines.ts (collisions)` | — | tests/capabilities.test.ts |
| 99 | First-Dollar Execution Navigator | BACKEND_ONLY | `capabilities/engines.ts (firstDollarNavigator)` | — | tests/capabilities.test.ts |
| 100 | Autonomous Commercial Governance Engine | BACKEND_ONLY | `capabilities/engines.ts (govern)` | — | tests/capabilities.test.ts |
