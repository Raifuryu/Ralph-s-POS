import Link from "next/link";

import { PageError, PageShell } from "@/components/pageShell";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import CheckoutForm from "./checkoutForm";

export default async function CheckoutPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, price, stock, description, category_id, is_active, created_at, updated_at"
    )
    .eq("is_active", true)
    .order("name");

  if (error) {
    return (
      <PageError title="Could not load products" message={error.message} />
    );
  }

  return (
    <PageShell innerClassName="max-w-2xl">
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">New sale</h1>
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/" />}
          >
            Cancel
          </Button>
        </div>

        <CheckoutForm products={data ?? []} />
      </>
    </PageShell>
  );
}
