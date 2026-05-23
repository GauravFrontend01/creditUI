/** Stable key for vendor rules / spend grouping (matches backend normalization). */
export function txRuleKey(tx: { merchantName?: string; description?: string }): string {
  const m = (tx.merchantName || '').trim()
  if (m) return m.toLowerCase()
  return (tx.description || '').trim().slice(0, 96).toLowerCase()
}
