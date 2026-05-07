export type TCreditAccountStatus = 'active' | 'suspended' | 'closed';

export type TCreditReservationStatus = 'reserved' | 'settled' | 'released';

export type TCreditLedgerEntryKind =
  | 'grant'
  | 'debit'
  | 'credit'
  | 'reservation'
  | 'release'
  | 'settlement';

export type TCreditMetadataValue =
  | string
  | number
  | boolean
  | null
  | ICreditMetadata
  | TCreditMetadataValue[];

export interface ICreditMetadata {
  [key: string]: TCreditMetadataValue | undefined;
}

export interface ICreditAccount {
  accountId: string;
  ownerPrincipalId: string;
  balanceUnits: number;
  reservedUnits: number;
  status: TCreditAccountStatus;
  updatedAt: string;
}

export interface ICreditReservation {
  reservationId: string;
  accountId: string;
  units: number;
  status: TCreditReservationStatus;
  reason: string;
  createdAt: string;
  expiresAt?: string;
  metadata?: ICreditMetadata;
}

export interface ICreditLedgerEntry {
  entryId: string;
  accountId: string;
  kind: TCreditLedgerEntryKind;
  units: number;
  reservationId?: string;
  createdAt: string;
  metadata?: ICreditMetadata;
}

export type TCreditErrorCode =
  | 'CREDIT_AMOUNT_INVALID'
  | 'CREDIT_ACCOUNT_NOT_ACTIVE'
  | 'CREDIT_BALANCE_INSUFFICIENT'
  | 'CREDIT_RESERVATION_NOT_ACTIVE'
  | 'CREDIT_SETTLEMENT_EXCEEDS_RESERVATION'
  | 'CREDIT_STORE_UNAVAILABLE';

export interface ICreditError {
  code: TCreditErrorCode;
  message: string;
  retryable: boolean;
  metadata?: ICreditMetadata;
}

export type TCreditResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; error: ICreditError };

export interface ICreditAccountStorePort {
  getAccount(accountId: string): Promise<ICreditAccount | undefined>;
  saveAccount(account: ICreditAccount): Promise<void>;
  appendLedgerEntry(entry: ICreditLedgerEntry): Promise<void>;
}

export interface ICreditReservationStorePort {
  getReservation(reservationId: string): Promise<ICreditReservation | undefined>;
  saveReservation(reservation: ICreditReservation): Promise<void>;
}

export interface ICreditReservationDecision {
  allowed: boolean;
  availableUnits: number;
  requiredUnits: number;
  reason?: TCreditErrorCode;
}
