// Shared types & helpers for statements list and dashboard

export interface Statement {
  _id: string
  bankName: { val: string; box?: number[]; page?: number }
  accountNumber?: { val: string; box?: number[]; page?: number }
  statementPeriod?: { from: string; to: string; box?: number[]; page?: number }
  createdAt: string
  creditLimit?: { val: number }
  availableLimit?: { val: number }
  outstandingTotal?: { val: number }
  minPaymentDue?: { val: number }
  paymentDueDate?: { val: string }
  transactions?: {
    _id: string
    amount?: number
    deposit?: number
    withdrawal?: number
    type: string
    category?: string
    isInternal?: boolean
    description?: string
    merchantName?: string
  }[]
  currency?: string
  status?: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"
  isApproved?: boolean
  type?: "CREDIT_CARD" | "BANK"
  closingBalance?: { val: number }
  totalDeposits?: { val: number }
  totalWithdrawals?: { val: number }
}

export interface VendorRuleRow {
  merchantName: string
  category: string
  vendorLabel?: string
}

export type PortfolioDetailKind = "limit" | "debt" | "utilization" | "minDue"

export interface CardPortfolioRow {
  key: string
  bankName: string
  accNum: string
  creditLimit: number
  outstanding: number
  availableLimit: number
  minDue: number
  paymentDueDate: string
  utilizationPct: number
  latestStatementId: string
  periodLabel: string
}

export interface StatementGroupData {
  name: string
  accNum: string
  items: Statement[]
}

export const fmt = (val?: number | null) =>
  typeof val === "number" && !Number.isNaN(val)
    ? `₹${val.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
    : "—"

export const utilizationColor = (pct: number) => {
  if (pct >= 80) return "text-red-600 bg-red-50"
  if (pct >= 50) return "text-amber-600 bg-amber-50"
  return "text-emerald-600 bg-emerald-50"
}

export const utilizationBarColor = (pct: number) => {
  if (pct >= 80) return "bg-red-500"
  if (pct >= 50) return "bg-amber-400"
  return "bg-emerald-500"
}

export function parseDueDateMs(dateStr?: string): number {
  if (!dateStr?.trim()) return Number.POSITIVE_INFINITY
  const d = new Date(dateStr)
  if (!isNaN(d.getTime())) return d.getTime()
  const m = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
  if (m) {
    const day = Number(m[1])
    const month = Number(m[2]) - 1
    const year = Number(m[3].length === 2 ? `20${m[3]}` : m[3])
    const dt = new Date(year, month, day)
    if (!isNaN(dt.getTime())) return dt.getTime()
  }
  return Number.POSITIVE_INFINITY
}

export const formatDate = (dateStr?: string) => {
  if (!dateStr) return "—"
  const date = new Date(dateStr)
  if (!isNaN(date.getTime())) {
    return date
      .toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      .toUpperCase()
  }
  return dateStr.toUpperCase()
}

export function buildGroupedData(
  statements: Statement[],
  globalFilter?: string
): StatementGroupData[] {
  const groups: Record<string, StatementGroupData> = {}

  statements.forEach((s) => {
    if (globalFilter) {
      const q = globalFilter.toLowerCase()
      const bankMatch = (s.bankName?.val || "").toLowerCase().includes(q)
      const accMatch = (s.accountNumber?.val || "").toLowerCase().includes(q)
      const periodMatch = `${s.statementPeriod?.from || ""} ${s.statementPeriod?.to || ""}`
        .toLowerCase()
        .includes(q)
      if (!bankMatch && !accMatch && !periodMatch) return
    }

    const bankKey = (s.bankName?.val || "Unknown Bank").trim()
    const accKey = (s.accountNumber?.val || "N/A").trim()
    const key = `${bankKey.toUpperCase()}-${accKey.toUpperCase()}`

    if (!groups[key]) {
      groups[key] = {
        name: bankKey,
        accNum: s.accountNumber?.val || "",
        items: [],
      }
    }
    groups[key].items.push(s)
  })

  return Object.values(groups).sort((a, b) => a.name.localeCompare(b.name))
}
