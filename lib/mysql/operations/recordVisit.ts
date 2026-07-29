import { randomUUID } from "node:crypto";

import { withTransaction } from "@/lib/mysql/pool";
import type { MoneyAccount } from "@/lib/types";
import { checkout } from "./checkout";
import { recordService, type RecordServiceParams } from "./recordService";

type CartLine = { productId: string; quantity: number; discountAmount?: number };
type ServiceLine = Omit<RecordServiceParams, "visitId">;

/** Port of record_visit(). The single entry point for recording a sale —
    products, services, or both, atomically in one transaction, exactly
    like the SQL version composed checkout() + record_service() under one
    visit_id. Called from app/checkout/actions.ts. */
export async function recordVisit(
  params: {
    items?: CartLine[];
    paymentMethod?: MoneyAccount;
    tendered?: number;
    personalTake: boolean;
    services?: ServiceLine[];
  },
  cashierId: string
): Promise<string> {
  const { items = [], services = [], personalTake } = params;

  if (items.length === 0 && services.length === 0) {
    throw new Error("Nothing to record");
  }

  const visitId = randomUUID();

  return withTransaction(async (conn) => {
    if (items.length > 0) {
      await checkout(
        conn,
        {
          items,
          paymentMethod: params.paymentMethod ?? null,
          tendered: params.tendered ?? null,
          personalTake,
          visitId,
        },
        cashierId
      );
    }

    for (const line of services) {
      await recordService(conn, { ...line, visitId }, cashierId);
    }

    return visitId;
  });
}
