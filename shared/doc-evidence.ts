// Which doc a page under a hub is. Spec §2 "Evidence a doc exists", adapted per the step-4 plan
// (D3): exact template titles are recorded automatically; keyword guesses wait for Brice.

import { DOC_MATRIX, type DocKey } from './doc-matrix';
import { adfText, type AdfDoc } from './confluence-adf';

export interface Classification {
  key: DocKey;
  confidence: 'exact' | 'guess';
}

// Order matters: the first match wins, so experiment comes before brief/PRD.
const KEYWORDS: [RegExp, DocKey][] = [
  [/experiment/i, 'experiment_brief.plan'],
  [/release notes/i, 'release_notes'],
  [/one[- ]?pager/i, 'one_pager'],
  [/research synthesis|\buxr\b/i, 'research'],
  [/cs\s*\/\s*marketing/i, 'cs_marketing_brief'],
  [/\bprd\b|\bbrief\b/i, 'prd'],
];

const SKIP = /\b(deprecated|archived?|old)\b/i;

export function classifyTitle(title: string): Classification | null {
  const t = title.trim();
  if (SKIP.test(t)) return null;
  // DOC_MATRIX lists experiment_brief.plan before .results, and both share a page title,
  // so an exact Experiment Brief match is the plan; the CLI records results from the same page.
  for (const row of DOC_MATRIX) {
    if (row.key === 'hub' || row.linkOnly) continue;
    if (t.endsWith(` - ${row.pageTitle}`) || t.endsWith(` — ${row.pageTitle}`)) return { key: row.key, confidence: 'exact' };
  }
  for (const [re, key] of KEYWORDS) if (re.test(t)) return { key, confidence: 'guess' };
  return null;
}

const MIN_RESULTS_CHARS = 20;
const TEMPLATE_LINE = /^(outcome vs\.? success criteria:?|decision:?\s*(ship\s*\/\s*iterate\s*\/\s*kill)?|date:?)$/i;

/** True when a heading containing "Results" is followed by real text before the next heading. */
export function resultsFilled(d: AdfDoc): boolean {
  const nodes = d.content;
  const start = nodes.findIndex((n) => n.type === 'heading' && /results/i.test(adfText(n)));
  if (start < 0) return false;
  let chars = 0;
  for (const n of nodes.slice(start + 1)) {
    if (n.type === 'heading') break;
    const line = adfText(n).trim();
    if (!line || TEMPLATE_LINE.test(line)) continue;
    chars += line.length;
  }
  return chars >= MIN_RESULTS_CHARS;
}
