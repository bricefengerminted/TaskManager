import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { projects, roadmapItems, type RoadmapItemRow } from '../db/schema';
import { actorOf, logActivity } from '../lib/activity';
import { asyncHandler } from '../lib/async-handler';
import { parseJson } from '../lib/doc-check';
import type { RoadmapStage } from '../../../shared/doc-matrix';

const STAGES: RoadmapStage[] = [
  'not-started', 'roadmap', 'discover', 'plan', 'ready-for-build',
  'build', 'measure', 'done', 'on-hold', 'wont-do',
];

const router = Router();

interface RoadmapApiItem {
  id: string;
  name: string;
  team?: { id?: string; name?: string; parentTeamId?: string | null } | null;
  stage: string;
  status?: string | null;
  pm?: { name?: string } | null;
  jiraKey?: string | null;
  phases?: Record<string, unknown>;
  devStartHalf?: string | null;
  links?: Record<string, string | null>;
  hidden?: boolean;
  updatedAt?: string | null;
}

export function serializeRoadmapItem(row: RoadmapItemRow, projectId: string | null) {
  return {
    ...row,
    phases: parseJson(row.phases, {}),
    links: parseJson(row.links, {}),
    hidden: Boolean(row.hidden),
    project_id: projectId,
  };
}

// POST /api/roadmap/sync — upsert a snapshot pushed by Claude
router.post('/sync', asyncHandler(async (req: Request, res: Response) => {
  const items: RoadmapApiItem[] | undefined = req.body?.items;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array is required' });
  // Validate everything before writing anything.
  for (const it of items) {
    if (
      !it || typeof it !== 'object' ||
      typeof it.id !== 'string' || !it.id ||
      typeof it.name !== 'string' || !it.name.trim() ||
      typeof it.stage !== 'string' || !STAGES.includes(it.stage as RoadmapStage)
    ) {
      return res.status(400).json({ error: `each item needs string id, name and a valid stage (${STAGES.join(', ')})` });
    }
  }

  const ts = new Date().toISOString();
  await db.transaction(async (tx) => {
    for (const it of items) {
      const existing = await tx.select().from(roadmapItems).where(eq(roadmapItems.id, it.id)).get();
      const values = {
        id: it.id,
        name: it.name.trim(),
        team_id: it.team?.id ?? null,
        team_name: it.team?.name ?? null,
        parent_team_id: it.team?.parentTeamId ?? null,
        stage: it.stage,
        status: it.status ?? null,
        pm_name: it.pm?.name ?? null,
        jira_key: it.jiraKey ?? null,
        phases: JSON.stringify(it.phases ?? {}),
        dev_start_half: it.devStartHalf ?? null,
        links: JSON.stringify(it.links ?? {}),
        hidden: it.hidden ? 1 : 0,
        updated_at: it.updatedAt ?? null,
        synced_at: ts,
      };
      if (existing) {
        await tx.update(roadmapItems).set(values).where(eq(roadmapItems.id, it.id)).run();
      } else {
        await tx.insert(roadmapItems).values({ ...values, first_seen_at: ts }).run();
      }
    }
  });

  const allProjects = await db.select().from(projects).all();
  // Archived projects still hold their link (matches the 409 check in PATCH /docs).
  const linkedIds = new Set(allProjects.map((p) => p.roadmap_item_id).filter(Boolean));
  const unlinked = items.filter((it) => !linkedIds.has(it.id));
  const candidates = allProjects.filter((p) => p.status === 'active' && !p.roadmap_item_id && (p.docs_stage === null || p.docs_stage === 'proposal'));

  const suggestions = unlinked.flatMap((it) => {
    const match = candidates.find((p) =>
      (it.jiraKey && p.name.includes(`[${it.jiraKey}]`)) ||
      p.name.trim().toLowerCase() === it.name.trim().toLowerCase()
    );
    return match
      ? [{ roadmap_item_id: it.id, roadmap_name: it.name.trim(), jira_key: it.jiraKey ?? null, project_id: match.id, project_name: match.name }]
      : [];
  });

  await logActivity({
    actor: actorOf(req),
    type: 'roadmap_synced',
    summary: `${items.length} roadmap items synced`,
    detail: { ids: items.map((i) => i.id) },
  });

  return res.json({
    upserted: items.length,
    suggestions,
    unlinked: unlinked.map((it) => ({ id: it.id, name: it.name.trim(), jira_key: it.jiraKey ?? null, team: it.team?.name ?? null, stage: it.stage })),
  });
}));

// GET /api/roadmap
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const rows = await db.select().from(roadmapItems).all();
  const linked = await db.select({ id: projects.id, item: projects.roadmap_item_id }).from(projects).all();
  const byItem = new Map(linked.filter((l) => l.item).map((l) => [l.item as string, l.id]));
  res.json(rows.map((r) => serializeRoadmapItem(r, byItem.get(r.id) ?? null)));
}));

export default router;
