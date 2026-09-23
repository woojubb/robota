type TNtOpenFailureKind = 'missing' | 'unsafe' | 'host-io';

export interface INtOpenFailure {
  readonly kind: TNtOpenFailureKind;
  readonly hostCode: string;
}

const HEX_RADIX = 16;
const STATUS_NO_SUCH_FILE = 0xc000000f;
const STATUS_OBJECT_NAME_NOT_FOUND = 0xc0000034;
const STATUS_OBJECT_PATH_NOT_FOUND = 0xc000003a;
const STATUS_STOPPED_ON_SYMLINK = 0x8000002d;
const STATUS_FILE_IS_A_DIRECTORY = 0xc00000ba;
const STATUS_NOT_A_DIRECTORY = 0xc0000103;
const STATUS_REPARSE_POINT_ENCOUNTERED = 0xc0000279;
const STATUS_IO_REPARSE_TAG_NOT_HANDLED = 0xc000050b;

const MISSING_STATUSES = new Set([
  STATUS_NO_SUCH_FILE,
  STATUS_OBJECT_NAME_NOT_FOUND,
  STATUS_OBJECT_PATH_NOT_FOUND,
]);
const UNSAFE_STATUSES = new Set([
  STATUS_STOPPED_ON_SYMLINK,
  STATUS_FILE_IS_A_DIRECTORY,
  STATUS_NOT_A_DIRECTORY,
  STATUS_REPARSE_POINT_ENCOUNTERED,
  STATUS_IO_REPARSE_TAG_NOT_HANDLED,
]);

export function classifyNtOpenFailure(status: number): INtOpenFailure {
  const normalized = status >>> 0;
  return {
    kind: MISSING_STATUSES.has(normalized)
      ? 'missing'
      : UNSAFE_STATUSES.has(normalized)
        ? 'unsafe'
        : 'host-io',
    hostCode: `NTSTATUS_0x${normalized.toString(HEX_RADIX)}`,
  };
}
