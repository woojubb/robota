export const USER_EVENTS = {
  MESSAGE: 'message',
  INPUT: 'input',
} as const;

export const USER_EVENT_PREFIX = 'user' as const;

export type TUserEvent = (typeof USER_EVENTS)[keyof typeof USER_EVENTS];
