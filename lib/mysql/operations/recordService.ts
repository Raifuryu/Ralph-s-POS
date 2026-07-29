import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";

import type { CashFlow } from "@/lib/db/types";
import type { MoneyAccount } from "@/lib/types";
import { queryConn } from "./helpers";

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
};

/** Port of record_service(). No row locking here, same as the original —
    services aren't a counter/stock being mutated, just read. */
export async function recordService(
  conn: PoolConnection,
  params: RecordServiceParams,
  cashierId: string
): Promise<string> {
  let fee = params.fee;
  const {
    serviceId,
    principal,
    paymentAccount = "cash",
    tendered = null,
    feeInWallet = false,
    unitLabel = null,
    unitQuantity = null,
    unitPrice = null,
    visitId = null,
    discountAmount = 0,
  } = params;
  const contactNumber = params.contactNumber?.trim() || null;
  const reference = params.reference?.trim() || null;
  const description = params.description?.trim() || null;

  if (!Number.isFinite(principal) || principal < 0) {
    throw new Error("Amount must be 0 or more");
  }
  if (!Number.isFinite(discountAmount) || discountAmount < 0) {
    throw new Error("Discount must be 0 or more");
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
    // Per-unit: fee is always derived here from unit_price x quantity minus
    // the discount, never trusted as a separately-submitted number — so a
    // discount and the actual charged fee can never drift apart.
    fee = unitPrice! * unitQuantity! - discountAmount;
    if (fee < 0) {
      throw new Error("Discount cannot exceed the line's own subtotal");
    }
  } else if (discountAmount > 0) {
    throw new Error("Discount only applies to a per-unit service line");
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
       contact_number, reference, description, tendered, unit_label, unit_quantity, unit_price, visit_id, discount_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ]
  );

  async function postVaultEntry(amount: number, account: MoneyAccount, note?: string) {
    if (amount === 0) return;
    await conn.query(
      "INSERT INTO vault_entries (id, entry_type, amount, service_transaction_id, account, created_by, note) VALUES (?, 'service', ?, ?, ?, ?, ?)",
      [randomUUID(), amount, id, account, cashierId, note ?? null]
    );
  }

  if (service.cash_flow === "in") {
    await postVaultEntry(principal + fee, paymentAccount);
    if (service.wallet !== null) await postVaultEntry(-principal, service.wallet);
  } else if (service.wallet !== null && feeInWallet) {
    await postVaultEntry(-principal, paymentAccount);
    await postVaultEntry(principal + fee, service.wallet);
  } else {
    await postVaultEntry(-principal, paymentAccount);
    if (fee !== 0) await postVaultEntry(fee, paymentAccount, "Fee received in cash");
    if (service.wallet !== null) await postVaultEntry(principal, service.wallet);
  }

  return id;
}
