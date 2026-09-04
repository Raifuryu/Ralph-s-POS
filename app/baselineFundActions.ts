"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentUser } from "@/lib/auth/session";
import { parseMoney } from "@/lib/money";
import { setBaselineFundTarget as setBaselineFundTargetOperation } from "@/lib/mysql/operations/storeSettings";

export type SetBaselineFundTargetState = { error: string | null; saved: boolean };

/** Sets (or, left blank, clears) the Baseline Fund's maintained target —
    see setBaselineFundTarget's own doc comment in
    lib/mysql/operations/storeSettings.ts for what it drives. */
export async function setBaselineFundTargetAction(
  _prev: SetBaselineFundTargetState,
  formData: FormData
): Promise<SetBaselineFundTargetState> {
  const target = parseMoney(formData.get("target"), { allowBlank: true });
  if (target === "bad") {
    return { error: "Enter a valid amount, or leave it blank to clear.", saved: false };
  }

  try {
    const user = await requireCurrentUser();
    await setBaselineFundTargetOperation({ target }, user.id);
  } catch (err) {
    return { error: (err as Error).message, saved: false };
  }

  revalidatePath("/");
  revalidatePath("/vault");
  return { error: null, saved: true };
}
