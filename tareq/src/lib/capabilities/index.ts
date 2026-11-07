/**
 * Capability index — the single source of truth for the 100 feature groups.
 *
 * `status` reflects reality, not aspiration:
 *   implemented  - has working code + tests
 *   partial      - code exists but is incomplete or untested
 *   planned      - specified, not yet built
 *   blocked      - needs an external decision, key or resource
 *
 * `code` points at the module that implements it so the acceptance table maps
 * 1:1 to source. Nothing is marked `implemented` without a passing test.
 */

export type CapStatus = 'implemented' | 'partial' | 'planned' | 'blocked';

export interface Capability {
  n: number;
  name: string;
  status: CapStatus;
  code?: string;
  notes?: string;
}

export const CAPABILITIES: Capability[] = [
  // 1-28 — core platform, agent, research, demand, products, sales, profit, memory, ops, security, tests, recovery
  { n: 1, name: 'Foundation & independent architecture', status: 'implemented', code: 'prisma/schema.prisma, src/lib/core/*' },
  { n: 2, name: 'Agent Orchestrator', status: 'implemented', code: 'src/lib/core/orchestrator.ts' },
  { n: 3, name: 'Planner', status: 'implemented', code: 'src/lib/planner/index.ts' },
  { n: 4, name: 'Durable Task Queue', status: 'implemented', code: 'src/lib/queue/tasks.ts' },
  { n: 5, name: 'Worker / Scheduler', status: 'implemented', code: 'worker/main.ts, src/lib/queue/scheduler.ts' },
  { n: 6, name: 'Tool Registry', status: 'implemented', code: 'src/lib/tools/registry.ts' },
  { n: 7, name: 'Permission Engine', status: 'implemented', code: 'src/lib/security/permissions.ts' },
  { n: 8, name: 'Model Router & provider layer', status: 'implemented', code: 'src/lib/providers/*' },
  { n: 9, name: 'Research (lawful sources)', status: 'partial', code: 'src/lib/tools/research.ts', notes: 'source fetch + evidence recording; live web search connector pending' },
  { n: 10, name: 'Demand validation', status: 'implemented', code: 'src/lib/commercial/engines.ts (advanceProof)' },
  { n: 11, name: 'Buyer discovery & scoring', status: 'implemented', code: 'src/lib/sales/leads.ts' },
  { n: 12, name: 'Competitor analysis', status: 'implemented', code: 'src/lib/commercial/engines.ts (predictCompetitorMoves, stressTest)' },
  { n: 13, name: 'Product building', status: 'partial', code: 'src/lib/capabilities/engines.ts (productize)', notes: 'process productisation done; sandboxed code execution pending' },
  { n: 14, name: 'Service design', status: 'implemented', code: 'src/lib/capabilities/engines.ts (productize, designPov)' },
  { n: 15, name: 'Sales pipeline', status: 'implemented', code: 'src/lib/sales/leads.ts, src/lib/sales/outreach.ts' },
  { n: 16, name: 'Delivery & quality gates', status: 'implemented', code: 'src/lib/commercial/decision-engine.ts, src/lib/capabilities/engines.ts (verifyOutcome)' },
  { n: 17, name: 'Pricing & offers', status: 'implemented', code: 'src/lib/commercial/engines.ts (forgeMicroOffer, offerFit), src/lib/capabilities/engines.ts (painToCash)' },
  { n: 18, name: 'Finance & profit accounting', status: 'implemented', code: 'src/lib/finance/ledger.ts' },
  { n: 19, name: 'Memory (working/long-term)', status: 'implemented', code: 'src/lib/memory/index.ts' },
  { n: 20, name: 'Continuous operation (background)', status: 'implemented', code: 'worker/main.ts, src/lib/queue/scheduler.ts' },
  { n: 21, name: 'Security & governance', status: 'implemented', code: 'src/lib/security/*, src/lib/core/logger.ts' },
  { n: 22, name: 'Testing', status: 'implemented', code: 'tests/*.test.ts' },
  { n: 23, name: 'Recovery & retries', status: 'implemented', code: 'src/lib/queue/tasks.ts (reclaimStale, fail/backoff, dead letters)' },
  { n: 24, name: 'Observability', status: 'implemented', code: 'src/lib/observability/health.ts, src/lib/core/audit.ts' },
  { n: 25, name: 'Audit logging (hash-chained)', status: 'implemented', code: 'src/lib/core/audit.ts' },
  { n: 26, name: 'Owner dashboard & API', status: 'partial', code: 'src/app/server.ts', notes: 'API complete; visual dashboard planned in Phase 3 UI pass' },
  { n: 27, name: 'Integrations framework', status: 'partial', code: 'src/lib/integrations/telegram.ts', notes: 'Telegram done; email/CRM connectors planned' },
  { n: 28, name: 'Notifications & approvals', status: 'implemented', code: 'src/lib/security/permissions.ts, src/lib/integrations/telegram.ts' },

  // 29-43 — commercial intelligence (Phase 6)
  { n: 29, name: 'Opportunity Genome — Commercial Knowledge Graph', status: 'implemented', code: 'src/lib/commercial/engines.ts (buildGenomeGraph)' },
  { n: 30, name: 'Buyer Intent Interceptor', status: 'implemented', code: 'engines.ts (scoreIntent)' },
  { n: 31, name: 'Demand Proof Ladder', status: 'implemented', code: 'engines.ts (advanceProof)' },
  { n: 32, name: 'Revenue Path Compiler', status: 'implemented', code: 'engines.ts (compileRevenuePath)' },
  { n: 33, name: 'Market White-Space Mapper', status: 'implemented', code: 'engines.ts (mapWhiteSpace)' },
  { n: 34, name: 'Buyer-Now Radar', status: 'implemented', code: 'engines.ts (rankBuyersNow)' },
  { n: 35, name: 'Decision-Maker Lock', status: 'implemented', code: 'engines.ts (lockDecisionMaker)' },
  { n: 36, name: 'Instant Value Leak Scanner', status: 'implemented', code: 'engines.ts (scanValueLeak)' },
  { n: 37, name: '90-Second Proof Engine', status: 'implemented', code: 'engines.ts (ninetySecondProof)' },
  { n: 38, name: 'Response-Time Sniper', status: 'implemented', code: 'engines.ts (responsePriority)' },
  { n: 39, name: 'Deal Revival Engine', status: 'implemented', code: 'engines.ts (revivalCandidates)' },
  { n: 40, name: 'One-Click Cash Path', status: 'implemented', code: 'engines.ts (oneClickCashPath)' },
  { n: 41, name: 'Micro-Offer Forge', status: 'implemented', code: 'engines.ts (forgeMicroOffer)' },
  { n: 42, name: 'Trust-Transfer Engine', status: 'implemented', code: 'engines.ts (trustAssets)' },
  { n: 43, name: 'Lead Memory Shield', status: 'implemented', code: 'engines.ts (shieldLeads)' },

  // 44-63
  { n: 44, name: 'Market Pulse Anomaly Detector', status: 'implemented', code: 'engines.ts (detectAnomalies)' },
  { n: 45, name: 'Pain Cluster Fusion', status: 'implemented', code: 'engines.ts (fusePainClusters)' },
  { n: 46, name: 'Competitor Move Predictor', status: 'implemented', code: 'engines.ts (predictCompetitorMoves)' },
  { n: 47, name: 'Opportunity Expiry Clock', status: 'implemented', code: 'engines.ts (expiryClock)' },
  { n: 48, name: 'Demand Migration Tracker', status: 'implemented', code: 'engines.ts (demandMigration)' },
  { n: 49, name: 'Buying Friction Autopsy', status: 'implemented', code: 'engines.ts (autopsyFriction)' },
  { n: 50, name: 'Offer Fit Fingerprint', status: 'implemented', code: 'engines.ts (offerFit)' },
  { n: 51, name: 'Objection Preemption Lab', status: 'implemented', code: 'engines.ts (preemptObjections)' },
  { n: 52, name: 'Frictionless Purchase Architect', status: 'implemented', code: 'engines.ts (frictionlessCheckout)' },
  { n: 53, name: 'Conversation Momentum Engine', status: 'implemented', code: 'engines.ts (conversationMomentum)' },
  { n: 54, name: 'Task Critical Path Optimizer', status: 'implemented', code: 'engines.ts (criticalPath)' },
  { n: 55, name: 'Intelligence Cost Arbitrage', status: 'implemented', code: 'engines.ts (arbitrageModel)' },
  { n: 56, name: 'Reusable Asset Miner', status: 'implemented', code: 'engines.ts (mineAssets)' },
  { n: 57, name: 'Failure Containment Mesh', status: 'implemented', code: 'engines.ts (CircuitBreaker)' },
  { n: 58, name: 'Preflight Business Simulator', status: 'implemented', code: 'engines.ts (simulate)' },
  { n: 59, name: 'Marginal Profit Compass', status: 'implemented', code: 'engines.ts (marginalProfit)' },
  { n: 60, name: 'Cashflow Survival Engine', status: 'implemented', code: 'engines.ts (cashflowSurvival)' },
  { n: 61, name: 'Customer Value Expansion Graph', status: 'implemented', code: 'engines.ts (expansionGraph)' },
  { n: 62, name: 'Risk-Adjusted Opportunity Portfolio', status: 'implemented', code: 'engines.ts (riskPortfolio)' },
  { n: 63, name: 'Revenue Causality Lab', status: 'implemented', code: 'engines.ts (causalityLab)' },

  // 64-100 — new capabilities
  { n: 64, name: 'Revenue Opportunity DNA Mapper', status: 'implemented', code: 'src/lib/capabilities/engines.ts (opportunityDNA)' },
  { n: 65, name: 'Live Willingness-to-Pay Laboratory', status: 'implemented', code: 'capabilities/engines.ts (wtpLab)' },
  { n: 66, name: 'Pre-Sale Evidence Vault', status: 'implemented', code: 'src/lib/memory/evidence.ts, capabilities/engines.ts (publishableClaims)' },
  { n: 67, name: 'Customer Pain-to-Cash Compiler', status: 'implemented', code: 'capabilities/engines.ts (painToCash)' },
  { n: 68, name: 'Demand Collision Detector', status: 'implemented', code: 'capabilities/engines.ts (demandCollisions)' },
  { n: 69, name: 'Unserved Buyer Network', status: 'implemented', code: 'capabilities/engines.ts (unservedNetwork)' },
  { n: 70, name: 'Commercial Timing Window Engine', status: 'implemented', code: 'capabilities/engines.ts (timingWindow)' },
  { n: 71, name: 'Proof-of-Value Contract Designer', status: 'implemented', code: 'capabilities/engines.ts (designPov)' },
  { n: 72, name: 'Revenue Precursor Detector', status: 'implemented', code: 'capabilities/engines.ts (precursorDetector)' },
  { n: 73, name: 'Micro-Market Launch Sequencer', status: 'implemented', code: 'capabilities/engines.ts (sequenceLaunch)' },
  { n: 74, name: 'Offer Cannibalization Sentinel', status: 'implemented', code: 'capabilities/engines.ts (cannibalization)' },
  { n: 75, name: 'Delivery Capacity Forecaster', status: 'implemented', code: 'capabilities/engines.ts (capacityForecast)' },
  { n: 76, name: 'Margin Leakage Forensics', status: 'implemented', code: 'capabilities/engines.ts (marginLeakage)' },
  { n: 77, name: 'Customer Outcome Verification Engine', status: 'implemented', code: 'capabilities/engines.ts (verifyOutcome)' },
  { n: 78, name: 'Ethical Demand Validation Simulator', status: 'implemented', code: 'capabilities/engines.ts (ethicalSimulation)' },
  { n: 79, name: 'Revenue Dependency Breaker', status: 'implemented', code: 'capabilities/engines.ts (dependencyBreaker)' },
  { n: 80, name: 'Buyer Objection Evidence Graph', status: 'implemented', code: 'capabilities/engines.ts (objectionEvidenceGraph)' },
  { n: 81, name: 'Deal Probability Calibration Engine', status: 'implemented', code: 'capabilities/engines.ts (calibrate)' },
  { n: 82, name: 'Revenue Recovery Investigator', status: 'implemented', code: 'capabilities/engines.ts (recoveryInvestigator)' },
  { n: 83, name: 'Commercial Asset Yield Monitor', status: 'implemented', code: 'capabilities/engines.ts (assetYield)' },
  { n: 84, name: 'Opportunity Kill-Switch Intelligence', status: 'implemented', code: 'capabilities/engines.ts (killSwitch), commercial/decision-engine.ts (kill)' },
  { n: 85, name: 'Competitive Response Stress Tester', status: 'implemented', code: 'capabilities/engines.ts (stressTest)' },
  { n: 86, name: 'Customer Switching Cost Mapper', status: 'implemented', code: 'capabilities/engines.ts (switchingCost)' },
  { n: 87, name: 'Cross-Border Revenue Route Planner', status: 'implemented', code: 'capabilities/engines.ts (crossBorderRoutes)' },
  { n: 88, name: 'Revenue Collection Reliability Score', status: 'implemented', code: 'capabilities/engines.ts (collectionReliability)' },
  { n: 89, name: 'Trust Deficit Repair Engine', status: 'implemented', code: 'capabilities/engines.ts (trustRepair)' },
  { n: 90, name: 'Business Model Mutation Lab', status: 'implemented', code: 'capabilities/engines.ts (modelLab)' },
  { n: 91, name: 'Autonomous Experiment Budget Governor', status: 'implemented', code: 'capabilities/engines.ts (ExperimentBudgetGovernor)' },
  { n: 92, name: 'Multi-Channel Attribution Integrity Engine', status: 'implemented', code: 'capabilities/engines.ts (attributeDeals)' },
  { n: 93, name: 'Service Failure Compensation Planner', status: 'implemented', code: 'capabilities/engines.ts (compensationPlan)' },
  { n: 94, name: 'Hidden Workload Cost Detector', status: 'implemented', code: 'capabilities/engines.ts (hiddenWorkload)' },
  { n: 95, name: 'Market Evidence Freshness Engine', status: 'implemented', code: 'capabilities/engines.ts (freshnessReport, FRESHNESS_DAYS)' },
  { n: 96, name: 'Productized Service Assembly Line', status: 'implemented', code: 'capabilities/engines.ts (productize)' },
  { n: 97, name: 'Revenue-to-Capability Feedback Loop', status: 'implemented', code: 'capabilities/engines.ts (capabilityFeedback)' },
  { n: 98, name: 'Commercial Opportunity Collision Avoidance', status: 'implemented', code: 'capabilities/engines.ts (collisions)' },
  { n: 99, name: 'First-Dollar Execution Navigator', status: 'implemented', code: 'capabilities/engines.ts (firstDollarNavigator)' },
  { n: 100, name: 'Autonomous Commercial Governance Engine', status: 'implemented', code: 'capabilities/engines.ts (govern)' },
];

export function summary(): Record<CapStatus, number> {
  const out: Record<CapStatus, number> = { implemented: 0, partial: 0, planned: 0, blocked: 0 };
  for (const c of CAPABILITIES) out[c.status]++;
  return out;
}

export function getCapability(n: number): Capability | undefined {
  return CAPABILITIES.find((c) => c.n === n);
}
