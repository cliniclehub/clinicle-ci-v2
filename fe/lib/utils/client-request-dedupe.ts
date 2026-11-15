const inflightRequests = new Map<string, Promise<unknown>>()

/** Coalesce identical in-flight client requests (e.g. React Strict Mode double mount). */
export function dedupeClientRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflightRequests.get(key) as Promise<T> | undefined
  if (existing) {
    return existing
  }

  const promise = fn().finally(() => {
    if (inflightRequests.get(key) === promise) {
      inflightRequests.delete(key)
    }
  })

  inflightRequests.set(key, promise)
  return promise
}
