/**
 * threshold-utils.ts — small shared helpers for threshold rule editing.
 * Currently just stripDeleted, used by CalibrationActionBar before any rule
 * reaches the save/test API calls.
 */

/**
 * Recursively strip all items and objects flagged with `_deleted: true` from
 * a rule object before it is sent to the backend. This is the sole gatekeeper
 * ensuring pending-delete markers never reach the API.
 */
export function stripDeleted(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter(
        (item) =>
          !(item && typeof item === "object" && (item as Record<string, unknown>)._deleted)
      )
      .map(stripDeleted);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _deleted, ...rest } = obj;
    return Object.fromEntries(
      Object.entries(rest).map(([k, v]) => [k, stripDeleted(v)])
    );
  }
  return value;
}
