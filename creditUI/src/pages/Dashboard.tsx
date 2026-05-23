import * as React from "react"
import { useNavigate } from "react-router-dom"
import {
  IconLoader2,
  IconCreditCard,
  IconReceipt2,
  IconTrendingUp,
  IconAlertCircle,
  IconPlus,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { StatCard } from "@/components/StatCard"
import { PortfolioDetailDialog } from "@/components/PortfolioDetailDialog"
import { useStatementsPortfolio } from "@/hooks/useStatementsPortfolio"
import {
  type PortfolioDetailKind,
  fmt,
} from "@/lib/statementShared"

export default function Dashboard() {
  const navigate = useNavigate()
  const [portfolioDetail, setPortfolioDetail] = React.useState<PortfolioDetailKind | null>(null)
  const [spendHoverCat, setSpendHoverCat] = React.useState<string | null>(null)
  const spendHoverLeaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const {
    statements,
    loading,
    totalOutstanding,
    totalCreditLimit,
    totalMinDue,
    avgUtil,
    cardPortfolioRows,
    portfolioAnalytics,
  } = useStatementsPortfolio()

  React.useEffect(() => {
    return () => {
      if (spendHoverLeaveTimer.current) clearTimeout(spendHoverLeaveTimer.current)
    }
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 gap-4">
        <IconLoader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Loading dashboard…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans">
      <div className="max-w-[1600px] mx-auto px-8 py-10 space-y-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-slate-900">Dashboard</h1>
            <p className="text-sm text-slate-500 mt-1 font-medium italic">
              Portfolio overview across {statements.length} statement
              {statements.length === 1 ? "" : "s"}
            </p>
          </div>
          <Button
            onClick={() => navigate("/upload")}
            className="rounded-2xl px-6 h-12 gap-2 shadow-lg shadow-primary/20 font-black text-sm uppercase tracking-wider"
          >
            <IconPlus size={18} strokeWidth={3} /> New Audit
          </Button>
        </div>

        {statements.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <StatCard
                icon={IconCreditCard}
                label="Portfolio Limit"
                value={fmt(totalCreditLimit)}
                sub={`Across ${cardPortfolioRows.length} card${cardPortfolioRows.length === 1 ? "" : "s"}`}
                color="bg-blue-50 text-blue-600"
                onClick={() => setPortfolioDetail("limit")}
              />
              <StatCard
                icon={IconAlertCircle}
                label="Combined Debt"
                value={fmt(totalOutstanding)}
                sub="Live aggregate"
                color="bg-red-50 text-red-500"
                onClick={() => setPortfolioDetail("debt")}
              />
              <StatCard
                icon={IconTrendingUp}
                label="Utilization"
                value={`${avgUtil}%`}
                sub={avgUtil >= 80 ? "Critical usage" : "Safe range"}
                color={avgUtil >= 80 ? "bg-red-100 text-red-600" : "bg-emerald-50 text-emerald-600"}
                onClick={() => setPortfolioDetail("utilization")}
              />
              <StatCard
                icon={IconReceipt2}
                label="Upcoming Min"
                value={fmt(totalMinDue)}
                sub="Priority focus"
                color="bg-amber-50 text-amber-600"
                onClick={() => setPortfolioDetail("minDue")}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm flex flex-col h-full">
                  <div className="flex items-center justify-between mb-8">
                    <div className="space-y-1">
                      <h3 className="text-xl font-black text-slate-900 tracking-tight">Financial Velocity</h3>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">
                        Net Capital Movement • Consolidated
                      </p>
                    </div>
                    <div className="h-10 w-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400">
                      <IconTrendingUp size={20} />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-8 mb-8">
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        Consolidated Income
                      </p>
                      <p className="text-2xl font-black text-emerald-600 tabular-nums">
                        +{fmt(portfolioAnalytics.totalIncome)}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        Portfolio Burn
                      </p>
                      <p className="text-2xl font-black text-red-500 tabular-nums">
                        -{fmt(portfolioAnalytics.totalSpending).replace("₹", "")}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        Net Cash Flow
                      </p>
                      <p
                        className={cn(
                          "text-2xl font-black tabular-nums",
                          portfolioAnalytics.netFlow >= 0 ? "text-primary" : "text-amber-600"
                        )}
                      >
                        {portfolioAnalytics.netFlow >= 0 ? "+" : ""}
                        {fmt(portfolioAnalytics.netFlow)}
                      </p>
                    </div>
                  </div>

                  <div className="flex-1 min-h-[140px] bg-slate-50/50 rounded-3xl border border-dashed border-slate-200 flex items-center justify-center relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                    <div className="text-center space-y-2 relative z-10 p-6">
                      <p className="text-xs font-bold text-slate-500 max-w-[280px] leading-relaxed">
                        Across all accounts, your net position this cycle is{" "}
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded-lg text-white font-black",
                            portfolioAnalytics.netFlow >= 0 ? "bg-emerald-500" : "bg-amber-500"
                          )}
                        >
                          {portfolioAnalytics.netFlow >= 0 ? "Surplus" : "Deficit"}
                        </span>
                      </p>
                      <p className="text-[9px] font-black uppercase text-slate-400 tracking-[0.2em] mt-4">
                        Forensic Liquidity Score: <span className="text-slate-800">84/100</span>
                      </p>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 h-16 opacity-10 flex items-end gap-1 px-8">
                      {[40, 70, 45, 90, 65, 80, 55, 95, 75, 85].map((h, i) => (
                        <div
                          key={i}
                          className="flex-1 bg-primary rounded-t-lg transition-all duration-1000 group-hover:h-full"
                          style={{ height: `${h}%` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm space-y-8">
                <div className="space-y-1">
                  <h3 className="text-xl font-black text-slate-900 tracking-tight">Spending IQ</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">
                    Categorical Attribution
                  </p>
                  <p className="text-[10px] text-slate-400 font-medium leading-snug pt-1">
                    Hover a category to see merchants and custom vendor tags. Set tags on any statement’s
                    transaction row.
                  </p>
                </div>

                <div className="space-y-5">
                  {portfolioAnalytics.categoryList.length > 0 ? (
                    portfolioAnalytics.categoryList.slice(0, 6).map((cat, i) => {
                      const pct =
                        portfolioAnalytics.totalSpending > 0
                          ? Math.round((cat.amount / portfolioAnalytics.totalSpending) * 100)
                          : 0
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
                              <div
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full shrink-0",
                                  i === 0
                                    ? "bg-primary"
                                    : i === 1
                                      ? "bg-indigo-400"
                                      : i === 2
                                        ? "bg-amber-400"
                                        : "bg-slate-300"
                                )}
                              />
                              <span className="text-xs font-bold text-slate-700 uppercase tracking-wide truncate">
                                {cat.name}
                              </span>
                            </div>
                            <span className="text-xs font-black text-slate-900 tabular-nums shrink-0">
                              {fmt(cat.amount)}
                            </span>
                          </div>
                          <div className="relative h-1.5 w-full bg-slate-50 rounded-full overflow-hidden">
                            <div
                              className={cn(
                                "absolute inset-y-0 left-0 rounded-full transition-all duration-1000",
                                i === 0
                                  ? "bg-primary"
                                  : i === 1
                                    ? "bg-indigo-400"
                                    : i === 2
                                      ? "bg-amber-400"
                                      : "bg-slate-300"
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="flex justify-end">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">
                              {pct}% OF BURN
                            </span>
                          </div>

                          {openSpend && (
                            <div
                              className="absolute left-0 right-0 top-full z-40 mt-1 rounded-2xl border border-slate-100 bg-white p-3 shadow-xl shadow-slate-200/60"
                              onMouseEnter={onSpendCatEnter}
                              onMouseLeave={onSpendCatLeave}
                            >
                              {vendors.length === 0 ? (
                                <p className="text-[11px] text-slate-500 font-medium">
                                  No merchant rows found for this category.
                                </p>
                              ) : (
                                <>
                                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">
                                    Vendors & tags
                                  </p>
                                  <ul className="max-h-44 space-y-1.5 overflow-y-auto pr-0.5">
                                    {vendors.slice(0, 10).map((v, vi) => {
                                      const vp =
                                        cat.amount > 0 ? Math.round((v.amount / cat.amount) * 100) : 0
                                      return (
                                        <li
                                          key={`${v.label}-${vi}`}
                                          className="flex items-start justify-between gap-2 text-[11px]"
                                        >
                                          <span className="font-semibold text-slate-700 leading-tight break-words min-w-0">
                                            {v.label}
                                          </span>
                                          <span className="shrink-0 text-right">
                                            <span className="font-bold text-slate-900 tabular-nums">
                                              {fmt(v.amount)}
                                            </span>
                                            <span className="text-[9px] font-bold text-slate-400 ml-1">
                                              {vp}%
                                            </span>
                                          </span>
                                        </li>
                                      )
                                    })}
                                  </ul>
                                  {vendors.length > 10 && (
                                    <p className="text-[9px] text-slate-400 mt-2 font-medium">
                                      +{vendors.length - 10} more
                                    </p>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })
                  ) : (
                    <div className="py-12 flex flex-col items-center justify-center gap-2 opacity-30">
                      <IconReceipt2 size={32} />
                      <p className="text-[10px] font-bold uppercase">No data categorized</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="py-32 flex flex-col items-center justify-center bg-white rounded-[3rem] border border-dashed border-slate-200 text-slate-300 gap-4">
            <div className="h-20 w-20 rounded-3xl bg-slate-50 flex items-center justify-center">
              <IconReceipt2 size={40} className="opacity-20" />
            </div>
            <div className="text-center">
              <p className="text-lg font-black text-slate-400">No statements yet</p>
              <p className="text-sm font-bold text-slate-300 mt-1 uppercase tracking-widest">
                Upload a PDF to see your dashboard
              </p>
            </div>
            <Button
              onClick={() => navigate("/upload")}
              className="mt-4 rounded-xl px-8 h-12 font-bold"
            >
              Upload statement
            </Button>
          </div>
        )}

        <PortfolioDetailDialog
          kind={portfolioDetail}
          onClose={() => setPortfolioDetail(null)}
          cardPortfolioRows={cardPortfolioRows}
          totalCreditLimit={totalCreditLimit}
          totalOutstanding={totalOutstanding}
          totalMinDue={totalMinDue}
          avgUtil={avgUtil}
        />
      </div>
    </div>
  )
}
