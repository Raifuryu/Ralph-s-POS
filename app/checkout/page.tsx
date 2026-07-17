import Link from "next/link";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import CheckoutForm from "./checkoutForm";

export default async function CheckoutPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, price, stock, description, is_active, created_at, updated_at"
    )
    .eq("is_active", true)
    .order("name");

  return (
    <main className="flex min-h-dvh flex-col items-center p-4 sm:p-8 md:p-12">
      <div className="flex w-full min-w-0 max-w-2xl flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">New sale</h1>
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/" />}
          >
            Cancel
          </Button>
        </div>

        {error ? (
          <div className="rounded-lg border border-destructive/50 p-4">
            <p className="font-medium">Could not load products</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {error.message}
            </p>
          </div>
        ) : (
          <CheckoutForm products={data ?? []} />
        )}
      </div>
    </main>
  );
}
