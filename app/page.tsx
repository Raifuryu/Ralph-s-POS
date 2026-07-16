import { Tabs, TabsList, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { TRANSACTION_CATEGORIES } from "@/lib/types";
import TransactionTable from "./transactionTable";

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col items-center p-4 sm:p-8 md:p-12">
      <Tabs defaultValue="Cash" className="w-full min-w-0 max-w-3xl">
        <TabsList className="w-full sm:w-fit">
          {TRANSACTION_CATEGORIES.map((category) => (
            <TabsTrigger key={category} value={category}>
              {category}
            </TabsTrigger>
          ))}
        </TabsList>
        {TRANSACTION_CATEGORIES.map((category) => (
          <TabsContent key={category} value={category} className="min-w-0">
            <TransactionTable category={category} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
