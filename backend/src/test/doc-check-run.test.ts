import { describe, it, expect } from 'vitest';
import { planDocCheck, type DocCheckInput } from '../../../shared/doc-check-run';

const page = (id: string, title: string, parentId: string | null, status: 'current' | 'draft' = 'current') => ({ id, title, parentId, status });
const base = 'https://minted.atlassian.net/wiki/spaces/PM/pages/';

function fixture(over: Partial<DocCheckInput> = {}): DocCheckInput {
  return {
    today: '2026-10-28',
    base,
    tree: [
      page('100', 'Roadmap Projects', null), page('101', "H2'26", '100'), page('102', "H2'26 · Online Invites", '101'),
      page('201', '[OI] X — Hub', '102'), page('202', '[OI] Y — Hub', '102'),
      page('301', '[OI] X — Brief/PRD', '201'), page('302', 'Experiment Brief: X', '201'), page('303', 'Notes', '201'),
    ],
    manifest: { root: '100', 'half:2026-H2': '101', 'team_half:2026-H2:OI': '102', 'hub:item-1': '201', 'hub:item-2': '202' },
    projects: [{
      project_id: 'p1', name: '[IDEA-1] X', roadmap_item_id: 'item-1', hub_url: `${base}201`, half: '2026-H2',
      roadmap_stage: 'build', docs_stage: 'roadmap', decision: null, team: 'OI', flags: [],
      rows: [{ key: 'prd', label: 'Brief/PRD', phase: 'ux', due: '2026-10-01', due_rule: 'Build start −2w', needs: [], status: 'overdue', mismatch: false, link: null }],
      settings: { doc_mode: 'full', customer_facing: false, waivers: {} },
    }],
    items: [
      { id: 'item-1', name: 'X', team_name: 'Online Invites', stage: 'build', status: 'on-track', pm_name: null, jira_key: 'IDEA-1', first_seen_at: '2026-10-28', phases: {}, links: {}, dev_start_half: '2026-H2' },
      { id: 'item-2', name: 'Y', team_name: 'Online Invites', stage: 'roadmap', status: 'on-track', pm_name: null, jira_key: 'IDEA-2', first_seen_at: '2026-10-28', phases: {}, links: {}, dev_start_half: '2026-H2' },
    ],
    recordedPageIds: {},
    ignored: [],
    ...over,
  };
}

describe('planDocCheck', () => {
  it('records exact matches and proposes guesses', () => {
    const out = planDocCheck(fixture());
    expect(out.evidence.p1.prd).toEqual({ page_url: `${base}301`, published: true });
    expect(out.proposals).toEqual([expect.objectContaining({ project_id: 'p1', page_id: '302', key: 'experiment_brief.plan' })]);
    expect(out.flags).toContainEqual(expect.objectContaining({ kind: 'unclassified', page_id: '303' }));
  });

  it('does not re-propose recorded or ignored pages', () => {
    const out = planDocCheck(fixture({ recordedPageIds: { '302': { project_id: 'p1', key: 'experiment_brief.plan' } }, ignored: ['303'] }));
    expect(out.proposals).toEqual([]);
    expect(out.flags.find((f) => f.kind === 'unclassified')).toBeUndefined();
  });

  it('never uses the OI On-Canvas PRD for a WW project', () => {
    const f = fixture();
    const out = planDocCheck({
      ...f,
      tree: [...f.tree, page('4286087221', '[OI] X — Brief/PRD', '201')],
      projects: f.projects.map((p) => ({ ...p, team: 'WW' })),
    });
    expect(out.evidence.p1.prd?.page_url).toBe(`${base}301`);
    expect(out.proposals.find((p) => p.page_id === '4286087221')).toBeUndefined();
  });

  it('writes hub sections for hubs with and without a project, and the roll-ups', () => {
    const ids = planDocCheck(fixture()).writes.map((w) => `${w.page_id}:${w.section}`);
    expect(ids).toEqual(expect.arrayContaining(['201:status', '201:checklist', '201:settings', '202:checklist', '100:rollup', '101:rollup', '102:rollup']));
  });

  it('flags a hub filed under the wrong half', () => {
    const f = fixture();
    const out = planDocCheck({ ...f, items: f.items.map((i) => (i.id === 'item-1' ? { ...i, dev_start_half: '2027-H1' } : i)) });
    expect(out.flags).toContainEqual(expect.objectContaining({ kind: 'wrong_half', page_id: '201', expected: "H1'27" }));
  });

  it('flags a roadmap project with no hub', () => {
    const f = fixture();
    const out = planDocCheck({ ...f, projects: f.projects.map((p) => ({ ...p, hub_url: null, roadmap_item_id: 'item-9' })) });
    expect(out.flags).toContainEqual(expect.objectContaining({ kind: 'no_hub', project_id: 'p1' }));
  });

  it('dates the status box by the roadmap item, not today', () => {
    const f = fixture();
    const out = planDocCheck({ ...f, items: f.items.map((i) => ({ ...i, updated_at: '2026-03-27T17:00:10.083Z' })) });
    const status = out.writes.find((w) => w.page_id === '201' && w.section === 'status')!;
    expect(JSON.stringify(status.content)).toContain('updated 2026-03-27');
  });

  it('puts overdue docs in the markdown', () => {
    expect(planDocCheck(fixture()).markdown).toContain('🔴 [IDEA-1] X — Brief/PRD (due 2026-10-01)');
  });
});
