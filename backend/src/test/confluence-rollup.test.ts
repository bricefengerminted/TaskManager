import { describe, it, expect } from 'vitest';
import { rollupContent, settingsContent, type RollupRow } from '../../../shared/confluence-rollup';
import { adfText, doc } from '../../../shared/confluence-adf';

const row = (name: string, statuses: RollupRow['cells'], overdue = 0): RollupRow => ({
  name, hubUrl: `https://minted.atlassian.net/wiki/spaces/PM/pages/${name.length}`, stage: 'build', cells: statuses, overdue,
});

describe('rollupContent', () => {
  it('puts overdue projects first', () => {
    const t = adfText(doc(rollupContent([row('B project', { prd: 'done' }), row('A project', { prd: 'overdue' }, 1)])));
    expect(t.indexOf('A project')).toBeLessThan(t.indexOf('B project'));
  });
  it('only shows doc columns that are active somewhere', () => {
    const t = adfText(doc(rollupContent([row('X', { prd: 'done', release_notes: 'inactive' })])));
    expect(t).toContain('Brief/PRD');
    expect(t).not.toContain('Release Notes');
  });
  it('handles an empty page', () => {
    expect(adfText(doc(rollupContent([])))).toContain('No projects here yet.');
  });
});

describe('settingsContent', () => {
  it('shows waivers and the TaskManager note', () => {
    const t = adfText(doc(settingsContent({ doc_mode: 'full', customer_facing: false, waivers: { one_pager: 'predates system' } })));
    expect(t).toContain('one_pager: predates system');
    expect(t).toContain('Change these in TaskManager');
  });
});
