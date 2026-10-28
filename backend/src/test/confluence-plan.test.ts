// backend/src/test/confluence-plan.test.ts
import { describe, it, expect } from 'vitest';
import { buildPlan, emptyManifest, nextNode, recordNode, type PlanInputs } from '../../../shared/confluence-plan';
import { adfText } from '../../../shared/confluence-adf';

const inputs: PlanInputs = {
  today: '2026-10-28',
  items: [
    { id: 'oi-4', name: '[OI] Messaging Center', team_name: 'Online Invites', dev_start_half: '2026-H1', stage: 'build', status: 'on-track',
      pm_name: 'Brice Fenger', jira_key: 'IDEA-850', first_seen_at: '2026-10-28', phases: { build: { start: '2026-03-01', end: '2026-06-30' } }, links: {}, project_id: 'p1' },
    { id: 'ww-1', name: 'WW - Modular Elements', team_name: 'Wedding Websites', dev_start_half: '2026-H2', stage: 'roadmap', status: null,
      pm_name: null, jira_key: null, first_seen_at: '2026-10-28', phases: {}, links: {}, project_id: null },
  ],
  health: [{
    project_id: 'p1', name: '[IDEA-850] Messaging Center', team: 'OI', half: '2026-H1', roadmap_stage: 'build', roadmap_item_id: 'oi-4',
    hub_url: null, docs_stage: 'roadmap', decision: null, flags: [],
    rows: [{ key: 'prd', label: 'Brief/PRD', phase: 'ux', due: '2026-02-15', due_rule: 'Build start −2w', needs: [], status: 'overdue', mismatch: false, link: null }],
  }],
  projectSettings: { p1: { doc_mode: 'full', customer_facing: false, waivers: { one_pager: 'predates system' } } },
  inventory: { cloudId: 'c', spaceId: '221937685', existing: [{ id: '3664740359', title: "H1'26" }], prdPages: [], adopt: {}, offRoadmap: [], legacy: [], adoptedTitles: {} },
};

describe('buildPlan', () => {
  const plan = buildPlan(inputs);
  it('gives every node a body', () => {
    expect(plan.nodes.length).toBeGreaterThan(10);
    for (const n of plan.nodes) expect(n.body.type).toBe('doc');
  });
  it('uses doc health for linked projects', () => {
    const hub = plan.nodes.find((n) => n.key === 'hub:oi-4')!;
    expect(adfText(hub.body)).toContain('🔴 Overdue');
    expect(adfText(hub.body)).toContain('one_pager — predates system');
  });
  it('reports collisions and builds the migration list', () => {
    expect(plan.collisions).toEqual([{ key: 'half:2026-H1', title: "H1'26", existingId: '3664740359' }]);
    expect(plan.migration.some((r) => r.action === 'rename_conflict')).toBe(true);
  });
});

describe('manifest stepping', () => {
  const plan = buildPlan(inputs);
  it('walks parents first and records ids', () => {
    let m = emptyManifest(plan, 'c', '221937685');
    expect(nextNode(plan, m)!.key).toBe('root');
    m = recordNode(m, 'root', { pageId: '100', status: 'draft', url: 'https://x/100' });
    const n2 = nextNode(plan, m)!;
    expect(plan.nodes.find((n) => n.key === n2.key)!.parentKey).toBe('root');
    expect(() => recordNode(m, 'nope', { pageId: '1', status: 'draft', url: '' })).toThrow(/Unknown node/);
  });
  it('skips adopted hubs', () => {
    const p2 = buildPlan({ ...inputs, inventory: { ...inputs.inventory, adopt: { 'ww-1': '4198498306' } } });
    let m = emptyManifest(p2, 'c', '221937685');
    const seen: string[] = [];
    for (let n = nextNode(p2, m); n; n = nextNode(p2, m)) {
      seen.push(n.key);
      m = recordNode(m, n.key, { pageId: String(seen.length), status: 'draft', url: '' });
    }
    expect(seen).not.toContain('hub:ww-1');
    expect(seen).toContain('hub:oi-4');
  });
});
