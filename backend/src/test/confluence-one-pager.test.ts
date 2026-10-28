// backend/src/test/confluence-one-pager.test.ts
import { describe, it, expect } from 'vitest';
import { adfText, doc, p, text } from '../../../shared/confluence-adf';
import { renderOnePagerDoc, parseDecision, decisionBlock } from '../../../shared/confluence-one-pager';

const withDecision = (v: { decision: string; date?: string; reason?: string; revisit_by?: string }) =>
  doc([decisionBlock(v)]);

describe('renderOnePagerDoc', () => {
  it('starts with a pending decision block and has the template sections', () => {
    const d = renderOnePagerDoc({ prefix: 'OI', name: 'Guest Photos', author: 'Brice Fenger', date: '2026-10-28' });
    expect(d.content[0].type).toBe('bodiedExtension');
    expect(parseDecision(d)).toEqual({ decision: null, pending: true, date: null, reason: null, revisit_by: null, errors: [] });
    const s = adfText(d);
    for (const label of ['The problem', 'The proposal', 'Why now', 'Expected impact', 'Level of effort', 'Key risk', 'Key stakeholders', 'Ask', 'Related']) {
      expect(s).toContain(label);
    }
  });
});

describe('parseDecision', () => {
  it('reads Go', () => {
    expect(parseDecision(withDecision({ decision: 'Go', date: '2026-10-28', reason: 'Strong signal' }))).toMatchObject({
      decision: 'go', date: '2026-10-28', reason: 'Strong signal', errors: [],
    });
  });
  it('normalizes No-go spellings', () => {
    for (const v of ['No-go', 'no go', 'NOGO', 'No-Go']) {
      expect(parseDecision(withDecision({ decision: v, date: '2026-10-28', reason: 'Low impact' })).decision).toBe('no_go');
    }
  });
  it('requires revisit-by for Parked', () => {
    const r = parseDecision(withDecision({ decision: 'Parked', date: '2026-10-28', reason: 'Wait for Q1 data' }));
    expect(r.decision).toBeNull();
    expect(r.errors).toContain('Parked needs a revisit-by date');
    expect(parseDecision(withDecision({ decision: 'Parked', date: '2026-10-28', reason: 'Wait', revisit_by: '2027-01-15' })).decision).toBe('parked');
  });
  it('requires a valid date and a reason', () => {
    const r = parseDecision(withDecision({ decision: 'Go', date: 'next week' }));
    expect(r.decision).toBeNull();
    expect(r.errors).toEqual(expect.arrayContaining(['Date must be YYYY-MM-DD', 'Reason is required']));
  });
  it('rejects unknown values', () => {
    expect(parseDecision(withDecision({ decision: 'Maybe', date: '2026-10-28', reason: 'x' })).errors).toContain('Unknown decision: Maybe');
  });
  it('handles a page without the block', () => {
    expect(parseDecision(doc([p(text('just text'))]))).toMatchObject({ decision: null, errors: ['no decision block'] });
  });
});
