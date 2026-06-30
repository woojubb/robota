import { describe, it, expect } from 'vitest';
import { buildStudioHtml } from '../studio/ui-html.js';

describe('buildStudioHtml', () => {
  it('returns a non-empty string', () => {
    const html = buildStudioHtml();
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('starts with <!DOCTYPE html>', () => {
    const html = buildStudioHtml();
    expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
  });

  it('contains the DAG Studio title', () => {
    const html = buildStudioHtml();
    expect(html).toContain('DAG Studio');
  });

  it('contains a Load button', () => {
    const html = buildStudioHtml();
    expect(html).toContain('btn-load');
    expect(html).toContain('Load');
  });

  it('contains a Run button', () => {
    const html = buildStudioHtml();
    expect(html).toContain('btn-run');
    expect(html).toContain('Run');
  });

  it('contains the file-in input element', () => {
    const html = buildStudioHtml();
    expect(html).toContain('file-in');
    expect(html).toContain('workflow.dag.json');
  });

  it('contains SVG element for DAG visualization', () => {
    const html = buildStudioHtml();
    expect(html).toContain('dag-svg');
    expect(html).toContain('<svg');
  });

  it('contains log scroll area', () => {
    const html = buildStudioHtml();
    expect(html).toContain('log-scroll');
    expect(html).toContain('Execution Log');
  });

  it('contains result area', () => {
    const html = buildStudioHtml();
    expect(html).toContain('res-pre');
    expect(html).toContain('Result');
  });

  it('contains the inputs form', () => {
    const html = buildStudioHtml();
    expect(html).toContain('inp-form');
    expect(html).toContain('Inputs');
  });

  it('contains API endpoints referenced in JS', () => {
    const html = buildStudioHtml();
    expect(html).toContain('/api/dag');
    expect(html).toContain('/api/run');
    expect(html).toContain('/api/validate');
  });

  it('contains a <script> block', () => {
    const html = buildStudioHtml();
    expect(html).toContain('<script>');
    expect(html).toContain('</script>');
  });

  it('contains viewport meta tag', () => {
    const html = buildStudioHtml();
    expect(html).toContain('viewport');
  });

  it('contains CSS styles', () => {
    const html = buildStudioHtml();
    expect(html).toContain('<style>');
    expect(html).toContain('--bg:');
  });

  it('contains the logo element', () => {
    const html = buildStudioHtml();
    expect(html).toContain('logo');
  });

  it('contains the graph container', () => {
    const html = buildStudioHtml();
    expect(html).toContain('id="graph"');
    expect(html).toContain('g-empty');
  });

  it('contains node status color constants in script', () => {
    const html = buildStudioHtml();
    expect(html).toContain('pending');
    expect(html).toContain('running');
    expect(html).toContain('success');
    expect(html).toContain('failed');
  });

  it('returns same output on repeated calls (pure function)', () => {
    const html1 = buildStudioHtml();
    const html2 = buildStudioHtml();
    expect(html1).toBe(html2);
  });
});
