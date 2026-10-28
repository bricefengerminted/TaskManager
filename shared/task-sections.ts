// Phase divider rows ("━━━ PLAN ━━━") are stored as tasks so they can be dragged
// with the cards, but they are not work and never count toward task totals.
const SECTION_CHARS = '━─═—';

export const isSectionTitle = (title: string): boolean =>
  new RegExp(`^[${SECTION_CHARS}]{2,}`).test(title);

export const sectionName = (title: string): string =>
  title.replace(new RegExp(`[${SECTION_CHARS}\\s]`, 'g'), '');

// SQLite GLOB pattern for the same test, used to leave dividers out of counts.
export const SECTION_TITLE_GLOB = `[${SECTION_CHARS}][${SECTION_CHARS}]*`;
