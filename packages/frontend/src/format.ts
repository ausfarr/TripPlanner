// The backend's DATE columns are kept as plain 'YYYY-MM-DD' strings end to end (see
// backend/src/db/pool.ts), so this is just a defensive slice in case that ever changes —
// never reformat through the Date object, which would shift the day by the viewer's timezone.
export function formatOutingDate(isoDateOrTimestamp: string): string {
  return isoDateOrTimestamp.slice(0, 10);
}
