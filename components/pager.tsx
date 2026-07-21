import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

/**
 * URL-driven Prev / "Page X of Y" / Next control for server-rendered lists.
 * Renders nothing when everything fits on one page. Filter params are
 * preserved across page links; changing a filter naturally resets to page 1
 * because the filter forms build their URLs without `page`.
 */
export function Pager({
  page,
  pageCount,
  basePath,
  params,
}: {
  page: number;
  pageCount: number;
  basePath: string;
  /** Current query params to carry across page links (`page` is managed here). */
  params?: Record<string, string | undefined>;
}) {
  if (pageCount <= 1) return null;

  function href(target: number): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (key !== "page" && value) search.set(key, value);
    }
    if (target > 1) search.set("page", String(target));
    const qs = search.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const prevDisabled = page <= 1;
  const nextDisabled = page >= pageCount;

  return (
    <Pagination>
      <PaginationContent className="w-full justify-between">
        <PaginationItem>
          <PaginationPrevious
            href={prevDisabled ? undefined : href(page - 1)}
            aria-disabled={prevDisabled}
            className={cn(prevDisabled && "pointer-events-none opacity-50")}
          />
        </PaginationItem>
        <PaginationItem>
          <span className="text-sm text-muted-foreground tabular-nums">
            Page {page} of {pageCount}
          </span>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext
            href={nextDisabled ? undefined : href(page + 1)}
            aria-disabled={nextDisabled}
            className={cn(nextDisabled && "pointer-events-none opacity-50")}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
