/**
 * What a run that may propose a task offer is told about it. The words are the host's own, and the list
 * of tasks comes from the host's catalog: ids, revisions, titles and input names, no text from a source.
 * It adds no tool and no permission; the host's gate judges every proposal whatever the run was told.
 */
import type { ITaskDefinition } from '../types.js';

export function offerInstructions(definitions: readonly ITaskDefinition[]): string {
  return [
    'Task offers: when an item you read holds something one of the person’s installed tasks could handle (for example a link to a page whose claim is worth checking), you may propose that task with TaskOfferPropose. You cannot start a task, publish one or give one more access: the host checks every proposal, refuses what does not hold, and the person decides.',
    'Propose only for the tasks listed here, only from an item you read in this run, and only a few per run. Give the connector id and the item’s own stable reference as the source (the same reference you would give CaseOpen for it), when you read it as a UTC time, one factual sentence of what the item says as the basis, and one short sentence on why now as the reason. Suggested inputs are only suggestions the person reads and changes. When a proposal is rejected, stop for that item. Never propose for an item that already has a case.',
    'Installed tasks:',
    ...definitions.map(
      (definition) =>
        `- ${definition.id} (revision ${definition.revision}): ${definition.title}. Inputs: ${
          definition.inputs.length === 0
            ? 'none'
            : definition.inputs.map((input) => input.name).join(', ')
        }.`,
    ),
  ].join('\n');
}
