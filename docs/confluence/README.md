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

## Doc check (step 4)

Plan: `docs/superpowers/plans/2026-10-28-doc-check-and-briefing.md`.

- **Token:** a scoped Atlassian API token (`taskmanager-doc-check`) with the Confluence scopes `read:page:confluence`, `write:page:confluence` and `read:hierarchical-content:confluence`. It lives in the Keychain under service `taskmanager-confluence`, account `brice.fenger@minted.com`. Brice created it on 2026-10-28; renew it before it expires at id.atlassian.com.
- **Addresses:** scoped tokens only work through the API gateway, so requests go to `CONFLUENCE_API` (default `https://api.atlassian.com/ex/confluence/8414201f-d700-468c-8b6c-c46b3396d079`). Links use `CONFLUENCE_SITE` (default `https://minted.atlassian.net`). `CONFLUENCE_EMAIL` defaults to `brice.fenger@minted.com`.
- **Replacing the token:** type this into a terminal by hand (the app's Run button can't take input), then paste at the prompt. A bare `security add-generic-password … -w` prompt cuts input at 128 characters, but tokens are 192.
  `read -rs "?Paste token: " T && security add-generic-password -U -s taskmanager-confluence -a brice.fenger@minted.com -w "$T"; unset T; echo`
  Check: `security find-generic-password -s taskmanager-confluence -w | tr -d '\n' | wc -c` → 192.
- **Commands** (from `backend/`):
  - Dry run: `npm run doc-check -- run`
  - Write: `npm run doc-check -- run --write`
  - Confirm a proposed doc: `npm run doc-check -- accept <projectId> <doc_key> <pageId>`
  - Not a doc: `npm run doc-check -- ignore <pageId>`
  - One-time hub settings migration: `npm run doc-check -- migrate-settings [--write]`

Decisions (Brice, 2026-10-28; his only concern was the token, now resolved):
- D1: the doc check has its own scoped token; the server still holds no credentials.
- D2: the roadmap tool is the date source. Jira drift is reported, not written.
- D3: template titles are recorded automatically; keyword guesses need `accept`.
- D4: TaskManager owns hub settings; the hub Settings table is generated.
- D5: only changed sections are written.
- D6: Results counts as filled once a Results heading has at least 20 characters of real text under it.
