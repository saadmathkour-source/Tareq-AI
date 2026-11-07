/**
 * Command interpreter.
 *
 * The owner types a goal in Arabic or English; this maps it to one of the
 * deterministic plan templates. Keyword routing runs first so behaviour is
 * reproducible and testable without a model call; an optional model pass only
 * refines the free-text topic when the deterministic pass is unsure.
 */

export interface IntentMatch {
  template: string;
  topic: string | null;
  confidence: number;
  method: 'keyword' | 'model' | 'exact';
  rationale: string;
}

interface Route {
  template: string;
  /** English and Arabic keywords. Matching any one is evidence for this route. */
  keywords: string[];
}

// Ordered by intent specificity. A goal can match several routes; the one with
// the most keyword hits wins, ties broken by this order.
const ROUTES: Route[] = [
  {
    template: 'opportunity.to_sale',
    keywords: ['sell', 'sale', 'sales', 'buyer', 'buyers', 'lead', 'leads', 'prospect', 'outreach', 'customer', 'customers', 'بيع', 'مشتر', 'عميل', 'عملاء', 'تواصل'],
  },
  {
    template: 'opportunity.to_offer',
    keywords: ['offer', 'productize', 'productise', 'service', 'prototype', 'build', 'price', 'pricing', 'deliverable', 'عرض', 'خدمة', 'بناء', 'تسعير', 'منتج'],
  },
  {
    template: 'maintenance.cycle',
    keywords: ['maintain', 'maintenance', 'cleanup', 'clean up', 'freshness', 'prune', 'صيانة', 'تنظيف'],
  },
  {
    template: 'opportunity.discover',
    keywords: ['discover', 'research', 'find', 'market', 'demand', 'validate', 'opportunity', 'opportunities', 'problem', 'problems', 'trend', 'بحث', 'اكتشف', 'سوق', 'طلب', 'فرصة', 'فرص', 'مشكلة', 'مشاكل', 'تحقق'],
  },
];

const FILLER = new Set([
  'a', 'an', 'the', 'for', 'in', 'of', 'to', 'and', 'on', 'at', 'me', 'my', 'our',
  'please', 'find', 'research', 'discover', 'identify', 'analyze', 'analyse', 'build',
  'create', 'make', 'sell', 'prepare', 'design', 'validate', 'review', 'execute',
  'profitable', 'real', 'genuine', 'top', 'best', 'new', 'with', 'that', 'who', 'which',
  // Arabic command verbs and stop-words.
  'ابحث', 'عن', 'اكتشف', 'حلل', 'حللي', 'ابني', 'أنشئ', 'انشئ', 'جهز', 'جهّز', 'صمم',
  'في', 'من', 'على', 'إلى', 'الى', 'مع', 'هذا', 'هذه', 'لي', 'لي', 'أريد', 'اريد',
  'مربحة', 'مربح', 'حقيقية', 'حقيقي',
]);

/** Best-effort topic extraction: drop command verbs and stop-words, keep the subject. */
export function extractTopic(goal: string): string | null {
  const words = goal
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !FILLER.has(w));
  const topic = words.join(' ').trim();
  return topic.length >= 2 ? topic : null;
}

/** Deterministic keyword routing. Returns null when nothing matches. */
export function routeByKeyword(goal: string): IntentMatch | null {
  const text = ` ${goal.toLowerCase()} `;
  let best: { route: Route; hits: number } | null = null;
  for (const route of ROUTES) {
    let hits = 0;
    for (const kw of route.keywords) {
      if (text.includes(` ${kw} `) || text.includes(`${kw} `) || text.includes(` ${kw}`)) hits++;
    }
    if (hits > 0 && (!best || hits > best.hits)) best = { route, hits };
  }
  if (!best) return null;
  const confidence = Math.min(0.95, 0.5 + 0.15 * best.hits);
  return {
    template: best.route.template,
    topic: extractTopic(goal),
    confidence,
    method: 'keyword',
    rationale: `${best.hits} keyword match(es) for "${best.route.template}"`,
  };
}

/** Full interpretation: exact template name, then keywords, then a safe default. */
export function interpret(goal: string, knownTemplates: string[]): IntentMatch {
  const trimmed = goal.trim();
  if (knownTemplates.includes(trimmed)) {
    return { template: trimmed, topic: null, confidence: 1, method: 'exact', rationale: 'exact template name' };
  }
  const byKeyword = routeByKeyword(trimmed);
  if (byKeyword) return byKeyword;
  // Default to discovery — the safest, read-only commercial workflow.
  return {
    template: 'opportunity.discover',
    topic: extractTopic(trimmed),
    confidence: 0.3,
    method: 'keyword',
    rationale: 'no keyword match; defaulted to discovery (read-only)',
  };
}
