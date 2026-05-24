import { useNavigate } from "react-router-dom"
import {
  IconCreditCard,
  IconReceipt2,
  IconTrendingUp,
  IconAlertCircle,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  type PortfolioDetailKind,
  type CardPortfolioRow,
  fmt,
  formatDate,
  utilizationColor,
  utilizationBarColor,
  parseDueDateMs,
} from "@/lib/statementShared"

interface PortfolioDetailDialogProps {
  kind: PortfolioDetailKind | null
  onClose: () => void
  cardPortfolioRows: CardPortfolioRow[]
  totalCreditLimit: number
  totalOutstanding: number
  totalMinDue: number
  avgUtil: number
}

export function PortfolioDetailDialog({
  kind,
  onClose,
  cardPortfolioRows,
  totalCreditLimit,
  totalOutstanding,
  totalMinDue,
  avgUtil,
}: PortfolioDetailDialogProps) {
  const navigate = useNavigate()

  const meta = kind
    ? {
        limit: {
          title: "Portfolio Limit",
          description:
            "Credit limit per card from your most recent statement in each account.",
          icon: IconCreditCard,
          color: "bg-blue-50 text-blue-600",
        },
        debt: {
          title: "Combined Debt",
          description: "Outstanding balance per card and share of total portfolio debt.",
          icon: IconAlertCircle,
          color: "bg-red-50 text-red-500",
        },
        utilization: {
          title: "Utilization",
          description:
            "How much of each card limit you have used (latest statement per account).",
          icon: IconTrendingUp,
          color: avgUtil >= 80 ? "bg-red-100 text-red-600" : "bg-emerald-50 text-emerald-600",
        },
        minDue: {
          title: "Upcoming Minimum Due",
          description: "Minimum payment and due date per card (latest statement).",
          icon: IconReceipt2,
          color: "bg-amber-50 text-amber-600",
        },
      }[kind]
    : null

  const headerTotal =
    kind === "limit"
      ? fmt(totalCreditLimit)
      : kind === "debt"
        ? fmt(totalOutstanding)
        : kind === "utilization"
          ? `${avgUtil}%`
          : kind === "minDue"
            ? fmt(totalMinDue)
            : ""

  const sortedRows = [...cardPortfolioRows]
  if (kind === "utilization") sortedRows.sort((a, b) => b.utilizationPct - a.utilizationPct)
  else if (kind === "debt") sortedRows.sort((a, b) => b.outstanding - a.outstanding)
  else if (kind === "minDue") {
    sortedRows.sort((a, b) => {
      const da = parseDueDateMs(a.paymentDueDate)
      const db = parseDueDateMs(b.paymentDueDate)
      if (da !== db) return da - db
      return b.minDue - a.minDue
    })
  } else if (kind === "limit") {
    sortedRows.sort((a, b) => b.creditLimit - a.creditLimit)
  }

  const MetaIcon = meta?.icon

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden rounded-lg border border-slate-200 shadow-lg">
        {kind && meta && MetaIcon && (
          <>
            <DialogHeader className="px-4 sm:px-6 pt-5 sm:pt-6 pb-4 border-b border-slate-100 shrink-0">
              <div className="flex items-start gap-3 sm:gap-4">
                <div className={cn("h-10 w-10 rounded-md flex items-center justify-center shrink-0 shadow-inner", meta.color)}>
                  <MetaIcon size={18} />
                </div>
                <div className="space-y-1 min-w-0">
                  <DialogTitle className="text-lg sm:text-xl font-black text-slate-900 tracking-tight leading-none">
                    {meta.title}
                  </DialogTitle>
                  <DialogDescription className="text-xs font-medium text-slate-500 leading-relaxed mt-2">
                    {meta.description}
                  </DialogDescription>
                  <p className="text-xl sm:text-2xl font-black text-slate-900 tabular-nums pt-2 leading-none break-words">{headerTotal}</p>
                </div>
              </div>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-3">
              {sortedRows.length === 0 ? (
                <p className="text-xs font-semibold text-slate-400 text-center py-8">
                  No credit card statements yet.
                </p>
              ) : (
                sortedRows.map((row) => {
                  const debtShare =
                    totalOutstanding > 0 ? Math.round((row.outstanding / totalOutstanding) * 100) : 0

                  return (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => navigate(`/statements/${row.latestStatementId}`)}
                      className="w-full text-left rounded-md border border-slate-200/80 bg-slate-50/20 hover:bg-white hover:border-primary/20 hover:shadow-xs p-4 transition-all cursor-pointer shadow-2xs"
                    >
                      <div className="flex items-start justify-between gap-2 sm:gap-3 mb-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate leading-tight">{row.bankName}</p>
                          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider truncate leading-none mt-1">
                            {row.accNum ? `•••• ${row.accNum.slice(-4)}` : "Card account"} · {row.periodLabel}
                          </p>
                        </div>
                        {kind === "limit" && (
                          <span className="text-xs font-bold text-blue-600 tabular-nums shrink-0">
                            {fmt(row.creditLimit)}
                          </span>
                        )}
                        {kind === "debt" && (
                          <span className="text-xs font-bold text-red-600 tabular-nums shrink-0">
                            {fmt(row.outstanding)}
                          </span>
                        )}
                        {kind === "utilization" && (
                          <span
                            className={cn(
                              "text-xs font-bold tabular-nums shrink-0 px-2 py-0.5 rounded border leading-none",
                              utilizationColor(row.utilizationPct)
                            )}
                          >
                            {row.utilizationPct}%
                          </span>
                        )}
                        {kind === "minDue" && (
                          <span className="text-xs font-bold text-amber-700 tabular-nums shrink-0">
                            {fmt(row.minDue)}
                          </span>
                        )}
                      </div>

                      {kind === "limit" && (
                        <div className="grid grid-cols-2 gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          <div>
                            <span className="block text-slate-400">Available</span>
                            <span className="text-slate-800 tabular-nums normal-case text-xs font-black">
                              {row.availableLimit > 0 ? fmt(row.availableLimit) : "—"}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="block text-slate-400">Outstanding</span>
                            <span className="text-slate-800 tabular-nums normal-case text-xs font-black">
                              {fmt(row.outstanding)}
                            </span>
                          </div>
                        </div>
                      )}

                      {kind === "debt" && (
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            <span>Share of total debt</span>
                            <span className="text-slate-700">{debtShare}%</span>
                          </div>
                          <div className="h-1.5 rounded bg-slate-100 overflow-hidden">
                            <div
                              className="h-full bg-red-400 rounded transition-all"
                              style={{ width: `${Math.min(100, debtShare)}%` }}
                            />
                          </div>
                          <p className="text-[10px] font-semibold text-slate-500">
                            Limit {fmt(row.creditLimit)} · {row.utilizationPct}% utilized
                          </p>
                        </div>
                      )}

                      {kind === "utilization" && (
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            <span>
                              {fmt(row.outstanding)} of {fmt(row.creditLimit)}
                            </span>
                            <span className={utilizationColor(row.utilizationPct).split(" ")[0]}>
                              {row.utilizationPct >= 80
                                ? "Critical"
                                : row.utilizationPct >= 50
                                  ? "Moderate"
                                  : "Safe"}
                            </span>
                          </div>
                          <div className="h-2 rounded bg-slate-100 overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded transition-all",
                                utilizationBarColor(row.utilizationPct)
                              )}
                              style={{ width: `${Math.min(100, row.utilizationPct)}%` }}
                            />
                          </div>
                          {row.availableLimit > 0 && (
                            <p className="text-[10px] font-semibold text-slate-500">
                              Available {fmt(row.availableLimit)}
                            </p>
                          )}
                        </div>
                      )}

                      {kind === "minDue" && (
                        <div className="flex items-center justify-between gap-3 pt-0.5">
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider leading-none">
                              Payment due
                            </p>
                            <p className="text-xs font-black text-slate-800 leading-none mt-1">
                              {row.paymentDueDate
                                ? formatDate(row.paymentDueDate)
                                : "Date not on statement"}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider leading-none">
                              Outstanding
                            </p>
                            <p className="text-xs font-black text-slate-700 tabular-nums leading-none mt-1">
                              {fmt(row.outstanding)}
                            </p>
                          </div>
                        </div>
                      )}
                    </button>
                  )
                })
              )}
            </div>

            <DialogFooter className="px-4 sm:px-6 py-4 border-t border-slate-100 bg-slate-50/50 shrink-0">
              <Button type="button" variant="outline" className="rounded-md font-bold text-xs h-9 cursor-pointer w-full" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
