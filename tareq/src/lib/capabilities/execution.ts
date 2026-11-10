/**
 * Owner-only, side-effect-free execution path for the 72 analytical engine
 * groups (29–100). The caller supplies data; results are computations, not
 * evidence of a real buyer, payment, demand, or production acceptance.
 *
 * This explicit allow-list is intentionally NOT a dynamic import/eval router.
 * The HTTP route authenticates owner sessions before calling this module.
 */
import * as commercial from '../commercial/engines.ts';
import * as advanced from './engines.ts';
import { getCapability } from './index.ts';

type Family = 'commercial' | 'advanced';
const ENGINE_SPECS: Readonly<Record<number, readonly [Family, string]>> = {
  29: ['commercial', 'buildGenomeGraph'],
  30: ['commercial', 'scoreIntent'],
  31: ['commercial', 'advanceProof'],
  32: ['commercial', 'compileRevenuePath'],
  33: ['commercial', 'mapWhiteSpace'],
  34: ['commercial', 'rankBuyersNow'],
  35: ['commercial', 'lockDecisionMaker'],
  36: ['commercial', 'scanValueLeak'],
  37: ['commercial', 'ninetySecondProof'],
  38: ['commercial', 'responsePriority'],
  39: ['commercial', 'revivalCandidates'],
  40: ['commercial', 'oneClickCashPath'],
  41: ['commercial', 'forgeMicroOffer'],
  42: ['commercial', 'assessTrust'],
  43: ['commercial', 'shieldLeads'],
  44: ['commercial', 'detectAnomalies'],
  45: ['commercial', 'fusePainClusters'],
  46: ['commercial', 'predictCompetitorMoves'],
  47: ['commercial', 'expiryClock'],
  48: ['commercial', 'demandMigration'],
  49: ['commercial', 'autopsyFriction'],
  50: ['commercial', 'offerFit'],
  51: ['commercial', 'preemptObjections'],
  52: ['commercial', 'frictionlessCheckout'],
  53: ['commercial', 'conversationMomentum'],
  54: ['commercial', 'criticalPath'],
  55: ['commercial', 'arbitrageModel'],
  56: ['commercial', 'mineAssets'],
  57: ['commercial', 'CircuitBreaker'],
  58: ['commercial', 'simulate'],
  59: ['commercial', 'marginalProfit'],
  60: ['commercial', 'cashflowSurvival'],
  61: ['commercial', 'expansionGraph'],
  62: ['commercial', 'riskPortfolio'],
  63: ['commercial', 'causalityLab'],
  64: ['advanced', 'opportunityDNA'],
  65: ['advanced', 'wtpLab'],
  66: ['advanced', 'publishableClaims'],
  67: ['advanced', 'painToCash'],
  68: ['advanced', 'demandCollisions'],
  69: ['advanced', 'unservedNetwork'],
  70: ['advanced', 'timingWindow'],
  71: ['advanced', 'designPov'],
  72: ['advanced', 'precursorDetector'],
  73: ['advanced', 'sequenceLaunch'],
  74: ['advanced', 'cannibalization'],
  75: ['advanced', 'capacityForecast'],
  76: ['advanced', 'marginLeakage'],
  77: ['advanced', 'verifyOutcome'],
  78: ['advanced', 'ethicalSimulation'],
  79: ['advanced', 'dependencyBreaker'],
  80: ['advanced', 'objectionEvidenceGraph'],
  81: ['advanced', 'calibrate'],
  82: ['advanced', 'recoveryInvestigator'],
  83: ['advanced', 'assetYield'],
  84: ['advanced', 'killSwitch'],
  85: ['advanced', 'stressTest'],
  86: ['advanced', 'switchingCost'],
  87: ['advanced', 'crossBorderRoutes'],
  88: ['advanced', 'collectionReliability'],
  89: ['advanced', 'trustRepair'],
  90: ['advanced', 'modelLab'],
  91: ['advanced', 'ExperimentBudgetGovernor'],
  92: ['advanced', 'attributeDeals'],
  93: ['advanced', 'compensationPlan'],
  94: ['advanced', 'hiddenWorkload'],
  95: ['advanced', 'freshnessReport'],
  96: ['advanced', 'productize'],
  97: ['advanced', 'capabilityFeedback'],
  98: ['advanced', 'collisions'],
  99: ['advanced', 'firstDollarNavigator'],
  100: ['advanced', 'govern'],
};

