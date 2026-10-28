# Confluence tree working files

- `inventory/inventory.json` (git-ignored): what Claude read from Confluence in the inventory task: space titles, H1'26 PRDs, canonical drafts and their roadmap mapping, legacy pages.
- `tree-plan.json` (git-ignored): every planned page with its ADF body. Rebuilt by `npm run confluence -- plan` (from `backend/`).
- `manifest.json` (committed): node key → page id, status (draft/current) and URL. Updated after every Confluence call with `npm run confluence -- record`. The doc check (build step 4) reads it to find hubs and roll-ups.
- `migration-list.md` (committed): moves, renames, adoptions, title conflicts and banners. Brice marks each row; only [x] rows are executed.

Rules: Atlassian MCP calls one at a time; drafts first; no write without Brice's approval; never link page 4286087221 to the WW On-Canvas item.
