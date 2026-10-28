// backend/src/test/confluence-tree.test.ts
import { describe, it, expect } from 'vitest';
import {
  hubTitle, docPageTitle, halfTitle, teamPrefix, displayName, planTree, findTitleCollisions,
  type TreeItem,
} from '../../../shared/confluence-tree';

const item = (o: Partial<TreeItem>): TreeItem => ({
  id: 'x', name: 'Thing', team_name: 'Online Invites', dev_start_half: '2026-H2', stage: 'build', ...o,
});

describe('titles', () => {
  it('maps teams to prefixes', () => {
    expect(teamPrefix('Online Invites')).toBe('OI');
    expect(teamPrefix('Wedding Websites')).toBe('WW');
    expect(teamPrefix('Address Book')).toBe('ABK');
    expect(teamPrefix('Digital Products')).toBe('DP');
    expect(() => teamPrefix('Marketing')).toThrow(/Unknown team/);
  });

  it('strips a leading copy of the own team prefix only', () => {
    expect(displayName('WW - Modular Elements ', 'WW')).toBe('Modular Elements');
    expect(displayName('[OI] Messaging Center', 'OI')).toBe('Messaging Center');
    expect(displayName('OI – Messaging Center – Iteration', 'OI')).toBe('Messaging Center – Iteration');
    expect(displayName('OI: On-Canvas Editing', 'OI')).toBe('On-Canvas Editing');
    expect(displayName('WW - Modular Elements', 'OI')).toBe('WW - Modular Elements');
    expect(displayName('Oil painting', 'OI')).toBe('Oil painting');
    expect(displayName('WW Print Attach Phase 2', 'WW')).toBe('Print Attach Phase 2');
    expect(displayName('WWW launch', 'WW')).toBe('WWW launch');
  });

  it('builds hub and doc page titles', () => {
    expect(hubTitle('WW', 'WW - Modular Elements ')).toBe('[WW] Modular Elements — Hub');
    expect(docPageTitle('OI', '[OI] Messaging Center', 'prd')).toBe('[OI] Messaging Center — Brief/PRD');
    expect(docPageTitle('OI', 'Messaging Center', 'experiment_brief.results')).toBe('[OI] Messaging Center — Experiment Brief');
  });

  it('formats halves', () => {
    expect(halfTitle('2026-H2')).toBe("H2'26");
    expect(halfTitle('2027-H1')).toBe("H1'27");
    expect(() => halfTitle('2026')).toThrow();
  });
});

describe('planTree', () => {
  const items: TreeItem[] = [
    item({ id: 'oi-4', name: '[OI] Messaging Center', dev_start_half: '2026-H1' }),
    item({ id: 'ww-1', name: 'WW - Modular Elements', team_name: 'Wedding Websites' }),
    item({ id: 'ww-2', name: 'WW - Someday', team_name: 'Wedding Websites', dev_start_half: null, stage: 'roadmap' }),
    item({ id: 'done-1', name: 'Shipped', stage: 'done' }),
  ];

  it('orders parents before children', () => {
    const nodes = planTree({ items });
    const pos = new Map(nodes.map((n, i) => [n.key, i]));
    for (const n of nodes) if (n.parentKey) expect(pos.get(n.parentKey)!).toBeLessThan(pos.get(n.key)!);
    expect(nodes[0]).toMatchObject({ key: 'root', title: 'Roadmap Projects', parentKey: null });
  });

  it('creates the expected structure', () => {
    const titles = planTree({ items }).map((n) => n.title);
    expect(titles).toEqual(expect.arrayContaining([
      'Proposals', 'Proposals · Online Invites', 'Proposals · Wedding Websites', 'Proposals · Address Book',
      'Not Pursued', 'Not Pursued · Online Invites', 'Not Pursued · Wedding Websites', 'Not Pursued · Address Book',
      'Unscheduled', 'Unscheduled · Wedding Websites',
      '2026 Roadmap Projects', "H1'26", "H1'26 · Online Invites", "H2'26", "H2'26 · Wedding Websites",
      '[OI] Messaging Center — Hub', '[WW] Modular Elements — Hub', '[WW] Someday — Hub',
    ]));
    expect(titles).not.toContain("H2'26 · Online Invites");
    expect(titles).not.toContain('Unscheduled · Online Invites');
    expect(titles.some((t) => t.includes('Shipped'))).toBe(false);
  });

  it('parents hubs by half and team', () => {
    const nodes = planTree({ items });
    expect(nodes.find((n) => n.key === 'hub:oi-4')!.parentKey).toBe('team_half:2026-H1:OI');
    expect(nodes.find((n) => n.key === 'hub:ww-2')!.parentKey).toBe('unscheduled:WW');
  });

  it('keeps adopted page ids and places off-roadmap hubs', () => {
    const nodes = planTree({
      items,
      adopt: { 'oi-4': '4198498306' },
      offRoadmap: [{ key: 'IDEA-845', name: 'Guest Photos', team: 'OI', pageId: '4226482184' }],
    });
    expect(nodes.find((n) => n.key === 'hub:oi-4')!.adoptPageId).toBe('4198498306');
    expect(nodes.find((n) => n.key === 'hub:off:IDEA-845')).toMatchObject({
      title: '[OI] Guest Photos — Hub', parentKey: 'unscheduled:OI', offRoadmap: true, adoptPageId: '4226482184',
    });
  });

  it('throws on duplicate hub titles', () => {
    expect(() => planTree({ items: [item({ id: 'a', name: 'Same' }), item({ id: 'b', name: '[OI] Same' })] }))
      .toThrow(/Duplicate title/);
  });
});

describe('findTitleCollisions', () => {
  it('lists existing titles, but not a node colliding with its own adopted page', () => {
    const nodes = planTree({
      items: [item({ id: 'oi-4', name: 'Messaging Center', dev_start_half: '2026-H1' })],
      adopt: { 'oi-4': '42' },
    });
    const existing = [
      { id: '3664740359', title: "H1'26" },
      { id: '42', title: '[OI] Messaging Center — Hub' },
      { id: '7', title: 'Something else' },
    ];
    expect(findTitleCollisions(nodes, existing)).toEqual([
      { key: 'half:2026-H1', title: "H1'26", existingId: '3664740359' },
    ]);
  });
});
