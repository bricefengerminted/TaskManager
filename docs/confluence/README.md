# Confluence tree working files

- `inventory/inventory.json` (git-ignored): what Claude read from Confluence in the inventory task: space titles, H1'26 PRDs, canonical drafts and their roadmap mapping, legacy pages.
- `tree-plan.json` (git-ignored): every planned page with its ADF body. Rebuilt by `npm run confluence -- plan` (from `backend/`).
- `manifest.json` (committed): node key → page id, status (draft/current) and URL. Updated after every Confluence call with `npm run confluence -- record`. The doc check (build step 4) reads it to find hubs and roll-ups.
- `migration-list.md` (committed): moves, renames, adoptions, title conflicts and banners. Brice marks each row; only [x] rows are executed.

Rules: Atlassian MCP calls one at a time; drafts first; no write without Brice's approval; never link page 4286087221 to the WW On-Canvas item.

## Approvals (Brice, in chat, 2026-10-28)

- Tree goes under page 221937685 ("Digital Products/Wedding Projects") in space PM.
- Year pages titled "2026 Roadmap Projects" (bare "2026" is taken in PM); team prefix stripped from roadmap names; IDEA-852 gets an off-roadmap hub.
- The six suggested PRD matches (4102684675, 4112941065, 3965943809, 4039147523, 3994419203, 4287135788) are correct.
- Marker spike: two test drafts approved. Creating the tree drafts, migration rows and hub_url writes are NOT yet approved.

## Marker spike (2026-10-28) — passed

- Test drafts: `4646731793` "[DP] Doc check marker test — Hub" (under 221937685) and child `4646699024`. Brice to delete both in the UI.
- `createConfluencePage` with `contentFormat: "adf"` accepts the Page Properties (`details`) `bodiedExtension`. Storage keeps the `label` param; Confluence adds `macroParams._parentId` and `macroMetadata.macroId`, which `findGenerated` ignores and `replaceGenerated` keeps.
- `updateConfluencePage` (ADF, `status: "draft"`) with a rewritten status section: re-fetch shows the new content, both labels intact, and the hand-written Links line unchanged. `MARKER_STYLE` stays `details`.
- A draft can be the parent of a draft, so the scaffold can stay all-drafts (no fallback needed).
- Space for `createConfluencePage` is `"PM"`; Confluence's numeric space id is `33259526`. CQL has no `space.id` field — use `space = PM`.
- Draft pages don't appear in CQL search; fetch them by id.
