import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
  roadmap_item_id: text('roadmap_item_id'),
  team: text('team'),
  docs_stage: text('docs_stage', { enum: ['proposal', 'roadmap', 'not_pursued'] }),
  decision: text('decision', { enum: ['go', 'no_go', 'parked'] }),
  decision_date: text('decision_date'),
  decision_reason: text('decision_reason'),
  revisit_by: text('revisit_by'),
  doc_mode: text('doc_mode', { enum: ['full', 'one_pager_only'] }).notNull().default('full'),
  customer_facing: integer('customer_facing').notNull().default(0),
  waivers: text('waivers').notNull().default('{}'),
  hub_url: text('hub_url'),
  one_pager_url: text('one_pager_url'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  project_id: text('project_id').notNull().references(() => projects.id),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status', { enum: ['todo', 'in_progress', 'done'] }).notNull().default('todo'),
  priority: text('priority', { enum: ['low', 'medium', 'high', 'urgent'] }).notNull().default('medium'),
  due_date: text('due_date'),
  position: integer('position').notNull().default(0),
  images: text('images').notNull().default('[]'),
  links: text('links').notNull().default('[]'),
  doc_type: text('doc_type'),
  doc_key: text('doc_key'),
  doc_status: text('doc_status'),
  due_rule: text('due_rule'),
  // Date the doc matrix last computed; due_date differing from it means a manual edit.
  due_computed: text('due_computed'),
  doc_evidence: text('doc_evidence'),
  source: text('source', { enum: ['manual', 'slack'] }).notNull().default('manual'),
  slack_raw: text('slack_raw'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export type ProjectRow = typeof projects.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;

export const roadmapItems = sqliteTable('roadmap_items', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  team_id: text('team_id'),
  team_name: text('team_name'),
  parent_team_id: text('parent_team_id'),
  stage: text('stage').notNull(),
  status: text('status'),
  pm_name: text('pm_name'),
  jira_key: text('jira_key'),
  phases: text('phases').notNull().default('{}'),
  dev_start_half: text('dev_start_half'),
  links: text('links').notNull().default('{}'),
  hidden: integer('hidden').notNull().default(0),
  updated_at: text('updated_at'),
  first_seen_at: text('first_seen_at').notNull(),
  synced_at: text('synced_at').notNull(),
});

// Same shape as the control-plane design's activity log.
export const activity = sqliteTable('activity', {
  id: text('id').primaryKey(),
  created_at: text('created_at').notNull(),
  actor: text('actor').notNull().default('user'),
  type: text('type').notNull(),
  task_id: text('task_id'),
  project_id: text('project_id'),
  task_title: text('task_title'),
  summary: text('summary').notNull(),
  detail: text('detail'),
});

export type RoadmapItemRow = typeof roadmapItems.$inferSelect;
