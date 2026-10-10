// Explorer page sizes. The server accepts up to MAX_PAGE_SIZE; anything else
// asked for is brought into range rather than rejected.
export const PAGE_SIZES = [25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** The page size a URL parameter stands for: one of the offered sizes. */
export function pageSizeFrom(value) {
  const size = Number(value);
  return PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE;
}

/** The limit sent to the directory function. */
export function clampDirectoryLimit(value) {
  const limit = Math.trunc(Number(value));
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(limit, MAX_PAGE_SIZE);
}

/**
 * The largest page the server turned out to serve, or null when it served
 * what was asked. A database that has not yet received the 100-row migration
 * answers without `limit` and never returns more than 50, so paging by a
 * requested 100 would skip people. Once learned, the cap is remembered, so
 * later pages are asked for at the right offset the first time.
 */
export function serverPageCap(requested, response) {
  if (!response) return null;
  const applied = Number(response.limit);
  if (Number.isFinite(applied) && applied > 0) return applied < requested ? applied : null;
  return requested > 50 ? 50 : null;
}
