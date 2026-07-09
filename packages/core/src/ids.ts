// Stable, unguessable identifiers. Prefers the Web Crypto UUID generator
// (available as a global in Node 20+ and all modern browsers), with a
// non-cryptographic fallback for exotic runtimes.

export function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID()
  }
  // RFC-4122-shaped fallback (not cryptographically strong).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** Convenience for readable prefixed ids in seed data / debugging. */
export function prefixedId(prefix: string): string {
  return `${prefix}_${newId().slice(0, 8)}`
}