export const ANALYTICAL_CAPABILITY_IDS = Object.freeze(
  Object.keys(ENGINE_SPECS).map(Number).sort((a, b) => a - b),
);

function checkJson(value: unknown, depth = 0): void {
  if (depth > 7) throw new Error('input nesting exceeds limit');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (value.length > 2048) throw new Error('input string too long');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number not allowed');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw new Error('input array too long');
    for (const item of value) checkJson(item, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new Error('input must be JSON data');
    }
    const keys = Object.keys(value);
    if (keys.length > 60) throw new Error('too many object properties');
    for (const key of keys) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new Error('unsafe input property');
      }
      checkJson((value as Record<string, unknown>)[key], depth + 1);
    }
    return;
  }
  throw new Error('input must be JSON data');
}

/** For internal diagnostics and owner interface only, never a public tool. */
export function analyticalCapabilityInfo(n: number): { id: number; engine: string } | null {
  const spec = ENGINE_SPECS[n];
  return spec ? { id: n, engine: spec[0] + '.' + spec[1] } : null;
}

/**
 * Only invokes pure analysis functions. Classes are handled with bounded local
 * simulations, not persistent mutation of the owner's spending controls.
 */
export function evaluateAnalyticalCapability(n: number, args: unknown[]) {
  const spec = ENGINE_SPECS[n];
  if (!Number.isInteger(n) || !spec) throw new Error('no analytical engine for capability');
  if (!Array.isArray(args) || args.length > 8) throw new Error('args must be a JSON array of at most 8 parameters');
  checkJson(args);
  if (Buffer.byteLength(JSON.stringify(args), 'utf8') > 8192) throw new Error('input exceeds 8 KB');
  const info = getCapability(n);
  if (!info) throw new Error('capability not registered');

  let result: unknown;
  if (n === 57) {
    const threshold = args[0] === undefined ? 3 : args[0];
    const cooldown = args[1] === undefined ? 60_000 : args[1];
    const events = args[2] === undefined ? [] : args[2];
    if (!Number.isInteger(threshold) || (threshold as number) < 1 || (threshold as number) > 100 ||
        !Number.isInteger(cooldown) || (cooldown as number) < 0 || (cooldown as number) > 3_600_000 ||
        !Array.isArray(events) || events.length > 100 || !events.every((e) => typeof e === 'boolean')) {
      throw new Error('breaker input must be [threshold 1..100, cooldownMs 0..3600000, boolean[]]');
    }
    const breaker = new commercial.CircuitBreaker(threshold as number, cooldown as number);
    const states = (events as boolean[]).map((ok, index) => {
      breaker.record(ok, index * 1000);
      return breaker.state(index * 1000);
    });
    result = { states, finalState: breaker.state(events.length * 1000) };
  } else if (n === 91) {
    const cap = args[0];
    const expenses = args[1] === undefined ? [] : args[1];
    if (typeof cap !== 'number' || cap < 0 || cap > 100000 ||
        !Array.isArray(expenses) || expenses.length > 100 ||
        !expenses.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0)) {
      throw new Error('budget input must be [capUsd 0..100000, nonnegative expense amounts[]]');
    }
    const governor = new advanced.ExperimentBudgetGovernor(cap);
    const decisions = (expenses as number[]).map((amountUsd) => {
      const permitted = governor.canSpend(amountUsd);
      if (permitted) governor.commit(amountUsd);
      return { amountUsd, permitted };
    });
    result = { decisions, remainingUsd: governor.remaining() };
  } else {
    const module = spec[0] === 'commercial' ? commercial : advanced;
    const functionValue = (module as unknown as Record<string, unknown>)[spec[1]];
    if (typeof functionValue !== 'function') throw new Error('analytical engine is unavailable');
    result = (functionValue as (...values: unknown[]) => unknown)(...args);
  }
  return {
    capability: { id: n, name: info.name, engine: spec[0] + '.' + spec[1] },
    result,
    inputOrigin: 'owner_supplied',
    externalActionPerformed: false,
    productionVerified: false,
  };
}
