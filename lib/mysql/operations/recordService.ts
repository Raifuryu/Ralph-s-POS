import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";

import type { CashFlow } from "@/lib/db/types";
import type { MoneyAccount } from "@/lib/types";
import { queryConn, roundMoney } from "./helpers";

export type RecordServiceParams = {
  serviceId: string;
  principal: number;
  fee: number;
  paymentAccount?: MoneyAccount;
  contactNumber?: string | null;
  reference?: string | null;
  description?: string | null;
  tendered?: number | null;
  feeInWallet?: boolean;
  unitLabel?: string | null;
  unitQuantity?: number | null;
  unitPrice?: number | null;
  visitId?: string | null;
  discountAmount?: number;
  /** Extra charged on top of a per-unit line's own subtotal — the inverse
      of discountAmount, for a line sold above its usual price. Same scope
      restriction as discount: only meaningful on a per-unit line. */
  surchargeAmount?: number;
};

/** Port of record_service(). No row locking here, same as the original —
    services aren't a counter/stock being mutated, just read. */
export async function recordService(
  conn: PoolConnection,
  params: RecordServiceParams,
  cashierId: string
): Promise<string> {
  const {
    serviceId,
    principal: principalInput,
    paymentAccount = "cash",
    tendered = null,
    feeInWallet = false,
    unitLabel = null,
    unitQuantity = null,
    unitPrice: unitPriceInput = null,
    visitId = null,
    discountAmount: discountAmountInput = 0,
    surchargeAmount: surchargeAmountInput = 0,
  } = params;
  const contactNumber = params.contactNumber?.trim() || null;
  const reference = params.reference?.trim() || null;
  const description = params.description?.trim() || null;

  // Rounded here rather than trusted as-is — service_transactions' money
  // columns are DECIMAL, and this app's strict-mode MariaDB rejects an
  // INSERT with floating-point noise past the centavo outright instead of
  // silently truncating it (same reasoning as recordRestock's cost
  // rounding). These all reach here from client-side arithmetic (a percent
  // discount/surcharge, a per-unit total) that can leave one; `fee` gets
  // the same treatment below, once it's finalized either way it can be
  // produced.
  const principal = roundMoney(principalInput);
  const unitPrice = unitPriceInput !== null ? roundMoney(unitPriceInput) : null;
  const discountAmount = roundMoney(discountAmountInput);
  const surchargeAmount = roundMoney(surchargeAmountInput);
  let fee = roundMoney(params.fee);

  if (!Number.isFinite(principal) || principal < 0) {
    throw new Error("Amount must be 0 or more");
  }
  if (!Number.isFinite(discountAmount) || discountAmount < 0) {
    throw new Error("Discount must be 0 or more");
  }
  if (!Number.isFinite(surchargeAmount) || surchargeAmount < 0) {
    throw new Error("Surcharge must be 0 or more");
  }

  const unitFieldsGiven = unitLabel !== null || unitQuantity !== null || unitPrice !== null;
  const unitFieldsComplete = unitLabel !== null && unitQuantity !== null && unitPrice !== null;
  if (unitFieldsGiven && !unitFieldsComplete) {
    throw new Error("Unit pricing fields must be provided together");
  }
  if (unitQuantity !== null && unitQuantity <= 0) {
    throw new Error("Quantity must be more than 0");
  }
  if (unitPrice !== null && unitPrice < 0) {
    throw new Error("Unit price must be 0 or more");
  }

  if (unitLabel !== null) {
    // Per-unit: fee is always derived here from unit_price x quantity, plus
    // the surcharge, minus the discount — never trusted as a separately-
    // submitted number, so neither one can drift apart from the actual
    // charged fee. Re-rounded since this arithmetic can reintroduce
    // floating-point noise even though the operands are already clean.
    fee = roundMoney(unitPrice! * unitQuantity! + surchargeAmount - discountAmount);
    if (fee < 0) {
      throw new Error("Discount cannot exceed the line's own subtotal");
    }
  } else {
    if (discountAmount > 0) {
      throw new Error("Discount only applies to a per-unit service line");
    }
    if (surchargeAmount > 0) {
      throw new Error("Surcharge only applies to a per-unit service line");
    }
  }

  if (fee === null || fee === undefined || !Number.isFinite(fee) || fee < 0) {
    throw new Error("Fee must be 0 or more");
  }
  if (principal + fee <= 0) {
    throw new Error("Nothing to record");
  }

  const serviceRows = await queryConn<{
    name: string;
    cash_flow: CashFlow;
    wallet: MoneyAccount | null;
    allowed_payment_accounts: MoneyAccount[];
  }>(
    conn,
    "SELECT name, cash_flow, wallet, allowed_payment_accounts FROM services WHERE id = ? AND is_active = 1",
    [serviceId]
  );
  const service = serviceRows[0];
  if (!service) throw new Error("Service not found or inactive");

  if (!service.allowed_payment_accounts.includes(paymentAccount)) {
    throw new Error(`This service only accepts: ${service.allowed_payment_accounts.join(", ")}`);
  }

  if (tendered !== null) {
    if (service.cash_flow !== "in" || paymentAccount !== "cash") {
      throw new Error("Amount received only applies to cash-in services paid in cash");
    }
    if (tendered < principal + fee) {
      throw new Error(
        `Amount received (${tendered}) is less than the amount due (${principal + fee})`
      );
    }
  }

  const id = randomUUID();
  await conn.query(
    `INSERT INTO service_transactions
      (id, service_id, service_name, cash_flow, principal, fee, cashier_id, wallet, payment_account,
       contact_number, reference, description, tendered, unit_label, unit_quantity, unit_price, visit_id, discount_amount, surcharge_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      serviceId,
      service.name,
      service.cash_flow,
      principal,
      fee,
      cashierId,
      service.wallet,
      paymentAccount,
      contactNumber,
      reference,
      description,
      tendered,
      unitLabel,
      unitQuantity,
      unitPrice,
      visitId,
      discountAmount,
      surchargeAmount,
    ]
  );

  async function postVaultEntry(
    amount: number,
    account: MoneyAccount,
    fund: "profit" | "reinvest" | null,
    note?: string
  ) {
    // Re-rounded even though every caller already passes rounded operands
    // — summing two clean 2-decimal values (principal + fee) can still
    // land on a double with noise past the centavo, same reasoning as
    // everywhere else in this file.
    const rounded = roundMoney(amount);
    if (rounded === 0) return;
    await conn.query(
      "INSERT INTO vault_entries (id, entry_type, amount, service_transaction_id, account, fund, created_by, note) VALUES (?, 'service', ?, ?, ?, ?, ?, ?)",
      [randomUUID(), rounded, id, account, fund, cashierId, note ?? null]
    );
  }

  // `fee` is the only part of a service that's actually store income — the
  // fund-split below tags only the fee posting with 'profit' (100%, no
  // 'reinvest' portion: a service has no COGS to recover, same reasoning
  // IncomeBreakdownCard already applies). `principal` is a pure pass-
  // through (the customer's own money moving through, e.g. a GCash load's
  // face value) — never income, so it's posted with no fund at all rather
  // than guessed into either bucket. Previously principal and fee were
  // combined into one posting where they landed in the same account; they
  // now post as two separate rows so the fee's fund tag doesn't have to
  // apply to the whole combined amount.
  if (service.cash_flow === "in") {
    await postVaultEntry(principal, paymentAccount, null);
    await postVaultEntry(fee, paymentAccount, "profit");
    if (service.wallet !== null) await postVaultEntry(-principal, service.wallet, null);
  } else if (service.wallet !== null && feeInWallet) {
    await postVaultEntry(-principal, paymentAccount, null);
    await postVaultEntry(principal, service.wallet, null);
    await postVaultEntry(fee, service.wallet, "profit");
  } else {
    await postVaultEntry(-principal, paymentAccount, null);
    if (fee !== 0) await postVaultEntry(fee, paymentAccount, "profit", "Fee received in cash");
    if (service.wallet !== null) await postVaultEntry(principal, service.wallet, null);
  }

  return id;
}
