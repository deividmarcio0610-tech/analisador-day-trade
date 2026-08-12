/**
 * Module-level singletons survive Next.js hot reloads only if they live on
 * globalThis. Every in-memory registry in the core uses this helper.
 */

const store = globalThis as unknown as { __visionSingletons?: Map<string, unknown> };

export function singleton<T>(key: string, factory: () => T): T {
  if (!store.__visionSingletons) store.__visionSingletons = new Map();
  const existing = store.__visionSingletons.get(key);
  if (existing !== undefined) return existing as T;
  const created = factory();
  store.__visionSingletons.set(key, created);
  return created;
}
