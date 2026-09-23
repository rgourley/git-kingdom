/**
 * Reads every row of a Supabase query, one page at a time.
 *
 * Supabase returns a maximum of 1000 rows for each request, and `.limit()` does not change that.
 * A query without paging silently drops all rows after the first 1000.
 * The query must have a stable order (for example, a unique column last), or pages can overlap.
 */
const PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`selectAll failed at row ${from}: ${error.message}`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}
