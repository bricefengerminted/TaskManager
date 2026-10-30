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
      'release_notes', 'experiment_brief.results',
    ]);
  });

  it('computes due dates and readable rules', () => {
    const r = byKey(evaluateDocs(modular, {}, TODAY));
    expect(r.prd.due).toBe('2026-07-21');
    expect(r.prd.due_rule).toBe('Build start −2w');
    expect(r.one_pager.due).toBe('2026-03-15');
    expect(r.release_notes.due).toBe('2026-11-10');
    expect(r['experiment_brief.results'].due).toBe('2026-12-01');
  });

  it('assigns statuses with no evidence', () => {
    const r = byKey(evaluateDocs(modular, {}, TODAY));
    expect(r.hub.status).toBe('overdue');
    expect(r.prd.status).toBe('overdue');
    expect(r.release_notes.status).toBe('due_soon');
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
    const r = byKey(rows);
    expect(r.prd.needs).toEqual(['Build start']);
    expect(r.one_pager.needs).toEqual(['Discovery start', 'Entered roadmap']);
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

  it('waives the PRD in one-pager-only mode', () => {
    const rows = evaluateDocs({ ...modular, doc_mode: 'one_pager_only' }, {}, TODAY);
    expect(byKey(rows).prd.status).toBe('waived');
  });

  it('only asks a proposal for its one-pager, undated', () => {
    const ctx: DocContext = { ...modular, stage: null, phases: {}, entered_scope_at: null };
    const rows = evaluateDocs(ctx, {}, TODAY);
    expect(rows.map((x) => x.key)).toEqual(['one_pager', 'review_sizing']);
    expect(rows[0].due).toBeNull();
    expect(rows[0].due_rule).toBe('Before roadmap');
    expect(rows[0].status).toBe('missing');
    expect(evaluateDocs(ctx, { one_pager: { page_url: 'https://x/pages/3', published: false } }, TODAY)[0].status).toBe('draft');
    expect(evaluateDocs(ctx, { one_pager: { page_url: 'https://x/pages/3', published: true } }, TODAY)[0].status).toBe('review');
    expect(evaluateDocs(ctx, { one_pager: { page_url: 'https://x/pages/3', published: true, task_done: true } }, TODAY)[0].status).toBe('done');
  });

  it('needs the one-pager task ticked on a proposal, so reopening it takes it out of done', () => {
    const ctx: DocContext = { ...modular, stage: null, phases: {}, entered_scope_at: null };
    const link = 'https://minted.atlassian.net/wiki/spaces/PM/pages/3';
    expect(byKey(evaluateDocs(ctx, { one_pager: { link, task_done: true } }, TODAY)).one_pager.status).toBe('done');
    expect(byKey(evaluateDocs(ctx, { one_pager: { link, task_done: false } }, TODAY)).one_pager.status).toBe('review');
  });

  it('ticks team review and sizing from its task alone, and only for proposals', () => {
    const ctx: DocContext = { ...modular, stage: null, phases: {}, entered_scope_at: null };
    expect(byKey(evaluateDocs(ctx, {}, TODAY)).review_sizing.status).toBe('missing');
    expect(byKey(evaluateDocs(ctx, { review_sizing: { task_done: true } }, TODAY)).review_sizing.status).toBe('done');
    expect(evaluateDocs(modular, {}, TODAY).some((r) => r.key === 'review_sizing')).toBe(false);
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

describe('review fixes', () => {
  const mk = (over: Partial<DocContext>): DocContext => ({ ...modular, ...over });
  const pub = { page_url: 'https://x/pages/7', published: true };

  it('gives a proposal only the one-pager even with phases', () => {
    const ctx = mk({ stage: null, phases: { ux: { start: '2026-01-01' }, measure: { start: '2026-02-01' } } });
    expect(evaluateDocs(ctx, {}, TODAY).map((x) => x.key)).toEqual(['one_pager', 'review_sizing']);
  });

  it('normalizes a timestamp today', () => {
    const ctx = mk({ phases: { build: { start: '2026-08-04', end: '2026-10-28' } } });
    expect(byKey(evaluateDocs(ctx, {}, '2026-10-28T09:00:00Z')).release_notes.status).toBe('due_soon');
  });

  it('shows review when published but not done', () => {
    expect(byKey(evaluateDocs(modular, { release_notes: pub }, '2026-10-20')).release_notes.status).toBe('review');
    const ctx = mk({ stage: 'measure' });
    const ev = { 'experiment_brief.results': { ...pub, task_done: true } };
    expect(byKey(evaluateDocs(ctx, ev, '2026-11-15'))['experiment_brief.results'].status).toBe('review');
  });

  it('does not treat draft URLs as published', () => {
    const draft = 'https://minted.atlassian.net/wiki/pages/resumedraft.action?draftId=222';
    const r = byKey(evaluateDocs(modular, { prd: { link: draft, task_done: true }, jira_epic: { link: draft } }, TODAY));
    expect(r.prd.status).toBe('overdue');
    expect(r.jira_epic.status).toBe('overdue');
  });

  it('parses page ids for mismatch', () => {
    const mm = (link: string, page_url: string) =>
      byKey(evaluateDocs(modular, { prd: { link, page_url } }, TODAY)).prd.mismatch;
    expect(mm('https://x/wiki/viewpage.action?pageId=222', 'https://x/wiki/pages/222/x')).toBe(false);
    expect(mm('https://x/wiki/pages/edit-v2/222', 'https://x/wiki/pages/222')).toBe(false);
    expect(mm('https://x/wiki/pages/111', 'https://x/wiki/pages/222')).toBe(true);
    expect(mm('https://x/wiki/x/AbCd', 'https://x/wiki/pages/222')).toBe(false);
  });

  it('treats malformed dates as missing', () => {
    const ctx = mk({ phases: { ...modular.phases, build: { start: '08/04/2026', end: '2026-11-10' } } });
    expect(() => evaluateDocs(ctx, {}, TODAY)).not.toThrow();
    expect(byKey(evaluateDocs(ctx, {}, TODAY)).prd.status).toBe('cant_date');
  });

  it('requires research only with uxr, falling back to Build start -8w', () => {
    expect(evaluateDocs(modular, {}, TODAY).some((x) => x.key === 'research')).toBe(false);
    const ctx = mk({ phases: { build: modular.phases.build, uxr: { start: '2026-04-01' } } });
    const r = byKey(evaluateDocs(ctx, {}, TODAY)).research;
    expect(r.due).toBe('2026-06-09');
    expect(r.due_rule).toBe('Build start −8w');
  });

  it('requires figma only with a ux phase', () => {
    expect(evaluateDocs(modular, {}, TODAY).some((x) => x.key === 'figma')).toBe(false);
    const ctx = mk({ phases: { ...modular.phases, ux: { start: '2026-05-01' } } });
    expect(byKey(evaluateDocs(ctx, {}, TODAY)).figma.due).toBe('2026-08-04');
  });

  it('requires the CS/marketing brief only when customer facing', () => {
    expect(evaluateDocs(modular, {}, TODAY).some((x) => x.key === 'cs_marketing_brief')).toBe(false);
    const r = byKey(evaluateDocs(mk({ customer_facing: true }), {}, TODAY)).cs_marketing_brief;
    expect(r.due).toBe('2026-11-03');
    expect(r.due_rule).toBe('Build end −1w');
  });

  it('falls back to build.end+6w for results when measure.end is missing', () => {
    const ctx = mk({ phases: { build: { start: '2026-08-04', end: '2026-11-10' }, measure: { start: '2026-11-17' } } });
    const r = byKey(evaluateDocs(ctx, {}, TODAY))['experiment_brief.results'];
    expect(r.due).toBe('2026-12-22');
    expect(r.due_rule).toBe('Build end +6w');
  });

  it('waives undone rows when on hold or no-go, and honours waivers over overdue', () => {
    expect(byKey(evaluateDocs(mk({ stage: 'on-hold' }), {}, TODAY)).prd.status).toBe('waived');
    expect(byKey(evaluateDocs(mk({ decision: 'no_go' }), {}, TODAY)).prd.status).toBe('waived');
    expect(byKey(evaluateDocs(mk({ waivers: { prd: 'n/a' } }), {}, TODAY)).prd.status).toBe('waived');
  });

  it('handles due-date boundaries', () => {
    const st = (today: string) => byKey(evaluateDocs(modular, {}, today)).release_notes.status; // due 2026-11-10
    expect(st('2026-11-10')).toBe('due_soon');
    expect(st('2026-10-27')).toBe('due_soon');
    expect(st('2026-10-26')).toBe('missing');
  });

  it('counts a TaskManager link as done for link-only rows', () => {
    const r = byKey(evaluateDocs(modular, { jira_epic: { link: null, page_url: 'https://minted.atlassian.net/browse/WW-1', published: true } }, TODAY));
    expect(r.jira_epic.status).toBe('done');
    const draft = byKey(evaluateDocs(modular, { jira_epic: { link: null, page_url: 'https://x/resumedraft.action?draftId=1', published: false } }, TODAY));
    expect(draft.jira_epic.status).not.toBe('done');
  });

  it('rejects impossible dates', () => {
    for (const bad of ['2026-13-45', '2026-02-30']) {
      const ctx = mk({ phases: { ...modular.phases, build: { start: bad, end: '2026-11-10' } } });
      expect(() => evaluateDocs(ctx, {}, TODAY)).not.toThrow();
      expect(byKey(evaluateDocs(ctx, {}, TODAY)).prd.status).toBe('cant_date');
    }
  });

  it('shows a draft link inside the due-soon window as draft', () => {
    const link = 'https://minted.atlassian.net/wiki/pages/resumedraft.action?draftId=5';
    expect(byKey(evaluateDocs(modular, { release_notes: { link } }, TODAY)).release_notes.status).toBe('draft');
  });

  it('only lists needs for cant_date rows', () => {
    const ctx = mk({ stage: 'wont-do', phases: {}, entered_scope_at: null });
    const r = byKey(evaluateDocs(ctx, {}, TODAY));
    expect(r.prd.status).toBe('waived');
    expect(r.prd.needs).toEqual([]);
  });

  it('is overdue the day after the due date', () => {
    expect(byKey(evaluateDocs(modular, {}, '2026-11-11')).release_notes.status).toBe('overdue');
  });
});

describe('pinned_due', () => {
  it('overrides due, status and rule', () => {
    const base = byKey(evaluateDocs(modular, {}, TODAY)).prd;
    expect(base.status).toBe('overdue');
    const r = byKey(evaluateDocs(modular, { prd: { pinned_due: '2026-12-25' } }, TODAY)).prd;
    expect(r.due).toBe('2026-12-25');
    expect(r.due_rule).toBe('Pinned');
    expect(r.status).toBe('missing');
  });
});
