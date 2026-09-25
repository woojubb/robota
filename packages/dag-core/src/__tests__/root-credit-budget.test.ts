import { expect, it } from 'vitest';
import { RootCreditBudget } from '../services/root-credit-budget.js';

it('holds sibling capacity until a reservation commits or releases', () => {
  const budget = new RootCreditBudget(1);
  const first = budget.reserve(0.75);
  expect(first.ok).toBe(true);
  const denied = budget.reserve(0.75);
  expect(denied).toMatchObject({ ok: false, error: { code: 'DAG_VALIDATION_CREDIT_LIMIT_EXCEEDED' } });
  if (!first.ok) throw new Error('reservation denied');
  first.value.release();
  const second = budget.reserve(0.75);
  expect(second.ok).toBe(true);
  if (!second.ok) throw new Error('reservation denied');
  expect(second.value.commit()).toBe(0.75);
  second.value.release();
  expect(budget.reserve(0.5)).toMatchObject({ ok: false, error: { code: 'DAG_VALIDATION_CREDIT_LIMIT_EXCEEDED' } });
  budget.close();
  expect(budget.reserve(0)).toMatchObject({ ok: false, error: { code: 'DAG_VALIDATION_CREDIT_LIMIT_EXCEEDED' } });
});
