import request from 'supertest';
import app from '../index';

/** WW - Modular Elements, shaped like roadmap MCP list_roadmap_items output. */
export function modularItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ww-modular',
    name: 'WW - Modular Elements ',
    team: { id: 'team-ww', name: 'Wedding Websites', jiraAbbrev: 'DP', parentTeamId: 'team-dp' },
    stage: 'build',
    status: 'on-track',
    pm: { id: 'user-brice', name: 'Brice Fenger' },
    jiraKey: 'IDEA-932',
    links: { prd: null, figma: null, jira: 'https://minted.atlassian.net/browse/IDEA-932', jiraEpic: null, releaseNotes: null },
    phases: {
      discovery: { start: '2026-03-01', end: '2026-03-30' },
      build: { start: '2026-08-04', end: '2026-11-10' },
      measure: { start: '2026-11-10', end: '2026-12-01' },
    },
    devStartHalf: '2026-H2',
    hidden: false,
    updatedAt: '2026-10-27T19:43:27.411Z',
    ...overrides,
  };
}

export async function sync(items: unknown[]) {
  return request(app).post('/api/roadmap/sync').set('X-Actor', 'claude').send({ items });
}

export async function createProject(name: string) {
  const res = await request(app).post('/api/projects').send({ name });
  return res.body as { id: string };
}

/** Sync the Modular Elements item and link it to a new project. */
export async function linkedModularProject(itemOverrides: Record<string, unknown> = {}) {
  await sync([modularItem(itemOverrides)]);
  const p = await createProject('[IDEA-932] Header / Main Elements Flexibility');
  const res = await request(app).patch(`/api/projects/${p.id}/docs`).send({ roadmap_item_id: 'ww-modular' });
  return res.body as { id: string };
}
