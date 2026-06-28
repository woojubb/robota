/**
 * Ergonomic constructors for {@link IActionRequest} plus the {@link isConfirmed} response helper
 * (CMD-004). The contract stays a single shape; these keep call sites readable so producers do not
 * hand-assemble the field combinations for confirm / single / multi / text.
 */

import type { IActionDefault, IActionOption, IActionRequest, TActionResponse } from './interaction';

/** Option value for the affirmative choice of a confirmation. */
export const CONFIRM_YES = 'yes';
/** Option value for the negative choice of a confirmation. */
export const CONFIRM_NO = 'no';

const CONFIRM_OPTIONS: readonly IActionOption[] = [
  { value: CONFIRM_YES, label: 'Yes' },
  { value: CONFIRM_NO, label: 'No' },
];

/** Build a yes/no confirmation action (two options, single selection). */
export function confirmAction(
  id: string,
  message: string,
  extra?: { description?: string; defaultYes?: boolean },
): IActionRequest {
  return {
    id,
    title: message,
    description: extra?.description,
    options: CONFIRM_OPTIONS,
    maxSelect: 1,
    default:
      extra?.defaultYes === undefined
        ? undefined
        : { values: [extra.defaultYes ? CONFIRM_YES : CONFIRM_NO] },
  };
}

/** Build a single-select action (optionally allowing a typed custom answer). */
export function selectAction(
  id: string,
  title: string,
  options: readonly IActionOption[],
  extra?: {
    description?: string;
    allowFreeText?: boolean;
    maxVisible?: number;
    default?: IActionDefault;
  },
): IActionRequest {
  return {
    id,
    title,
    options,
    maxSelect: 1,
    description: extra?.description,
    allowFreeText: extra?.allowFreeText,
    maxVisible: extra?.maxVisible,
    default: extra?.default,
  };
}

/** Build a multi-select action (min/max selections; defaults: min 1, max = number of options). */
export function multiSelectAction(
  id: string,
  title: string,
  options: readonly IActionOption[],
  extra?: {
    description?: string;
    minSelect?: number;
    maxSelect?: number;
    maxVisible?: number;
    default?: IActionDefault;
  },
): IActionRequest {
  return {
    id,
    title,
    options,
    minSelect: extra?.minSelect ?? 1,
    maxSelect: extra?.maxSelect ?? options.length,
    description: extra?.description,
    maxVisible: extra?.maxVisible,
    default: extra?.default,
  };
}

/** Build a free-text action (optionally masked for secret entry such as an API key). */
export function textAction(
  id: string,
  title: string,
  extra?: {
    description?: string;
    masked?: boolean;
    allowEmpty?: boolean;
    placeholder?: string;
    default?: IActionDefault;
  },
): IActionRequest {
  return {
    id,
    title,
    allowFreeText: true,
    description: extra?.description,
    masked: extra?.masked,
    allowEmpty: extra?.allowEmpty,
    placeholder: extra?.placeholder,
    default: extra?.default,
  };
}

/** True when the user answered a {@link confirmAction} affirmatively (selected "Yes"). */
export function isConfirmed(response: TActionResponse): boolean {
  return response.type === 'answer' && response.values.includes(CONFIRM_YES);
}
