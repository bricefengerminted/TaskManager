// One-pager page body and its Decision block (Go / No-go / Parked).
// Spec: docs/superpowers/specs/2026-10-28-project-docs-system-design.md §1

import { adfText, doc, em, h, p, strong, table, text, type AdfDoc, type AdfNode } from './confluence-adf';
import { displayName } from './confluence-tree';

export const DECISION_LABEL = 'one-pager-decision';

export interface DecisionValues {
  decision: string;
  date?: string;
  reason?: string;
  revisit_by?: string;
}

/** Hand-written by the PM; read (never rewritten) by the doc check. */
export function decisionBlock(v: DecisionValues): AdfNode {
  const row = (k: string, val: string | undefined): AdfNode[][] => [[text(k)], val ? [text(val)] : []];
  return {
    type: 'bodiedExtension',
    attrs: {
      extensionType: 'com.atlassian.confluence.macro.core',
      extensionKey: 'details',
      parameters: {
        macroParams: { label: { value: DECISION_LABEL } },
        macroMetadata: { schemaVersion: { value: '1' }, title: 'Page Properties' },
      },
      layout: 'default',
    },
    content: [
      p(em('Decision: Go, No-go, Parked or Pending. Go/No-go/Parked need a date (YYYY-MM-DD) and a one-line reason; Parked also needs a revisit-by date.')),
      table(['Field', 'Value'], [
        row('Decision', v.decision),
        row('Date', v.date),
        row('Reason', v.reason),
        row('Revisit by', v.revisit_by),
      ]),
    ],
  };
}

export interface OnePagerInput {
  prefix: string;
  name: string;
  author: string;
  date: string;
}

export function renderOnePagerDoc(i: OnePagerInput): AdfDoc {
  const field = (label: string, hint: string) => p(strong(`${label}: `), em(hint));
  return doc([
    decisionBlock({ decision: 'Pending' }),
    p(text(`${displayName(i.name, i.prefix)} · ${i.date} · ${i.author}`)),
    field('The problem', '2–3 sentences: what is broken or missing, and who feels the pain.'),
    field('The proposal', '2–3 sentences: what we would build and how it solves the problem.'),
    field('Why now', 'What changed: market signal, data, customer feedback.'),
    field('Expected impact', '[metric] moves from [X] to [Y].'),
    field('Level of effort', 'S / M / L, with a one-line justification.'),
    field('Key risk', 'The one thing that could sink this.'),
    h(3, 'Key stakeholders'),
    table(['Role', 'Person', 'Involvement'], [
      [[text('PM')], [text(i.author)], [text('Owner')]],
      [[text('Eng Lead')], [], []],
      [[text('Design')], [], []],
    ]),
    field('Ask', 'Approval, resources, design review or an eng estimate.'),
    field('Related', 'Jira tickets, prior attempts, relevant decisions.'),
  ]);
}

export interface ParsedDecision {
  decision: 'go' | 'no_go' | 'parked' | null;
  pending: boolean;
  date: string | null;
  reason: string | null;
  revisit_by: string | null;
  errors: string[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function normalize(v: string): ParsedDecision['decision'] | 'pending' | undefined {
  const k = v.toLowerCase().replace(/[^a-z]/g, '');
  return ({ go: 'go', nogo: 'no_go', parked: 'parked', pending: 'pending', '': 'pending' } as const)[k as 'go'];
}

function findBlock(nodes: AdfNode[]): AdfNode | undefined {
  for (const n of nodes) {
    const params = n.attrs?.parameters as { macroParams?: { label?: { value?: string } } } | undefined;
    if (n.type === 'bodiedExtension' && params?.macroParams?.label?.value === DECISION_LABEL) return n;
    const inner = n.content && findBlock(n.content);
    if (inner) return inner;
  }
  return undefined;
}

export function parseDecision(d: AdfDoc): ParsedDecision {
  const empty: ParsedDecision = { decision: null, pending: false, date: null, reason: null, revisit_by: null, errors: [] };
  const block = findBlock(d.content);
  const tableNode = block?.content?.find((n) => n.type === 'table');
  if (!tableNode) return { ...empty, errors: ['no decision block'] };

  const fields: Record<string, string> = {};
  for (const row of tableNode.content ?? []) {
    const [k, v] = (row.content ?? []).map((c) => adfText(c).trim());
    if (k) fields[k.toLowerCase()] = v ?? '';
  }
  const raw = fields['decision'] ?? '';
  const value = normalize(raw);
  const date = fields['date'] || null;
  const reason = fields['reason'] || null;
  const revisit_by = fields['revisit by'] || null;
  const out: ParsedDecision = { ...empty, date, reason, revisit_by };

  if (value === undefined) return { ...out, errors: [`Unknown decision: ${raw}`] };
  if (value === 'pending') return { ...out, pending: true };
  if (!date || !ISO.test(date)) out.errors.push('Date must be YYYY-MM-DD');
  if (!reason) out.errors.push('Reason is required');
  if (value === 'parked' && (!revisit_by || !ISO.test(revisit_by))) out.errors.push('Parked needs a revisit-by date');
  return out.errors.length ? out : { ...out, decision: value };
}
