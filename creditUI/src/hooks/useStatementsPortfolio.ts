import * as React from "react"
import api from "@/lib/api"
import { txRuleKey } from "@/lib/vendorRules"
import {
  type Statement,
  type VendorRuleRow,
  type CardPortfolioRow,
  buildGroupedData,
  formatDate,
} from "@/lib/statementShared"

export function useStatementsPortfolio(globalFilter = "") {
  const [statements, setStatements] = React.useState<Statement[]>([])
  const [loading, setLoading] = React.useState(true)
  const [vendorRules, setVendorRules] = React.useState<VendorRuleRow[]>([])

  React.useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const fetch_ = async () => {
      try {
        const res = await api.get("/api/statements")
        setStatements(res.data)

        const hasActiveJobs = res.data.some(
          (s: Statement) => s.status === "PENDING" || s.status === "PROCESSING"
        )
        if (hasActiveJobs) {
          timeoutId = setTimeout(fetch_, 4000)
        }
      } catch (err) {
        console.error("Failed to fetch statements", err)
      } finally {
        setLoading(false)
      }
    }

    fetch_()
    return () => {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [])

  React.useEffect(() => {
    api
      .get("/api/vendor-rules")
      .then((res) => setVendorRules(res.data))
      .catch(() => {})
  }, [])

  const groupedData = React.useMemo(
    () => buildGroupedData(statements, globalFilter),
    [statements, globalFilter]
  )

  const groupedDataAll = React.useMemo(
    () => buildGroupedData(statements),
    [statements]
  )

  const creditStatements = statements.filter((s) => s.type !== "BANK")
  const totalOutstanding = creditStatements.reduce(
    (s, st) => s + (st.outstandingTotal?.val ?? 0),
    0
  )
  const totalCreditLimit = creditStatements.reduce(
    (s, st) => s + (st.creditLimit?.val ?? 0),
    0
  )
  const totalMinDue = creditStatements.reduce(
    (s, st) => s + (st.minPaymentDue?.val ?? 0),
    0
  )
  const avgUtil =
    totalCreditLimit > 0 ? Math.round((totalOutstanding / totalCreditLimit) * 100) : 0

  const cardPortfolioRows = React.useMemo((): CardPortfolioRow[] => {
    const rows: CardPortfolioRow[] = []

    groupedDataAll.forEach((group) => {
      const creditItems = group.items.filter(
        (s) => s.type !== "BANK" && (s.status === "COMPLETED" || !s.status)
      )
      if (!creditItems.length) return

      const latest = [...creditItems].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0]

      const creditLimit = latest.creditLimit?.val ?? 0
      const outstanding = latest.outstandingTotal?.val ?? 0
      const utilizationPct =
        creditLimit > 0 ? Math.round((outstanding / creditLimit) * 100) : 0

      rows.push({
        key: `${group.name}-${group.accNum}`,
        bankName: group.name,
        accNum: group.accNum,
        creditLimit,
        outstanding,
        availableLimit: latest.availableLimit?.val ?? 0,
        minDue: latest.minPaymentDue?.val ?? 0,
        paymentDueDate: latest.paymentDueDate?.val ?? "",
        utilizationPct,
        latestStatementId: latest._id,
        periodLabel:
          latest.statementPeriod?.from && latest.statementPeriod?.to
            ? `${formatDate(latest.statementPeriod.from)} — ${formatDate(latest.statementPeriod.to)}`
            : formatDate(latest.createdAt),
      })
    })

    return rows.sort((a, b) => a.bankName.localeCompare(b.bankName))
  }, [groupedDataAll])

  const vendorRulesByKey = React.useMemo(() => {
    const m = new Map<string, VendorRuleRow>()
    for (const r of vendorRules) {
      m.set(r.merchantName.trim().toLowerCase(), r)
    }
    return m
  }, [vendorRules])

  const portfolioAnalytics = React.useMemo(() => {
    type Tx = NonNullable<Statement["transactions"]>[number]

    const vendorLabelFor = (tx: Tx, rule: VendorRuleRow | undefined) => {
      if (rule?.vendorLabel?.trim()) return rule.vendorLabel.trim()
      if (tx.merchantName?.trim()) return tx.merchantName.trim()
      const d = (tx.description || "").trim()
      return d.length > 40 ? `${d.slice(0, 40)}…` : d || "Unknown"
    }

    const bucketKey = (tx: Tx, rule: VendorRuleRow | undefined) => {
      if (rule?.vendorLabel?.trim()) return `tag:${rule.vendorLabel.trim().toLowerCase()}`
      return `m:${txRuleKey(tx)}`
    }

    const mergeVendors = (cat: string) => {
      const map = new Map<string, { label: string; amount: number }>()
      statements.forEach((st) => {
        if (st.status !== "COMPLETED") return
        for (const tx of st.transactions || []) {
          const isInternal = tx.isInternal || tx.category === "Transfer"
          const isMerchantEMI = tx.description?.toUpperCase().includes("FP EMI")
          if (isInternal || isMerchantEMI || tx.type !== "Debit") continue
          const c = tx.category || "Other"
          if (c !== cat) continue
          const amount = tx.amount || tx.deposit || tx.withdrawal || 0
          const rule = vendorRulesByKey.get(txRuleKey(tx))
          const bKey = bucketKey(tx, rule)
          const label = vendorLabelFor(tx, rule)
          const prev = map.get(bKey)
          if (prev) map.set(bKey, { label: prev.label, amount: prev.amount + amount })
          else map.set(bKey, { label, amount })
        }
      })
      return [...map.values()].sort((a, b) => b.amount - a.amount)
    }

    const categoriesOnly: Record<string, number> = {}
    let inc = 0
    let spend = 0
    statements.forEach((st) => {
      if (st.status !== "COMPLETED") return
      for (const tx of st.transactions || []) {
        const isInternal = tx.isInternal || tx.category === "Transfer"
        const isMerchantEMI = tx.description?.toUpperCase().includes("FP EMI")
        if (isInternal || isMerchantEMI) continue
        const amount = tx.amount || tx.deposit || tx.withdrawal || 0
        if (tx.type === "Credit") inc += amount
        else if (tx.type === "Debit") {
          spend += amount
          const cat = tx.category || "Other"
          categoriesOnly[cat] = (categoriesOnly[cat] || 0) + amount
        }
      }
    })

    const catList = Object.entries(categoriesOnly)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount)

    const vendorsByCategory: Record<string, { label: string; amount: number }[]> = {}
    for (const { name } of catList) {
      vendorsByCategory[name] = mergeVendors(name)
    }

    return {
      totalIncome: inc,
      totalSpending: spend,
      netFlow: inc - spend,
      categoryList: catList,
      vendorsByCategory,
    }
  }, [statements, vendorRulesByKey])

  return {
    statements,
    setStatements,
    loading,
    groupedData,
    groupedDataAll,
    creditStatements,
    totalOutstanding,
    totalCreditLimit,
    totalMinDue,
    avgUtil,
    cardPortfolioRows,
    portfolioAnalytics,
  }
}
