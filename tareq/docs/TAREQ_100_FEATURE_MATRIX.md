# TAREQ 100 Feature Matrix

Generated from `src/lib/capabilities/index.ts` — the single source of truth.
Statuses reflect code + tests, not aspiration.

## Status totals

| Status | Count |
|---|---|
| implemented | 98 |
| partial | 2 |
| planned | 0 |
| blocked | 0 |
| **total** | **100** |

## Groups

| # | Capability | Status | Code | Notes |
|---|---|---|---|---|
| 1 | Foundation & independent architecture | implemented | `prisma/schema.prisma, src/lib/core/*` |  |
| 2 | Agent Orchestrator | implemented | `src/lib/core/orchestrator.ts` |  |
| 3 | Planner | implemented | `src/lib/planner/index.ts` |  |
| 4 | Durable Task Queue | implemented | `src/lib/queue/tasks.ts` |  |
| 5 | Worker / Scheduler | implemented | `worker/main.ts, src/lib/queue/scheduler.ts` |  |
| 6 | Tool Registry | implemented | `src/lib/tools/registry.ts, src/lib/tools/index.ts` |  |
| 7 | Permission Engine | implemented | `src/lib/security/permissions.ts` |  |
| 8 | Model Router & provider layer | implemented | `src/lib/providers/*` |  |
| 9 | Research (lawful sources) | implemented | `src/lib/tools/research.ts, src/lib/integrations/publicdata.ts` | public URL fetch + keyless public-data demand scan (HN Algolia, Wikipedia); free, no paid search key |
| 10 | Demand validation | implemented | `src/lib/commercial/engines.ts (advanceProof)` |  |
| 11 | Buyer discovery & scoring | implemented | `src/lib/sales/leads.ts` |  |
| 12 | Competitor analysis | implemented | `src/lib/commercial/engines.ts (predictCompetitorMoves, stressTest)` |  |
| 13 | Product building | partial | `src/lib/capabilities/engines.ts (productize)` | process productisation done; sandboxed code execution pending |
| 14 | Service design | implemented | `src/lib/capabilities/engines.ts (productize, designPov)` |  |
| 15 | Sales pipeline | implemented | `src/lib/sales/leads.ts, src/lib/sales/outreach.ts` |  |
| 16 | Delivery & quality gates | implemented | `src/lib/commercial/decision-engine.ts, src/lib/capabilities/engines.ts (verifyOutcome)` |  |
| 17 | Pricing & offers | implemented | `src/lib/commercial/engines.ts (forgeMicroOffer, offerFit), src/lib/capabilities/engines.ts (painToCash)` |  |
| 18 | Finance & profit accounting | implemented | `src/lib/finance/ledger.ts` |  |
| 19 | Memory (working/long-term) | implemented | `src/lib/memory/index.ts` |  |
| 20 | Continuous operation (background) | implemented | `worker/main.ts, src/lib/queue/scheduler.ts` |  |
| 21 | Security & governance | implemented | `src/lib/security/*, src/lib/core/logger.ts` |  |
| 22 | Testing | implemented | `tests/*.test.ts` |  |
| 23 | Recovery & retries | implemented | `src/lib/queue/tasks.ts (reclaimStale, fail/backoff, dead letters)` |  |
| 24 | Observability | implemented | `src/lib/observability/health.ts, src/lib/core/audit.ts` |  |
| 25 | Audit logging (hash-chained) | implemented | `src/lib/core/audit.ts` |  |
| 26 | Owner dashboard & API | implemented | `src/app/server.ts, src/app/dashboard.html` | API + bilingual (AR/EN) responsive dashboard served at /; all metrics from persisted data |
| 27 | Integrations framework | partial | `src/lib/integrations/telegram.ts` | Telegram done; email/CRM connectors planned |
| 28 | Notifications & approvals | implemented | `src/lib/security/permissions.ts, src/lib/integrations/telegram.ts` |  |
| 29 | Opportunity Genome — Commercial Knowledge Graph | implemented | `src/lib/commercial/engines.ts (buildGenomeGraph)` |  |
| 30 | Buyer Intent Interceptor | implemented | `engines.ts (scoreIntent)` |  |
| 31 | Demand Proof Ladder | implemented | `engines.ts (advanceProof)` |  |
| 32 | Revenue Path Compiler | implemented | `engines.ts (compileRevenuePath)` |  |
| 33 | Market White-Space Mapper | implemented | `engines.ts (mapWhiteSpace)` |  |
| 34 | Buyer-Now Radar | implemented | `engines.ts (rankBuyersNow)` |  |
| 35 | Decision-Maker Lock | implemented | `engines.ts (lockDecisionMaker)` |  |
| 36 | Instant Value Leak Scanner | implemented | `engines.ts (scanValueLeak)` |  |
| 37 | 90-Second Proof Engine | implemented | `engines.ts (ninetySecondProof)` |  |
| 38 | Response-Time Sniper | implemented | `engines.ts (responsePriority)` |  |
| 39 | Deal Revival Engine | implemented | `engines.ts (revivalCandidates)` |  |
| 40 | One-Click Cash Path | implemented | `engines.ts (oneClickCashPath)` |  |
| 41 | Micro-Offer Forge | implemented | `engines.ts (forgeMicroOffer)` |  |
| 42 | Trust-Transfer Engine | implemented | `engines.ts (trustAssets)` |  |
| 43 | Lead Memory Shield | implemented | `engines.ts (shieldLeads)` |  |
| 44 | Market Pulse Anomaly Detector | implemented | `engines.ts (detectAnomalies)` |  |
| 45 | Pain Cluster Fusion | implemented | `engines.ts (fusePainClusters)` |  |
| 46 | Competitor Move Predictor | implemented | `engines.ts (predictCompetitorMoves)` |  |
| 47 | Opportunity Expiry Clock | implemented | `engines.ts (expiryClock)` |  |
| 48 | Demand Migration Tracker | implemented | `engines.ts (demandMigration)` |  |
| 49 | Buying Friction Autopsy | implemented | `engines.ts (autopsyFriction)` |  |
| 50 | Offer Fit Fingerprint | implemented | `engines.ts (offerFit)` |  |
| 51 | Objection Preemption Lab | implemented | `engines.ts (preemptObjections)` |  |
| 52 | Frictionless Purchase Architect | implemented | `engines.ts (frictionlessCheckout)` |  |
| 53 | Conversation Momentum Engine | implemented | `engines.ts (conversationMomentum)` |  |
| 54 | Task Critical Path Optimizer | implemented | `engines.ts (criticalPath)` |  |
| 55 | Intelligence Cost Arbitrage | implemented | `engines.ts (arbitrageModel)` |  |
| 56 | Reusable Asset Miner | implemented | `engines.ts (mineAssets)` |  |
| 57 | Failure Containment Mesh | implemented | `engines.ts (CircuitBreaker)` |  |
| 58 | Preflight Business Simulator | implemented | `engines.ts (simulate)` |  |
| 59 | Marginal Profit Compass | implemented | `engines.ts (marginalProfit)` |  |
| 60 | Cashflow Survival Engine | implemented | `engines.ts (cashflowSurvival)` |  |
| 61 | Customer Value Expansion Graph | implemented | `engines.ts (expansionGraph)` |  |
| 62 | Risk-Adjusted Opportunity Portfolio | implemented | `engines.ts (riskPortfolio)` |  |
| 63 | Revenue Causality Lab | implemented | `engines.ts (causalityLab)` |  |
| 64 | Revenue Opportunity DNA Mapper | implemented | `src/lib/capabilities/engines.ts (opportunityDNA)` |  |
| 65 | Live Willingness-to-Pay Laboratory | implemented | `capabilities/engines.ts (wtpLab)` |  |
| 66 | Pre-Sale Evidence Vault | implemented | `src/lib/memory/evidence.ts, capabilities/engines.ts (publishableClaims)` |  |
| 67 | Customer Pain-to-Cash Compiler | implemented | `capabilities/engines.ts (painToCash)` |  |
| 68 | Demand Collision Detector | implemented | `capabilities/engines.ts (demandCollisions)` |  |
| 69 | Unserved Buyer Network | implemented | `capabilities/engines.ts (unservedNetwork)` |  |
| 70 | Commercial Timing Window Engine | implemented | `capabilities/engines.ts (timingWindow)` |  |
| 71 | Proof-of-Value Contract Designer | implemented | `capabilities/engines.ts (designPov)` |  |
| 72 | Revenue Precursor Detector | implemented | `capabilities/engines.ts (precursorDetector)` |  |
| 73 | Micro-Market Launch Sequencer | implemented | `capabilities/engines.ts (sequenceLaunch)` |  |
| 74 | Offer Cannibalization Sentinel | implemented | `capabilities/engines.ts (cannibalization)` |  |
| 75 | Delivery Capacity Forecaster | implemented | `capabilities/engines.ts (capacityForecast)` |  |
| 76 | Margin Leakage Forensics | implemented | `capabilities/engines.ts (marginLeakage)` |  |
| 77 | Customer Outcome Verification Engine | implemented | `capabilities/engines.ts (verifyOutcome)` |  |
| 78 | Ethical Demand Validation Simulator | implemented | `capabilities/engines.ts (ethicalSimulation)` |  |
| 79 | Revenue Dependency Breaker | implemented | `capabilities/engines.ts (dependencyBreaker)` |  |
| 80 | Buyer Objection Evidence Graph | implemented | `capabilities/engines.ts (objectionEvidenceGraph)` |  |
| 81 | Deal Probability Calibration Engine | implemented | `capabilities/engines.ts (calibrate)` |  |
| 82 | Revenue Recovery Investigator | implemented | `capabilities/engines.ts (recoveryInvestigator)` |  |
| 83 | Commercial Asset Yield Monitor | implemented | `capabilities/engines.ts (assetYield)` |  |
| 84 | Opportunity Kill-Switch Intelligence | implemented | `capabilities/engines.ts (killSwitch), commercial/decision-engine.ts (kill)` |  |
| 85 | Competitive Response Stress Tester | implemented | `capabilities/engines.ts (stressTest)` |  |
| 86 | Customer Switching Cost Mapper | implemented | `capabilities/engines.ts (switchingCost)` |  |
| 87 | Cross-Border Revenue Route Planner | implemented | `capabilities/engines.ts (crossBorderRoutes)` |  |
| 88 | Revenue Collection Reliability Score | implemented | `capabilities/engines.ts (collectionReliability)` |  |
| 89 | Trust Deficit Repair Engine | implemented | `capabilities/engines.ts (trustRepair)` |  |
| 90 | Business Model Mutation Lab | implemented | `capabilities/engines.ts (modelLab)` |  |
| 91 | Autonomous Experiment Budget Governor | implemented | `capabilities/engines.ts (ExperimentBudgetGovernor)` |  |
| 92 | Multi-Channel Attribution Integrity Engine | implemented | `capabilities/engines.ts (attributeDeals)` |  |
| 93 | Service Failure Compensation Planner | implemented | `capabilities/engines.ts (compensationPlan)` |  |
| 94 | Hidden Workload Cost Detector | implemented | `capabilities/engines.ts (hiddenWorkload)` |  |
| 95 | Market Evidence Freshness Engine | implemented | `capabilities/engines.ts (freshnessReport, FRESHNESS_DAYS)` |  |
| 96 | Productized Service Assembly Line | implemented | `capabilities/engines.ts (productize)` |  |
| 97 | Revenue-to-Capability Feedback Loop | implemented | `capabilities/engines.ts (capabilityFeedback)` |  |
| 98 | Commercial Opportunity Collision Avoidance | implemented | `capabilities/engines.ts (collisions)` |  |
| 99 | First-Dollar Execution Navigator | implemented | `capabilities/engines.ts (firstDollarNavigator)` |  |
| 100 | Autonomous Commercial Governance Engine | implemented | `capabilities/engines.ts (govern)` |  |

## Note on groups 1-63

The original detailed specification for the first 63 groups could not be
recovered from the repository. Their requirements above are reconstructed
from the existing implementation and are labelled accordingly. Groups 64-100
follow the directive's list directly.
