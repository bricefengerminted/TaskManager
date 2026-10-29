import { describe, it, expect } from 'vitest';
import { classifyTitle, resultsFilled } from '../../../shared/doc-evidence';
import { doc, h, p, text } from '../../../shared/confluence-adf';

describe('classifyTitle', () => {
  it('matches template titles exactly', () => {
    expect(classifyTitle('[WW] Modular Elements — Brief/PRD')).toEqual({ key: 'prd', confidence: 'exact' });
    expect(classifyTitle('[OI] Guest RSVP Iteration — Release Notes')).toEqual({ key: 'release_notes', confidence: 'exact' });
    expect(classifyTitle('[OI] Guest RSVP Iteration — Experiment Brief')).toEqual({ key: 'experiment_brief.plan', confidence: 'exact' });
  });
  it('guesses from keywords', () => {
    expect(classifyTitle('Experiment Brief: OI Messaging Center')).toEqual({ key: 'experiment_brief.plan', confidence: 'guess' });
    expect(classifyTitle('Adult Child/Maybe Experimentation Doc')).toEqual({ key: 'experiment_brief.plan', confidence: 'guess' });
    expect(classifyTitle('Brief/PRD: Upload Your Own Design — Online Invitations')).toEqual({ key: 'prd', confidence: 'guess' });
    expect(classifyTitle('PRD: Modular Home Page Elements for Wedding Websites')).toEqual({ key: 'prd', confidence: 'guess' });
  });
  it('returns null when nothing matches', () => {
    expect(classifyTitle('Print Upsell - Matching Accessories')).toBeNull();
    expect(classifyTitle('Cash Registry Transition: Birdie → Stripe')).toBeNull();
  });
  it('skips pages marked deprecated', () => {
    expect(classifyTitle('OLD DEPRECATED PRD: Photo/Video Enhancements for Wedding Websites')).toBeNull();
  });
});

describe('resultsFilled', () => {
  it('needs real text under a Results heading', () => {
    const template = doc([h(2, 'Results'), p(text('Outcome vs. success criteria:')), h(2, 'Next')]);
    const filled = doc([h(2, 'Results'), p(text('Completion up 2.1% vs control at 95% confidence; shipping.')), h(2, 'Next')]);
    expect(resultsFilled(template)).toBe(false);
    expect(resultsFilled(filled)).toBe(true);
    expect(resultsFilled(doc([h(2, 'Hypothesis'), p(text('x'.repeat(50)))]))).toBe(false);
  });
});
