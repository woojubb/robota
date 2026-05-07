# Credits Specification

## Scope

`@robota-sdk/credits` owns credit account, reservation, ledger, and settlement contracts for Robota runtimes. It provides pure policy helpers for reservation, release, and settlement decisions using integer credit units.

## Boundaries

| Responsibility                       | Owner                        | Not This Package            |
| ------------------------------------ | ---------------------------- | --------------------------- |
| Account/reservation/ledger contracts | `credits`                    | Does not estimate DAG costs |
| Reservation and settlement policy    | `credits`                    | Does not execute workflows  |
| Cost formula evaluation              | `dag-cost`                   | Not duplicated here         |
| Auth principal verification          | `auth`                       | Does not verify credentials |
| Payment provider integration         | Future `billing` package     | Not implemented here        |
| Persistence adapters                 | Adapter/application packages | Does not implement storage  |

## Architecture Overview

`credits` is a functional-core package with ports. It exposes account/reservation/ledger contracts, storage port interfaces, and pure functions for credit reservation lifecycle decisions.

```text
credits
├── types.ts                # account, reservation, ledger, store ports
└── reservation-policy.ts   # pure reservation/release/settlement rules
```

## Type Ownership

| Type                          | Location       | Purpose                                    |
| ----------------------------- | -------------- | ------------------------------------------ |
| `ICreditAccount`              | `src/types.ts` | Account balance and held reservation state |
| `ICreditReservation`          | `src/types.ts` | Reserved credit hold for one operation     |
| `ICreditLedgerEntry`          | `src/types.ts` | Ledger event for audit and reconciliation  |
| `ICreditAccountStorePort`     | `src/types.ts` | Account persistence adapter port           |
| `ICreditReservationStorePort` | `src/types.ts` | Reservation persistence adapter port       |
| `ICreditReservationDecision`  | `src/types.ts` | Pure reservation eligibility result        |
| `ICreditError`                | `src/types.ts` | Credit failure contract                    |
| `TCreditResult`               | `src/types.ts` | Credit operation result union              |

## Public API Surface

| Export                    | Kind             | Description                                          |
| ------------------------- | ---------------- | ---------------------------------------------------- |
| `createCreditError`       | Function         | Builds a typed credit error                          |
| `getAvailableCreditUnits` | Function         | Computes `balanceUnits - reservedUnits`              |
| `canReserveCredits`       | Function         | Evaluates reservation eligibility                    |
| `reserveCredits`          | Function         | Applies a reserved hold to an account snapshot       |
| `releaseReservation`      | Function         | Releases a reservation hold without charging         |
| `settleReservation`       | Function         | Charges actual units and clears the reservation hold |
| Credit type exports       | Types/interfaces | Account, reservation, ledger, ports, errors          |

## Extension Points

Consumers implement `ICreditAccountStorePort` and `ICreditReservationStorePort`. Applications compose those adapters with `dag-cost` estimates and auth principals to enforce execution policy.

## Error Taxonomy

| Code                                    | Retryable | Context                                  |
| --------------------------------------- | --------- | ---------------------------------------- |
| `CREDIT_AMOUNT_INVALID`                 | false     | Credit units are not valid integers      |
| `CREDIT_ACCOUNT_NOT_ACTIVE`             | false     | Account is suspended or closed           |
| `CREDIT_BALANCE_INSUFFICIENT`           | false     | Available units are below required units |
| `CREDIT_RESERVATION_NOT_ACTIVE`         | false     | Reservation is not in `reserved` state   |
| `CREDIT_SETTLEMENT_EXCEEDS_RESERVATION` | false     | Actual charge exceeds the reservation    |
| `CREDIT_STORE_UNAVAILABLE`              | true      | Future adapter storage failure           |

## Test Strategy

| Test File                                  | Scope                                                     |
| ------------------------------------------ | --------------------------------------------------------- |
| `src/__tests__/reservation-policy.test.ts` | Available balance, reserve, release, settle, denial cases |

Coverage gaps: store adapters, idempotent ledger writes, and concurrent reservation locking belong in future adapter/application packages.

## Class Contract Registry

No classes are implemented. Store interfaces are ports implemented by future adapter/application packages.

## Dependencies

This package has no production dependencies.
