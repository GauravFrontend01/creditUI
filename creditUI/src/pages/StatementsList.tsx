import * as React from "react"
import { useNavigate } from "react-router-dom"
import api from "@/lib/api"
import {
  IconSearch,
  IconPlus,
  IconLoader2,
  IconCreditCard,
  IconReceipt2,
  IconTrendingUp,
  IconAlertCircle,
  IconCheck,
  IconChevronDown,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { txRuleKey } from "@/lib/vendorRules"

// ── Types ──────────────────────────────────────────────────────────────────
interface Statement {
  _id: string
  bankName: { val: string; box?: number[]; page?: number }
  accountNumber?: { val: string; box?: number[]; page?: number }
  statementPeriod?: { from: string; to: string; box?: number[]; page?: number }
  createdAt: string
  creditLimit?: { val: number }
  availableLimit?: { val: number }
  outstandingTotal?: { val: number }
  minPaymentDue?: { val: number }
  transactions?: { 
    _id: string; 
    amount?: number; 
    deposit?: number; 
    withdrawal?: number; 
    type: string; 
    category?: string; 
    isInternal?: boolean;
    description?: string;
    merchantName?: string;
  }[]
  currency?: string
  status?: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"
  isApproved?: boolean
  type?: "CREDIT_CARD" | "BANK"
  closingBalance?: { val: number }
  totalDeposits?: { val: number }
  totalWithdrawals?: { val: number }
}

// ── Helpers ────────────────────────────────────────────────────────────────
const fmt = (val?: number | null) =>
  typeof val === "number" && !Number.isNaN(val)
    ? `₹${val.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
    : "—"

const utilizationColor = (pct: number) => {
  if (pct >= 80) return "text-red-600 bg-red-50"
  if (pct >= 50) return "text-amber-600 bg-amber-50"
  return "text-emerald-600 bg-emerald-50"
}

/**
 * Normalizes dates to "23 Feb 2026" style.
 * Handles both "2025-10-01" and existing "23 Feb 2026" strings.
 */
const formatDate = (dateStr?: string) => {
  if (!dateStr) return "—";
  
  // Try parsing as standard date
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).toUpperCase(); // E.g. "23 FEB 2026"
  }
  
  // Fallback: if already a formatted string, return as-is
  return dateStr.toUpperCase();
};

// ── Statement Group ────────────────────────────────────────────────────────
interface GroupProps {
  name: string
  accNum: string
  items: Statement[]
  navigate: any
  fmt: (v?: number) => string
}

function StatementGroup({ name, accNum, items, navigate, fmt }: GroupProps) {
  const [isOpen, setIsOpen] = React.useState(true)
  
  const totalLimit = items.reduce((s, i) => s + (i.creditLimit?.val ?? 0), 0)
  const totalOutstanding = items.reduce((s, i) => s + (i.outstandingTotal?.val ?? 0), 0)
  const avgUtil = totalLimit > 0 ? Math.round((totalOutstanding / totalLimit) * 100) : 0

  return (
    <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden transition-all duration-300">
      <div 
        className={cn(
          "px-8 py-6 flex items-center justify-between cursor-pointer select-none transition-colors",
          isOpen ? "bg-slate-50/50" : "hover:bg-slate-50/30"
        )}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner">
            <IconCreditCard size={24} />
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-900 tracking-tight">{name}</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mt-1">
              {accNum ? `ACC: ${accNum}` : "UNSPECIFIED ACCOUNT"} • {items.length} STATEMENTS
            </p>
          </div>
        </div>

        <div className="flex items-center gap-12">
          {!isOpen && (
            <div className="hidden md:flex items-center gap-8 animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="text-right">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Outstanding</p>
                <p className="text-sm font-bold text-slate-900 tabular-nums">{fmt(totalOutstanding)}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Utilization</p>
                <p className={cn("text-sm font-bold tabular-nums", utilizationColor(avgUtil))}>{avgUtil}%</p>
              </div>
            </div>
          )}
          
          <div className={cn(
            "h-10 w-10 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-400 transition-transform duration-300 shadow-sm",
            isOpen && "rotate-180 text-primary border-primary/20"
          )}>
            <IconChevronDown size={20} />
          </div>
        </div>
      </div>

      <div className={cn(
        "grid transition-all duration-500 ease-in-out",
        isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}>
        <div className="overflow-hidden">
          <div className="px-8 pb-8 pt-2 space-y-3">
            <div className="grid grid-cols-12 px-6 py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
              <div className="col-span-4">Statement Period / Date</div>
              <div className="col-span-2 text-right pr-4">Balance / Outstanding</div>
              <div className="col-span-2 text-right pr-4">Activity / Min Due</div>
              <div className="col-span-2 text-center">Status</div>
              <div className="col-span-2 text-right pr-4">Open</div>
            </div>

            {items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(st => {
              const status = st.status || "COMPLETED"
              const extracting = status === "PENDING" || status === "PROCESSING"
              return (
                <div 
                  key={st._id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (extracting) return
                    navigate(`/statements/${st._id}`)
                  }}
                  onKeyDown={(e) => {
                    if (extracting) return
                    if (e.key === "Enter" || e.key === " ") navigate(`/statements/${st._id}`)
                  }}
                  className={cn(
                    "grid grid-cols-12 items-center px-6 py-4 rounded-2xl bg-slate-50/30 border border-transparent transition-all group",
                    extracting
                      ? "cursor-not-allowed opacity-70"
                      : "hover:bg-white hover:shadow-md hover:border-slate-100 cursor-pointer"
                  )}
                >
                  <div className="col-span-4 flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-white border border-slate-100 flex items-center justify-center text-slate-400 group-hover:text-primary transition-colors shadow-sm">
                      <IconReceipt2 size={16} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-700">
                        {st.statementPeriod?.from && st.statementPeriod?.to
                          ? `${formatDate(st.statementPeriod.from)} — ${formatDate(st.statementPeriod.to)}` 
                          : formatDate(st.createdAt)}
                      </p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                        Processed: {new Date(st.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  
                  <div className="col-span-2 font-bold text-sm text-slate-900 tabular-nums text-right pr-4">
                    {st.type === "BANK" 
                      ? fmt(st.closingBalance?.val) 
                      : fmt(st.outstandingTotal?.val)}
                  </div>

                  <div className="col-span-2 font-bold text-sm text-amber-600 tabular-nums text-right pr-4">
                    {st.type === "BANK"
                      ? (
                        <div className="flex flex-col items-end">
                           <span className="text-emerald-600">+{fmt(st.totalDeposits?.val)}</span>
                           <span className="text-red-400 text-[10px]">-{fmt(st.totalWithdrawals?.val)}</span>
                        </div>
                      )
                      : fmt(st.minPaymentDue?.val)}
                  </div>

                  <div className="col-span-2 flex justify-center">
                    {extracting ? (
                      <div className="flex items-center gap-1.5 text-amber-500 font-bold text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 border border-amber-100/50">
                        <IconLoader2 size={10} className="animate-spin" />
                        Extracting
                      </div>
                    ) : status === "FAILED" ? (
                      <div className="flex items-center gap-1.5 text-red-600 font-bold text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-50 border border-red-100/50">
                        <IconAlertCircle size={10} />
                        Failed
                      </div>
                    ) : st.isApproved ? (
                      <div className="flex items-center gap-1.5 text-emerald-600 font-bold text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-100/50">
                        <IconCheck size={10} strokeWidth={3} />
                        Verified
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-blue-500 font-bold text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-50 border border-blue-100/50">
                        <IconAlertCircle size={10} />
                        Review
                      </div>
                    )}
                  </div>

                  <div className="col-span-2 flex justify-end pr-2">
                    <span className={cn(
                      "text-[10px] font-bold uppercase tracking-wider",
                      extracting ? "text-slate-400" : "text-primary"
                    )}>{extracting ? "Wait" : "View"}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: any
  label: string
  value: string
  sub?: string
  color: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
        <div className={cn("h-8 w-8 rounded-xl flex items-center justify-center", color)}>
          <Icon size={16} />
        </div>
      </div>
      <p className="text-xl font-bold text-slate-900 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-slate-400 font-semibold">{sub}</p>}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────
interface VendorRuleRow {
  merchantName: string
  category: string
  vendorLabel?: string
}

export default function StatementsList() {
  const [statements, setStatements] = React.useState<Statement[]>([])
  const [loading, setLoading] = React.useState(true)
  const [globalFilter, setGlobalFilter] = React.useState("")
  const [vendorRules, setVendorRules] = React.useState<VendorRuleRow[]>([])
  const [spendHoverCat, setSpendHoverCat] = React.useState<string | null>(null)
  const spendHoverLeaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigate = useNavigate()

  React.useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const fetch_ = async () => {
      try {
        const res = await api.get("/api/statements");
        setStatements(res.data);

        const hasActiveJobs = res.data.some((s: Statement) => 
          s.status === "PENDING" || s.status === "PROCESSING"
        );

        if (hasActiveJobs) {
          timeoutId = setTimeout(fetch_, 4000);
        }
      } catch (err) {
        console.error("Failed to fetch statements", err);
      } finally {
        setLoading(false);
      }
    };
    
    fetch_();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  React.useEffect(() => {
    api.get("/api/vendor-rules").then((res) => setVendorRules(res.data)).catch(() => {})
  }, [])

  React.useEffect(() => {
    return () => {
      if (spendHoverLeaveTimer.current) clearTimeout(spendHoverLeaveTimer.current)
    }
  }, [])

  const groupedData = React.useMemo(() => {
    const groups: Record<string, { name: string; accNum: string; items: Statement[] }> = {}
    
    statements.forEach(s => {
      if (globalFilter) {
        const q = globalFilter.toLowerCase()
        const bankMatch = (s.bankName?.val || "").toLowerCase().includes(q)
        const accMatch = (s.accountNumber?.val || "").toLowerCase().includes(q)
        const periodMatch = `${s.statementPeriod?.from || ""} ${s.statementPeriod?.to || ""}`.toLowerCase().includes(q)
        if (!bankMatch && !accMatch && !periodMatch) return
      }

      const bankKey = s.bankName?.val || "Unknown Bank"
      const accKey = s.accountNumber?.val || "N/A"
      const key = `${bankKey}-${accKey}`

      if (!groups[key]) {
        groups[key] = { 
          name: bankKey, 
          accNum: s.accountNumber?.val || "", 
          items: [] 
        }
      }
      groups[key].items.push(s)
    })
    
    return Object.values(groups).sort((a, b) => a.name.localeCompare(b.name))
  }, [statements, globalFilter])

  const creditStatements = statements.filter(s => s.type !== "BANK")
  const totalOutstanding = creditStatements.reduce((s, st) => s + (st.outstandingTotal?.val ?? 0), 0)
  const totalCreditLimit = creditStatements.reduce((s, st) => s + (st.creditLimit?.val ?? 0), 0)
  const totalMinDue = creditStatements.reduce((s, st) => s + (st.minPaymentDue?.val ?? 0), 0)
  const avgUtil = totalCreditLimit > 0 ? Math.round((totalOutstanding / totalCreditLimit) * 100) : 0

  const vendorRulesByKey = React.useMemo(() => {
    const m = new Map<string, VendorRuleRow>()
    for (const r of vendorRules) {
      m.set(r.merchantName.trim().toLowerCase(), r)
    }
    return m
  }, [vendorRules])

  // ── Portfolio Analytics Calculation ─────────────────────────────────────────
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 gap-4">
        <IconLoader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Loading Portfolios...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans">
      <div className="max-w-[1600px] mx-auto px-8 py-10 space-y-10">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-slate-900">Portfolio Vault</h1>
            <p className="text-sm text-slate-500 mt-1 font-medium italic">
              {statements.length} forensic statement audits active
            </p>
          </div>
            <div className="flex items-center gap-4">
              <div className="relative group">
                <IconSearch size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" />
                <input
                  type="text"
                  placeholder="Search audit trail..."
                  value={globalFilter}
                  onChange={(e) => setGlobalFilter(e.target.value)}
                  className="h-12 w-80 pl-11 pr-4 bg-white border border-slate-200 rounded-2xl shadow-sm text-sm font-bold placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-primary/5 focus:border-primary/30 transition-all"
                />
              </div>
              <Button
                onClick={() => navigate("/")}
                className="rounded-2xl px-6 h-12 gap-2 shadow-lg shadow-primary/20 font-black text-sm uppercase tracking-wider"
              >
                <IconPlus size={18} strokeWidth={3} /> New Audit
              </Button>
            </div>
    
        </div>

        {statements.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <StatCard icon={IconCreditCard} label="Portfolio Limit" value={fmt(totalCreditLimit)} sub={`Across ${groupedData.length} Banks`} color="bg-blue-50 text-blue-600" />
            <StatCard icon={IconAlertCircle} label="Combined Debt" value={fmt(totalOutstanding)} sub="Live aggregate" color="bg-red-50 text-red-500" />
            <StatCard icon={IconTrendingUp} label="Utilization" value={`${avgUtil}%`} sub={avgUtil >= 80 ? "Critical usage" : "Safe range"} color={avgUtil >= 80 ? "bg-red-100 text-red-600" : "bg-emerald-50 text-emerald-600"} />
            <StatCard icon={IconReceipt2} label="Upcoming Min" value={fmt(totalMinDue)} sub="Priority focus" color="bg-amber-50 text-amber-600" />
          </div>
        )}

        {/* ── Portfolio Analytics Dashboard ──────────────────────────────────── */}
        {statements.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Cash Flow Insights */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm flex flex-col h-full">
                <div className="flex items-center justify-between mb-8">
                  <div className="space-y-1">
                    <h3 className="text-xl font-black text-slate-900 tracking-tight">Financial Velocity</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Net Capital Movement • Consolidated</p>
                  </div>
                  <div className="h-10 w-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400">
                    <IconTrendingUp size={20} />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-8 mb-8">
                  <div className="space-y-2">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Consolidated Income</p>
                    <p className="text-2xl font-black text-emerald-600 tabular-nums">+{fmt(portfolioAnalytics.totalIncome)}</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Portfolio Burn</p>
                    <p className="text-2xl font-black text-red-500 tabular-nums">-{fmt(portfolioAnalytics.totalSpending).replace('₹', '')}</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Net Cash Flow</p>
                    <p className={cn(
                      "text-2xl font-black tabular-nums",
                      portfolioAnalytics.netFlow >= 0 ? "text-primary" : "text-amber-600"
                    )}>
                      {portfolioAnalytics.netFlow >= 0 ? '+' : ''}{fmt(portfolioAnalytics.netFlow)}
                    </p>
                  </div>
                </div>

                <div className="flex-1 min-h-[140px] bg-slate-50/50 rounded-3xl border border-dashed border-slate-200 flex items-center justify-center relative overflow-hidden group">
                   <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                   <div className="text-center space-y-2 relative z-10 p-6">
                      <p className="text-xs font-bold text-slate-500 max-w-[280px] leading-relaxed">
                        Across All accounts, your net position this cycle is <span className={cn("px-1.5 py-0.5 rounded-lg text-white font-black", portfolioAnalytics.netFlow >= 0 ? "bg-emerald-500" : "bg-amber-500")}>
                          {portfolioAnalytics.netFlow >= 0 ? 'Surplus' : 'Deficit'}
                        </span>
                      </p>
                      <p className="text-[9px] font-black uppercase text-slate-400 tracking-[0.2em] mt-4">Forensic Liquidity Score: <span className="text-slate-800">84/100</span></p>
                   </div>
                   
                   {/* Decorative Graph Placeholder Lines */}
                   <div className="absolute bottom-0 left-0 right-0 h-16 opacity-10 flex items-end gap-1 px-8">
                      {[40, 70, 45, 90, 65, 80, 55, 95, 75, 85].map((h, i) => (
                        <div key={i} className="flex-1 bg-primary rounded-t-lg transition-all duration-1000 group-hover:h-full" style={{ height: `${h}%` }} />
                      ))}
                   </div>
                </div>
              </div>
            </div>

            {/* Category Intelligence */}
            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm space-y-8">
              <div className="space-y-1">
                <h3 className="text-xl font-black text-slate-900 tracking-tight">Spending IQ</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Categorical Attribution</p>
                <p className="text-[10px] text-slate-400 font-medium leading-snug pt-1">
                  Hover a category to see merchants and custom vendor tags. Set tags on any statement’s transaction row.
                </p>
              </div>

              <div className="space-y-5">
                {portfolioAnalytics.categoryList.length > 0 ? portfolioAnalytics.categoryList.slice(0, 6).map((cat, i) => {
                  const pct = portfolioAnalytics.totalSpending > 0 
                    ? Math.round((cat.amount / portfolioAnalytics.totalSpending) * 100) 
                    : 0;
                  const vendors = portfolioAnalytics.vendorsByCategory[cat.name] ?? []
                  const openSpend = spendHoverCat === cat.name

                  const clearSpendHoverTimer = () => {
                    if (spendHoverLeaveTimer.current) {
                      clearTimeout(spendHoverLeaveTimer.current)
                      spendHoverLeaveTimer.current = null
                    }
                  }
                  const onSpendCatEnter = () => {
                    clearSpendHoverTimer()
                    setSpendHoverCat(cat.name)
                  }
                  const onSpendCatLeave = () => {
                    clearSpendHoverTimer()
                    spendHoverLeaveTimer.current = setTimeout(() => setSpendHoverCat(null), 220)
                  }
                  
                  return (
                    <div
                      key={cat.name}
                      className="relative space-y-2 rounded-2xl px-1 -mx-1 transition-colors"
                      onMouseEnter={onSpendCatEnter}
                      onMouseLeave={onSpendCatLeave}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={cn("h-1.5 w-1.5 rounded-full shrink-0",
                            i === 0 ? "bg-primary" : 
                            i === 1 ? "bg-indigo-400" :
                            i === 2 ? "bg-amber-400" : "bg-slate-300"
                          )} />
                          <span className="text-xs font-bold text-slate-700 uppercase tracking-wide truncate">{cat.name}</span>
                        </div>
                        <span className="text-xs font-black text-slate-900 tabular-nums shrink-0">{fmt(cat.amount)}</span>
                      </div>
                      <div className="relative h-1.5 w-full bg-slate-50 rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "absolute inset-y-0 left-0 rounded-full transition-all duration-1000",
                            i === 0 ? "bg-primary" : 
                            i === 1 ? "bg-indigo-400" :
                            i === 2 ? "bg-amber-400" : "bg-slate-300"
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex justify-end">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">{pct}% OF BURN</span>
                      </div>

                      {openSpend && (
                        <div
                          className="absolute left-0 right-0 top-full z-40 mt-1 rounded-2xl border border-slate-100 bg-white p-3 shadow-xl shadow-slate-200/60"
                          onMouseEnter={onSpendCatEnter}
                          onMouseLeave={onSpendCatLeave}
                        >
                          {vendors.length === 0 ? (
                            <p className="text-[11px] text-slate-500 font-medium">No merchant rows found for this category.</p>
                          ) : (
                            <>
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Vendors & tags</p>
                              <ul className="max-h-44 space-y-1.5 overflow-y-auto pr-0.5">
                                {vendors.slice(0, 10).map((v, vi) => {
                                  const vp = cat.amount > 0 ? Math.round((v.amount / cat.amount) * 100) : 0
                                  return (
                                    <li key={`${v.label}-${vi}`} className="flex items-start justify-between gap-2 text-[11px]">
                                      <span className="font-semibold text-slate-700 leading-tight break-words min-w-0">{v.label}</span>
                                      <span className="shrink-0 text-right">
                                        <span className="font-bold text-slate-900 tabular-nums">{fmt(v.amount)}</span>
                                        <span className="text-[9px] font-bold text-slate-400 ml-1">{vp}%</span>
                                      </span>
                                    </li>
                                  )
                                })}
                              </ul>
                              {vendors.length > 10 && (
                                <p className="text-[9px] text-slate-400 mt-2 font-medium">+{vendors.length - 10} more</p>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                }) : (
                  <div className="py-12 flex flex-col items-center justify-center gap-2 opacity-30">
                    <IconReceipt2 size={32} />
                    <p className="text-[10px] font-bold uppercase">No data categorized</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-6">
          {groupedData.length > 0 ? (
            groupedData.map(group => (
              <StatementGroup key={`${group.name}-${group.accNum}`} {...group} navigate={navigate} fmt={fmt} />
            ))
          ) : (
            <div className="py-32 flex flex-col items-center justify-center bg-white rounded-[3rem] border border-dashed border-slate-200 text-slate-300 gap-4">
              <div className="h-20 w-20 rounded-3xl bg-slate-50 flex items-center justify-center">
                <IconReceipt2 size={40} className="opacity-20" />
              </div>
              <div className="text-center">
                <p className="text-lg font-black text-slate-400">Zero Audits Found</p>
                <p className="text-sm font-bold text-slate-300 mt-1 uppercase tracking-widest">Awaiting Neural Extraction</p>
              </div>
              <Button onClick={() => navigate("/")} variant="outline" className="mt-4 rounded-xl px-8 h-12 border-slate-200 text-slate-500 font-bold hover:bg-slate-50 transition-all">
                Initiate New Audit
              </Button>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
