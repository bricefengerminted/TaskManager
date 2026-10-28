import type { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { activity } from '../db/schema';

export type Actor = 'claude' | 'user';

/** MCP calls send `X-Actor: claude`; everything else is the user. */
export function actorOf(req: Request): Actor {
  return req.get('x-actor') === 'claude' ? 'claude' : 'user';
}

export async function logActivity(entry: {
  actor: Actor;
  type: string;
  summary: string;
  project_id?: string | null;
  task_id?: string | null;
  task_title?: string | null;
  detail?: unknown;
}) {
  await db.insert(activity).values({
    id: uuidv4(),
    created_at: new Date().toISOString(),
    actor: entry.actor,
    type: entry.type,
    summary: entry.summary,
    project_id: entry.project_id ?? null,
    task_id: entry.task_id ?? null,
    task_title: entry.task_title ?? null,
    detail: entry.detail === undefined ? null : JSON.stringify(entry.detail),
  }).run();
}
