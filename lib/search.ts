/** `%` and `_` are wildcards in ilike; a literal search must escape them. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
