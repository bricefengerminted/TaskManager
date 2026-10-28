import { describe, it, expect } from 'vitest';
import {
  evaluateDocs, describeRule, addDays, daysBetween,
  type DocContext, type DocEvidence, type DocKey,
} from '../../../shared/doc-matrix';

const TODAY = '2026-10-28';

// WW - Modular Elements as of 2026-10-28
const modular: DocContext = {
  stage: 'build',
  phases: {
    discovery: { start: '2026-03-01', end: '2026-03-30' },
    build: { start: '2026-08-04', end: '2026-11-10' },
    measure: { start: '2026-11-10', end: '2026-12-01' },
  },
  entered_scope_at: '2026-09-01',
  doc_mode: 'full',
  customer_facing: false,
  waivers: {},
  decision: null,
};

const byKey = (rows: ReturnType<typeof evaluateDocs>) =>
  Object.fromEntries(rows.map((r) => [r.key, r]));

describe('evaluateDocs', () => {
  it('lists only required rows, in matrix order', () => {
    const rows = evaluateDocs(modular, {}, TODAY);
    expect(rows.map((r) => r.key)).toEqual([
      'hub', 'one_pager', 'prd', 'experiment_brief.plan', 'jira_epic',
      'release_notes', 'metrics_snapshot', 'experiment_brief.results',
    ]);
  });

  it('computes due dates and readable rules', () => {
    const r = byKey(evaluateDocs(modular, {}, TODAY));
    expect(r.prd.due).toBe('2026-07-21');
    expect(r.prd.due_rule).toBe('Build start −2w');
    expect(r.one_pager.due).toBe('2026-03-15');
    expect(r.release_notes.due).toBe('2026-11-10');
    expect(r.metrics_snapshot.due).toBe('2026-11-24');
    expect(r['experiment_brief.results'].due).toBe('2026-12-01');
  });

  it('assigns statuses with no evidence', () => {
    const r = byKey(evaluateDocs(modular, {}, TODAY));
    expect(r.hub.status).toBe('overdue');
    expect(r.prd.status).toBe('overdue');
    expect(r.release_notes.status).toBe('due_soon');
    expect(r.metrics_snapshot.status).toBe('missing');
    expect(r['experiment_brief.results'].status).toBe('inactive');
  });

  it('uses the fallback rule when the anchor date is missing', () => {
    const ctx: DocContext = {
      ...modular,
      phases: { build: { start: '2026-08-04', end: '2026-11-10' } },
      entered_scope_at: '2026-10-01',
    };
    const r = byKey(evaluateDocs(ctx, {}, TODAY));
    expect(r.one_pager.due).toBe('2026-10-15');
    expect(r.one_pager.due_rule).toBe('Entered roadmap +2w');
  });

  it("marks rows can't-date when anchor and fallback are both missing", () => {
    const ctx: DocContext = { ...modular, stage: 'roadmap', phases: {}, entered_scope_at: null };
    const rows = evaluateDocs(ctx, {}, TODAY);
    expect(rows.map((x) => x.key)).toEqual(['hub', 'one_pager', 'prd', 'jira_epic', 'release_notes']);
    expect(rows.every((x) => x.status === 'cant_date')).toBe(true);
  });

  it('needs the task done for page docs', () => {
    const page: DocEvidence = { page_url: 'https://minted.atlassian.net/wiki/spaces/PM/pages/1/x', published: true };
    expect(byKey(evaluateDocs(modular, { prd: { ...page, task_done: false } }, TODAY)).prd.status).toBe('overdue');
    expect(byKey(evaluateDocs(modular, { prd: { ...page, task_done: true } }, TODAY)).prd.status).toBe('done');
  });

  it('shows an unpublished page as draft when not yet overdue', () => {
    const ev = { release_notes: { page_url: 'https://x/pages/5', published: false } };
    expect(byKey(evaluateDocs(modular, ev, TODAY)).release_notes.status).toBe('draft');
  });

  it('needs the results section for experiment_brief.results', () => {
    const ctx = { ...modular, stage: 'measure' as const };
    const base = { page_url: 'https://x/pages/9', published: true, task_done: true };
    const late = '2026-12-10';
    expect(byKey(evaluateDocs(ctx, { 'experiment_brief.results': base }, late))['experiment_brief.results'].status).toBe('overdue');
    expect(byKey(evaluateDocs(ctx, { 'experiment_brief.results': { ...base, results_filled: true } }, late))['experiment_brief.results'].status).toBe('done');
  });

  it('treats link-only rows as done once the link is set', () => {
    const r = byKey(evaluateDocs(modular, { jira_epic: { link: 'https://minted.atlassian.net/browse/WW-1' } }, TODAY));
    expect(r.jira_epic.status).toBe('done');
  });

  it('applies waivers', () => {
    const ctx: DocContext = { ...modular, waivers: { one_pager: 'predates system' } };
    expect(byKey(evaluateDocs(ctx, {}, TODAY)).one_pager.status).toBe('waived');
  });

  it('waives everything not done once the item is stopped', () => {
    const ctx: DocContext = { ...modular, stage: 'wont-do' };
    const done: DocEvidence = { page_url: 'https://x/pages/2', published: true, task_done: true };
    const r = byKey(evaluateDocs(ctx, { prd: done }, TODAY));
    expect(r.prd.status).toBe('done');
    expect(r.jira_epic.status).toBe('waived');
    expect(r.release_notes.status).toBe('waived');
  });

  it('drops the PRD in one-pager-only mode', () => {
    const rows = evaluateDocs({ ...modular, doc_mode: 'one_pager_only' }, {}, TODAY);
    expect(rows.some((x) => x.key === 'prd')).toBe(false);
  });

  it('only asks a proposal for its one-pager, undated', () => {
    const ctx: DocContext = { ...modular, stage: null, phases: {}, entered_scope_at: null };
    const rows = evaluateDocs(ctx, {}, TODAY);
    expect(rows.map((x) => x.key)).toEqual(['one_pager']);
    expect(rows[0].due).toBeNull();
    expect(rows[0].due_rule).toBe('Before roadmap');
    expect(rows[0].status).toBe('missing');
    expect(evaluateDocs(ctx, { one_pager: { page_url: 'https://x/pages/3', published: false } }, TODAY)[0].status).toBe('draft');
    expect(evaluateDocs(ctx, { one_pager: { page_url: 'https://x/pages/3', published: true } }, TODAY)[0].status).toBe('done');
  });

  it('flags a mismatch between the roadmap link and the hub child page', () => {
    const ev = (link: string): Partial<Record<DocKey, DocEvidence>> => ({
      prd: { link, page_url: 'https://minted.atlassian.net/wiki/spaces/PM/pages/222/PRD' },
    });
    expect(byKey(evaluateDocs(modular, ev('https://minted.atlassian.net/wiki/spaces/PM/pages/111/Old'), TODAY)).prd.mismatch).toBe(true);
    expect(byKey(evaluateDocs(modular, ev('https://minted.atlassian.net/wiki/spaces/PM/pages/222/Other+title'), TODAY)).prd.mismatch).toBe(false);
  });
});

describe('helpers', () => {
  it('describes rules', () => {
    expect(describeRule({ anchor: 'build.start', offsetDays: -14 })).toBe('Build start −2w');
    expect(describeRule({ anchor: 'measure.end', offsetDays: 0 })).toBe('Measure end');
    expect(describeRule({ anchor: 'build.end', offsetDays: -7 })).toBe('Build end −1w');
    expect(describeRule({ anchor: 'discovery.start', offsetDays: 3 })).toBe('Discovery start +3d');
  });

  it('does date math in UTC', () => {
    expect(addDays('2026-10-25', 14)).toBe('2026-11-08');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-01', '2026-10-28')).toBe(27);
    expect(daysBetween('2026-10-01T15:00:00.000Z', '2026-10-28')).toBe(27);
  });
});
