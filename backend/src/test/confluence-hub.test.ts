// backend/src/test/confluence-hub.test.ts
import { describe, it, expect } from 'vitest';
import { adfText, p, text, replaceGenerated, findGenerated } from '../../../shared/confluence-adf';
import { renderHubDoc, renderRollupDoc, itemDocRows, statusContent, checklistContent, type HubItem } from '../../../shared/confluence-hub';

const ww: HubItem = {
  id: 'ww-modular', name: 'WW - Modular Elements ', team_name: 'Wedding Websites', stage: 'build', status: 'on-track',
  pm_name: 'Brice Fenger', jira_key: 'IDEA-932', first_seen_at: '2026-10-28T00:00:00.000Z',
  phases: { discovery: { start: '2026-03-01', end: '2026-03-30' }, build: { start: '2026-08-04', end: '2026-11-10' }, measure: { start: '2026-11-10', end: '2026-12-01' } },
  links: { prd: null, figma: null, jiraEpic: null, releaseNotes: null },
};
const headings = (d: ReturnType<typeof renderHubDoc>) =>
  d.content.filter((n) => n.type === 'heading').map((n) => adfText(n));

describe('itemDocRows', () => {
  it('evaluates from roadmap data and waives the one-pager for build items', () => {
    const rows = itemDocRows(ww, '2026-10-28');
    expect(rows.find((r) => r.key === 'one_pager')!.status).toBe('waived');
    expect(rows.find((r) => r.key === 'prd')!.status).toBe('overdue');
    expect(rows.find((r) => r.key === 'hub')).toBeDefined();
  });
  it('does not waive the one-pager for roadmap-stage items', () => {
    const rows = itemDocRows({ ...ww, stage: 'roadmap' }, '2026-10-28');
    expect(rows.find((r) => r.key === 'one_pager')!.status).not.toBe('waived');
  });
  it('uses roadmap links as evidence', () => {
    const rows = itemDocRows({ ...ww, links: { ...ww.links, jiraEpic: 'https://minted.atlassian.net/browse/DP-1' } }, '2026-10-28');
    expect(rows.find((r) => r.key === 'jira_epic')!.status).toBe('done');
  });
});

describe('renderHubDoc', () => {
  const today = '2026-10-28';
  const hub = renderHubDoc({ item: ww, rows: itemDocRows(ww, today), today });

  it('has the sections in order', () => {
    expect(headings(hub)).toEqual(['Status', 'Doc checklist', 'Links', 'Decisions log', 'Open questions', 'Settings']);
    expect(findGenerated(hub, 'status')).toHaveLength(1);
    expect(findGenerated(hub, 'checklist')).toHaveLength(1);
  });

  it('fills the status table and never guesses', () => {
    const s = adfText({ type: 'x', content: statusContent(ww, today) });
    expect(s).toContain('build');
    expect(s).toContain('Wedding Websites');
    expect(s).toContain('Brice Fenger');
    expect(s).toContain('IDEA-932');
    expect(s).toContain('2026-08-04 → 2026-11-10');
    expect(s).toContain('❓ Not in roadmap snapshot');
    expect(s).toContain('UX Research —');
  });

  it('labels checklist statuses', () => {
    const c = adfText({ type: 'x', content: checklistContent([
      { key: 'prd', label: 'Brief/PRD', phase: 'ux', due: '2026-07-21', due_rule: 'Build start −2w', needs: [], status: 'overdue', mismatch: false, link: null },
      { key: 'figma', label: 'Figma', phase: 'ux', due: null, due_rule: 'Build start', needs: ['Build start'], status: 'cant_date', mismatch: false, link: null },
    ]) });
    expect(c).toContain('🔴 Overdue');
    expect(c).toContain("❓ Can't date: needs Build start");
  });

  it('adds the off-roadmap warning and adopted content', () => {
    const d = renderHubDoc({ item: ww, rows: [], today, offRoadmap: true, adoptedContent: [p(text('old canonical notes'))] });
    expect(d.content[0].type).toBe('panel');
    expect(adfText(d.content[0])).toContain('Off-roadmap');
    expect(headings(d).at(-1)).toBe('Background (from the original page)');
    expect(adfText(d)).toContain('old canonical notes');
  });

  it('shows settings, including waivers', () => {
    const d = renderHubDoc({ item: ww, rows: [], today, settings: { doc_mode: 'full', customer_facing: true, waivers: { one_pager: 'predates system' } } });
    const s = adfText(d);
    expect(s).toContain('doc_mode full');
    expect(s).toContain('customer-facing launch yes');
    expect(s).toContain('one_pager — predates system');
  });

  it('survives a rewrite of its generated sections', () => {
    const edited = structuredClone(hub);
    const linksIdx = edited.content.findIndex((n) => adfText(n) === 'Links');
    edited.content.splice(linksIdx + 1, 1, p(text('Slack: #oi-messaging')));
    const r1 = replaceGenerated(edited, 'status', statusContent({ ...ww, stage: 'measure' }, today));
    const r2 = replaceGenerated(r1.doc, 'checklist', checklistContent([]));
    expect(adfText(r2.doc)).toContain('Slack: #oi-messaging');
    expect(adfText(r2.doc)).toContain('measure');
  });
});

describe('renderRollupDoc', () => {
  it('has an intro and one generated roll-up section', () => {
    const d = renderRollupDoc('Roll-up of H2\'26 projects.');
    expect(adfText(d.content[0])).toContain("H2'26");
    expect(findGenerated(d, 'rollup')).toHaveLength(1);
  });
});
