// backend/src/test/confluence-migration.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeTitle, proposePrdMatches, buildMigrationList, renderMigrationMarkdown } from '../../../shared/confluence-migration';
import { planTree, type TreeItem } from '../../../shared/confluence-tree';

const items: TreeItem[] = [
  { id: 'oi-4', name: '[OI] Messaging Center', team_name: 'Online Invites', dev_start_half: '2026-H1', stage: 'build' },
  { id: 'ww-oce', name: 'WW - On-Canvas Editing', team_name: 'Wedding Websites', dev_start_half: '2026-H2', stage: 'roadmap' },
  { id: 'ww-mod', name: 'WW - Modular Elements', team_name: 'Wedding Websites', dev_start_half: '2026-H2', stage: 'build' },
  { id: 'ww-mod2', name: 'WW - Modular Elements Phase 2', team_name: 'Wedding Websites', dev_start_half: '2026-H2', stage: 'roadmap' },
];

describe('normalizeTitle', () => {
  it('handles the three title styles', () => {
    expect(normalizeTitle('[OI] Messaging Center PRD')).toEqual({ prefix: 'OI', core: 'messaging center' });
    expect(normalizeTitle('OI: On-Canvas Editing')).toEqual({ prefix: 'OI', core: 'on canvas editing' });
    expect(normalizeTitle('PRD - Modular Elements')).toEqual({ prefix: null, core: 'modular elements' });
    expect(normalizeTitle('[WW] Modular Elements — Brief/PRD')).toEqual({ prefix: 'WW', core: 'modular elements' });
  });
});

describe('proposePrdMatches', () => {
  it('matches exact names within the team', () => {
    const [m] = proposePrdMatches([{ id: '3748462617', title: '[OI] Messaging Center PRD' }], items);
    expect(m).toMatchObject({ itemId: 'oi-4', reason: 'exact' });
  });

  it('prefers exact over containment', () => {
    const [m] = proposePrdMatches([{ id: '1', title: 'PRD - Modular Elements' }], items);
    expect(m).toMatchObject({ itemId: 'ww-mod', reason: 'exact' });
  });

  it('flags ambiguity instead of guessing', () => {
    const [m] = proposePrdMatches([{ id: '2', title: 'PRD - Modular' }], items);
    expect(m.reason).toBe('ambiguous');
    expect(m.itemId).toBeNull();
    expect(m.candidates.sort()).toEqual(['ww-mod', 'ww-mod2']);
  });

  it('never links the OI On-Canvas PRD to the WW On-Canvas item', () => {
    const [m] = proposePrdMatches([{ id: '4286087221', title: 'On-Canvas Editing' }], items);
    expect(m.itemId).toBeNull();
    expect(m.reason).toBe('blocked');
  });

  it('prefers an existing roadmap PRD link over a name match', () => {
    const iter: TreeItem = { id: 'oi-iter', name: 'OI - Messaging Center - Iteration', team_name: 'Online Invites', dev_start_half: '2026-H2', stage: 'build' };
    const [m] = proposePrdMatches(
      [{ id: '3748462617', title: 'Brief/PRD: OI Messaging Center / Digital Products / TBD' }],
      [...items, iter],
      { 'oi-iter': 'https://minted.atlassian.net/wiki/spaces/PM/pages/3748462617/Brief+PRD+OI+Messaging+Center' },
    );
    expect(m).toMatchObject({ itemId: 'oi-iter', reason: 'linked' });
  });

  it('never follows a roadmap link for a blocked page', () => {
    const [m] = proposePrdMatches(
      [{ id: '4286087221', title: 'PRD — OI: On-Canvas Editing' }],
      items,
      { 'ww-oce': 'https://minted.atlassian.net/wiki/spaces/PM/pages/4286087221/PRD+OI+On-Canvas+Editing' },
    );
    expect(m.itemId).toBeNull();
  });

  it('blocks the real On-Canvas PRD title too', () => {
    const [m] = proposePrdMatches([{ id: '4286087221', title: 'PRD — OI: On-Canvas Editing' }], items);
    expect(m).toMatchObject({ itemId: null, reason: 'blocked' });
  });

  it('respects the page prefix', () => {
    const [m] = proposePrdMatches([{ id: '3', title: 'OI: On-Canvas Editing' }], items);
    expect(m).toMatchObject({ itemId: null, reason: 'none' });
  });
});

describe('buildMigrationList', () => {
  it('lists every kind of change, numbered', () => {
    const nodes = planTree({
      items,
      adopt: { 'ww-mod': '4198498306' },
      offRoadmap: [{ key: 'IDEA-845', name: 'Guest Photos', team: 'OI', pageId: '4226482184' }],
    });
    const rows = buildMigrationList({
      nodes,
      items,
      prdMatches: proposePrdMatches(
        [{ id: '3748462617', title: '[OI] Messaging Center PRD' }, { id: '4286087221', title: 'OI: On-Canvas Editing' }],
        items,
      ),
      collisions: [{ key: 'half:2026-H1', title: "H1'26", existingId: '3664740359' }],
      legacy: [{ id: '111', title: "H1'25" }],
    });
    expect(rows.map((r) => r.n)).toEqual(rows.map((_, i) => i + 1));
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'move_rename', pageId: '3748462617', newTitle: '[OI] Messaging Center — Brief/PRD', newParentKey: 'hub:oi-4' }),
      expect.objectContaining({ action: 'leave', pageId: '4286087221' }),
      expect.objectContaining({ action: 'adopt_as_hub', pageId: '4198498306', newTitle: '[WW] Modular Elements — Hub', newParentKey: 'team_half:2026-H2:WW' }),
      expect.objectContaining({ action: 'off_roadmap_hub', pageId: '4226482184', newTitle: '[OI] Guest Photos — Hub', newParentKey: 'unscheduled:OI' }),
      expect.objectContaining({ action: 'rename_conflict', pageId: '3664740359', newTitle: "H1'26 (legacy)" }),
      expect.objectContaining({ action: 'banner', pageId: '111' }),
    ]));
    const md = renderMigrationMarkdown(rows);
    expect(md).toContain('| # | Approve | Action | Page | Current title | New title | New parent | Note |');
    expect(md).toMatch(/4286087221.*Never link to the WW On-Canvas item/);
  });
});
