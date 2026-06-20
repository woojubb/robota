import { describe, expect, it } from 'vitest';

import { classifyTaskFile } from '../check-task-archival.mjs';

describe('classifyTaskFile', () => {
  it('flags an all-checked breakdown whose spec is in spec-docs/done/', () => {
    const content = [
      '# PRESET-006: something',
      'Spec: `.agents/spec-docs/done/PRESET-006-foo.md`',
      '## Plan',
      '- [x] TC-01',
      '- [x] TC-02',
    ].join('\n');
    const result = classifyTaskFile(content);
    expect(result.archivable).toBe(true);
    expect(result.exemptReason).toBeNull();
    expect(result.reason).toContain('spec-docs/done/');
  });

  it('does not flag when a checkbox is still unchecked', () => {
    const content = [
      'Spec: `.agents/spec-docs/done/PRESET-006-foo.md`',
      '- [x] TC-01',
      '- [ ] TC-02',
    ].join('\n');
    expect(classifyTaskFile(content).archivable).toBe(false);
  });

  it('does not flag an all-checked file whose spec is still in todo/active', () => {
    const content = ['Spec: `.agents/spec-docs/active/X-001.md`', '- [x] TC-01'].join('\n');
    expect(classifyTaskFile(content).archivable).toBe(false);
  });

  it('flags via an explicit Status: completed line even without checkboxes', () => {
    const content = ['# Task', '- **Status**: completed', 'No checkboxes here.'].join('\n');
    const result = classifyTaskFile(content);
    expect(result.archivable).toBe(true);
    expect(result.reason).toBe('Status: completed');
  });

  it('does not flag an in-progress status', () => {
    const content = ['- **Status**: in-progress', '- [x] TC-01'].join('\n');
    expect(classifyTaskFile(content).archivable).toBe(false);
  });

  it('treats an archival-exempt annotation as an exemption, not a finding', () => {
    const content = [
      'Spec: `.agents/spec-docs/done/PRESET-006-foo.md`',
      '<!-- archival-exempt: blocked on dependent task PRESET-099 -->',
      '- [x] TC-01',
    ].join('\n');
    const result = classifyTaskFile(content);
    expect(result.archivable).toBe(true);
    expect(result.exemptReason).toBe('blocked on dependent task PRESET-099');
  });

  it('ignores a file with no checkboxes and no status', () => {
    expect(classifyTaskFile('# Notes\nSome prose, no checkboxes.').archivable).toBe(false);
  });
});
