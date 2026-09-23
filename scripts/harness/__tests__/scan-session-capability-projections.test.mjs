import { describe, expect, it } from 'vitest';

import {
  findSessionCapabilityProjectionFindings,
  readSessionCapabilitySources,
  SOURCE_FILES,
} from '../scan-session-capability-projections.mjs';

const source = readSessionCapabilitySources();

function findingsWithMutation(file, before, after) {
  expect(source[file]).toContain(before);
  const baseline = findSessionCapabilityProjectionFindings(source);
  const mutated = findSessionCapabilityProjectionFindings({
    ...source,
    [file]: source[file].replace(before, after),
  });
  return mutated.filter((finding) => !baseline.includes(finding));
}

describe('session capability projections', () => {
  it('derives new declared fields and requires an explicit disposition', () => {
    const file = SOURCE_FILES.render;
    const mutated = source[file].replace(
      'export interface IRenderOptions {',
      'export interface IRenderOptions {\n  newlyDeclaredCapability?: string;',
    );
    expect(findSessionCapabilityProjectionFindings({ ...source, [file]: mutated })).toEqual(
      expect.arrayContaining([expect.stringContaining('newlyDeclaredCapability')]),
    );
  });

  it('fails when render → channel loses an existing mapping', () => {
    expect(findingsWithMutation(SOURCE_FILES.render, 'maxTurns: options.maxTurns,', '')).toEqual(
      expect.arrayContaining([expect.stringContaining('render→channel maxTurns')]),
    );
  });

  it('fails when TUI channel → session loses an existing mapping', () => {
    expect(findingsWithMutation(SOURCE_FILES.tuiSession, 'maxTurns: opts.maxTurns,', '')).toEqual(
      expect.arrayContaining([expect.stringContaining('channel→session maxTurns')]),
    );
  });

  it('fails when print/goal → headless loses an existing mapping', () => {
    expect(findingsWithMutation(SOURCE_FILES.print, 'maxTurns: args.maxTurns,', '')).toEqual(
      expect.arrayContaining([expect.stringContaining('print→headless maxTurns')]),
    );
  });

  it('fails when headless → session loses an existing mapping', () => {
    expect(
      findingsWithMutation(SOURCE_FILES.headless, 'maxTurns: this.opts.maxTurns,', ''),
    ).toEqual(expect.arrayContaining([expect.stringContaining('headless→session maxTurns')]));
  });

  it('fails when serve → session loses an existing mapping', () => {
    expect(
      findingsWithMutation(
        SOURCE_FILES.serve,
        '...(opts.orgPolicy !== undefined ? { orgPolicy: opts.orgPolicy } : {}),',
        '',
      ),
    ).toEqual(expect.arrayContaining([expect.stringContaining('serve→session orgPolicy')]));
  });

  it('fails when serve drops the preset session-field projection', () => {
    const findings = findingsWithMutation(
      SOURCE_FILES.serve,
      '...presetSessionFields(preset),',
      '',
    );
    expect(findings).toEqual(
      expect.arrayContaining([expect.stringContaining('serve→session presetSessionFields')]),
    );
  });

  it('requires the modelId → model rename and rejects a stray same-named property', () => {
    const findings = findingsWithMutation(
      SOURCE_FILES.render,
      '{ model: options.modelId }',
      '{ model: options.providerType }',
    );
    expect(findings).toEqual(
      expect.arrayContaining([expect.stringContaining('render→channel modelId→model')]),
    );
  });

  it('rejects a same-named edge fed by the wrong channel field', () => {
    const findings = findingsWithMutation(
      SOURCE_FILES.tuiSession,
      'maxTurns: opts.maxTurns,',
      'maxTurns: opts.sessionName,',
    );
    expect(findings).toEqual(
      expect.arrayContaining([expect.stringContaining('channel→session maxTurns')]),
    );
  });

  it('checks newly declared headless capabilities on both print and session edges', () => {
    const file = SOURCE_FILES.headless;
    const mutated = source[file].replace(
      'export interface IHeadlessInteractionChannelOptions {',
      'export interface IHeadlessInteractionChannelOptions {\n  newlyDeclaredCapability?: string;',
    );
    const findings = findSessionCapabilityProjectionFindings({ ...source, [file]: mutated });
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('print→headless newlyDeclaredCapability'),
        expect.stringContaining('headless→session newlyDeclaredCapability'),
      ]),
    );
  });

  it('fails when a render mapping points to a channel field that is no longer declared', () => {
    const file = SOURCE_FILES.tuiChannel;
    const mutated = source[file].replace('  maxTurns?: number;', '');
    expect(mutated).not.toBe(source[file]);
    const findings = findSessionCapabilityProjectionFindings({ ...source, [file]: mutated });
    expect(findings).toEqual(
      expect.arrayContaining([expect.stringContaining('render→channel maxTurns')]),
    );
  });

  it('derives a new print preset capability before it reaches headless', () => {
    const file = SOURCE_FILES.presetSurface;
    const mutated = source[file].replace(
      'export interface IPresetSurfaceOptions {',
      'export interface IPresetSurfaceOptions {\n  newlyDeclaredCapability?: string;',
    );
    expect(findSessionCapabilityProjectionFindings({ ...source, [file]: mutated })).toEqual(
      expect.arrayContaining([
        expect.stringContaining('print source presetOptions.newlyDeclaredCapability'),
      ]),
    );
  });

  it('fails when a declared print preset capability is read from the wrong field', () => {
    const findings = findingsWithMutation(
      SOURCE_FILES.print,
      '{ model: presetOptions.model }',
      '{ model: presetOptions.outputStyle }',
    );
    expect(findings).toEqual(
      expect.arrayContaining([expect.stringContaining('print source presetOptions.model')]),
    );
  });

  it('derives a new print tool capability before it reaches headless', () => {
    const file = SOURCE_FILES.print;
    const mutated = source[file].replace(
      'export interface IPrintModeToolOptions {',
      'export interface IPrintModeToolOptions {\n  newlyDeclaredCapability?: string;',
    );
    expect(findSessionCapabilityProjectionFindings({ ...source, [file]: mutated })).toEqual(
      expect.arrayContaining([
        expect.stringContaining('print source toolOptions.newlyDeclaredCapability'),
      ]),
    );
  });

  it('does not accept an incidental special ref inside a different value', () => {
    const findings = findingsWithMutation(
      SOURCE_FILES.headless,
      'shellExec,',
      'shellExec: shellExec ?? wrongShellExec,',
    );
    expect(findings).toEqual(
      expect.arrayContaining([expect.stringContaining('headless→session shellExec')]),
    );
  });

  it('requires the exact modelId source for the rename', () => {
    const findings = findingsWithMutation(
      SOURCE_FILES.render,
      '{ model: options.modelId }',
      '{ model: options.modelId ?? options.providerType }',
    );
    expect(findings).toEqual(
      expect.arrayContaining([expect.stringContaining('render→channel modelId→model')]),
    );
  });

  it('derives print memory and session-resolution fields', () => {
    for (const [file, declaration, label] of [
      [SOURCE_FILES.memory, 'IMemorySessionOptions', 'memorySessionOptions'],
      [SOURCE_FILES.print, 'IPrintModeSessionResolution', 'sessionResolution'],
    ]) {
      const mutated = source[file].replace(
        `export interface ${declaration} {`,
        `export interface ${declaration} {\n  newlyDeclaredCapability?: string;`,
      );
      expect(findSessionCapabilityProjectionFindings({ ...source, [file]: mutated })).toEqual(
        expect.arrayContaining([
          expect.stringContaining(`print source ${label}.newlyDeclaredCapability`),
        ]),
      );
    }
  });

  it('derives a session-shaped parsed argument and an explicit print parameter', () => {
    const sessionFile = SOURCE_FILES.sessionOptions;
    const sessionOptions = source[sessionFile].replace(
      'export interface IInteractiveSessionStandardOptions {',
      'export interface IInteractiveSessionStandardOptions {\n  newlyDeclaredCapability?: string;',
    );
    const argsFile = SOURCE_FILES.cliArgs;
    const mutatedArgs = source[argsFile].replace(
      'export interface IParsedCliArgs {',
      'export interface IParsedCliArgs {\n  newlyDeclaredCapability?: string;',
    );
    const fromArgs = findSessionCapabilityProjectionFindings({
      ...source,
      [sessionFile]: sessionOptions,
      [argsFile]: mutatedArgs,
    });
    expect(fromArgs).toEqual(
      expect.arrayContaining([
        expect.stringContaining('print source args.newlyDeclaredCapability'),
      ]),
    );

    const printFile = SOURCE_FILES.print;
    const mutatedPrint = source[printFile].replace(
      '  projectAccess?: TWorkspaceProjectAccess,',
      '  projectAccess?: TWorkspaceProjectAccess,\n  newlyDeclaredCapability?: string,',
    );
    const fromParameter = findSessionCapabilityProjectionFindings({
      ...source,
      [sessionFile]: sessionOptions,
      [printFile]: mutatedPrint,
    });
    expect(fromParameter).toEqual(
      expect.arrayContaining([
        expect.stringContaining('print source parameter newlyDeclaredCapability'),
      ]),
    );
  });

  it('rejects a preset capability missing from the TUI render declaration', () => {
    const file = SOURCE_FILES.render;
    const mutated = source[file].replace(
      "  responseFormat?: ITuiInteractionChannelOptions['responseFormat'];",
      '',
    );
    expect(mutated).not.toBe(source[file]);
    expect(findSessionCapabilityProjectionFindings({ ...source, [file]: mutated })).toEqual(
      expect.arrayContaining([expect.stringContaining('preset→render responseFormat')]),
    );
  });

  it('rejects removal of the TUI responseFormat render-to-channel mapping', () => {
    const findings = findingsWithMutation(
      SOURCE_FILES.render,
      '...(options.responseFormat !== undefined ? { responseFormat: options.responseFormat } : {}),',
      '',
    );
    expect(findings).toEqual(
      expect.arrayContaining([expect.stringContaining('render→channel responseFormat')]),
    );
  });

  it('rejects removal of the CLI preset-to-render spread', () => {
    const file = SOURCE_FILES.cli;
    const mutated = source[file].replace('...toSessionOptions(presetSurface),', '');
    expect(mutated).not.toBe(source[file]);
    expect(findSessionCapabilityProjectionFindings({ ...source, [file]: mutated })).toEqual(
      expect.arrayContaining([expect.stringContaining('preset→render toSessionOptions')]),
    );
  });

  it.each([
    ['print/goal', '      orgPolicy,\n    );', '    );'],
    ['serve', '      orgPolicy,\n      backgroundTaskRunners,', '      backgroundTaskRunners,'],
    ['TUI', '    orgPolicy,\n    providerOverride:', '    providerOverride:'],
  ])('rejects loss of the CLI orgPolicy entry edge for %s', (_mode, before, after) => {
    const findings = findingsWithMutation(SOURCE_FILES.cli, before, after);
    expect(findings).toEqual(expect.arrayContaining([expect.stringContaining('orgPolicy')]));
  });

  it('rejects a mapping that only conditionally forwards the declared source value', () => {
    const findings = findingsWithMutation(
      SOURCE_FILES.headless,
      '{ orgPolicy: this.opts.orgPolicy }',
      '{ orgPolicy: this.opts.projectAccess ? this.opts.orgPolicy : undefined }',
    );
    expect(findings).toEqual(
      expect.arrayContaining([expect.stringContaining('headless→session orgPolicy')]),
    );
  });

  it('rejects a preset field removed from the same-name render spread', () => {
    const file = SOURCE_FILES.presetSurface;
    const mutated = source[file].replace(
      'effortResolution: _effortResolution,\n    ...rest',
      'effortResolution: _effortResolution,\n    responseFormat: _responseFormat,\n    ...rest',
    );
    expect(mutated).not.toBe(source[file]);
    expect(findSessionCapabilityProjectionFindings({ ...source, [file]: mutated })).toEqual(
      expect.arrayContaining([expect.stringContaining('preset→render responseFormat')]),
    );
  });

  it.each(['temperature', 'responseFormat'])(
    'rejects removal of serve preset.%s mapping',
    (name) => {
      const file = SOURCE_FILES.serve;
      const before = `? { ${name}: preset.${name} }`;
      expect(source[file]).toContain(before);
      const mutated = source[file].replace(before, '? {}');
      expect(findSessionCapabilityProjectionFindings({ ...source, [file]: mutated })).toEqual(
        expect.arrayContaining([expect.stringContaining(`serve preset→session ${name}`)]),
      );
    },
  );

  it('requires session destination declarations for TUI and headless mappings', () => {
    const file = SOURCE_FILES.sessionOptions;
    const mutated = source[file].replace('  maxTurns?: number;', '');
    expect(mutated).not.toBe(source[file]);
    expect(findSessionCapabilityProjectionFindings({ ...source, [file]: mutated })).toEqual(
      expect.arrayContaining([
        expect.stringContaining('channel→session maxTurns'),
        expect.stringContaining('headless→session maxTurns'),
      ]),
    );
  });

  it('rejects a serve option mapped to an undeclared session destination', () => {
    const file = SOURCE_FILES.serve;
    const mutated = source[file]
      .replace(
        'export interface IServeModeOptions {',
        'export interface IServeModeOptions {\n  newlyDeclaredCapability?: string;',
      )
      .replace(
        '    cwd: opts.cwd,',
        '    cwd: opts.cwd,\n    ...(opts.newlyDeclaredCapability !== undefined ? { newlyDeclaredCapability: opts.newlyDeclaredCapability } : {}),',
      );
    expect(mutated).not.toBe(source[file]);
    expect(findSessionCapabilityProjectionFindings({ ...source, [file]: mutated })).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'serve→session newlyDeclaredCapability: destination capability is not declared',
        ),
      ]),
    );
  });
});
