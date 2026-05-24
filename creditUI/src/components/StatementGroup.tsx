import * as React from "react"
import { useNavigate } from "react-router-dom"
import {
  IconCreditCard,
  IconReceipt2,
  IconChevronDown,
  IconLoader2,
  IconAlertCircle,
  IconCheck,
} from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import {
  type Statement,
  fmt,
  formatDate,
  utilizationColor,
} from "@/lib/statementShared"

interface StatementGroupProps {
  name: string
  accNum: string
  items: Statement[]
}

export function StatementGroup({ name, accNum, items }: StatementGroupProps) {
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = React.useState(true)

  const totalLimit = items.reduce((s, i) => s + (i.creditLimit?.val ?? 0), 0)
  const totalOutstanding = items.reduce((s, i) => s + (i.outstandingTotal?.val ?? 0), 0)
  const avgUtil = totalLimit > 0 ? Math.round((totalOutstanding / totalLimit) * 100) : 0
  const renderStatusBadge = (st: Statement) => {
    const status = st.status || "COMPLETED"
    const extracting = status === "PENDING" || status === "PROCESSING"

    if (extracting) {
      return (
        <div className="flex items-center gap-1.5 text-amber-600 font-bold text-[9px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-50 border border-amber-200/50">
          <IconLoader2 size={10} className="animate-spin" />
          Extracting
        </div>
      )
    }

    if (status === "FAILED") {
      return (
        <div className="flex items-center gap-1.5 text-rose-600 font-bold text-[9px] uppercase tracking-wider px-2 py-0.5 rounded bg-rose-50 border border-rose-200/50">
          <IconAlertCircle size={10} />
          Failed
        </div>
      )
    }

    if (st.isApproved) {
      return (
        <div className="flex items-center gap-1.5 text-emerald-600 font-bold text-[9px] uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200/50">
          <IconCheck size={10} strokeWidth={3} />
          Verified
        </div>
      )
    }

    return (
      <div className="flex items-center gap-1.5 text-blue-600 font-bold text-[9px] uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 border border-blue-200/50">
        <IconAlertCircle size={10} />
        Review
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200/80 shadow-xs overflow-hidden transition-all duration-300">
      <div
        className={cn(
          "px-4 py-4 sm:px-6 sm:py-4.5 flex items-center justify-between gap-3 cursor-pointer select-none transition-colors",
          isOpen ? "bg-slate-50/40" : "hover:bg-slate-50/20"
        )}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <div className="h-10 w-10 rounded-md bg-slate-50 border border-slate-200/60 flex items-center justify-center text-slate-500 shadow-inner">
            <IconCreditCard size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-slate-900 tracking-tight">{name}</h3>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider leading-none mt-1.5">
              {accNum ? `ACC: ${accNum}` : "UNSPECIFIED ACCOUNT"} • {items.length} STATEMENTS
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 sm:gap-8">
          {!isOpen && (
            <div className="hidden md:flex items-center gap-6 animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="text-right">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Outstanding</p>
                <p className="text-xs font-bold text-slate-900 tabular-nums">{fmt(totalOutstanding)}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Utilization</p>
                <p className={cn("text-xs font-bold px-1.5 py-0.5 rounded tabular-nums", utilizationColor(avgUtil))}>{avgUtil}%</p>
              </div>
            </div>
          )}

          <div
            className={cn(
              "h-8 w-8 rounded-md bg-white border border-slate-200 flex items-center justify-center text-slate-500 transition-transform duration-300 shadow-xs",
              isOpen && "rotate-180 text-primary border-primary/20"
            )}
          >
            <IconChevronDown size={16} />
          </div>
        </div>
      </div>

      <div
        className={cn(
          "grid transition-all duration-500 ease-in-out",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <div className="px-4 sm:px-6 pb-5 sm:pb-6 pt-2 space-y-2">
            <div className="hidden md:grid grid-cols-12 px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 bg-slate-50/50 rounded-t-md">
              <div className="col-span-4">Statement Period / Date</div>
              <div className="col-span-2 text-right pr-4">Balance / Outstanding</div>
              <div className="col-span-2 text-right pr-4">Activity / Min Due</div>
              <div className="col-span-2 text-center">Status</div>
              <div className="col-span-2 text-right pr-4">Open</div>
            </div>

            {items
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map((st) => {
                const status = st.status || "COMPLETED"
                const extracting = status === "PENDING" || status === "PROCESSING"
                return (
                  <React.Fragment key={st._id}>
                  <div
                    role="button"
                    tabIndex={extracting ? -1 : 0}
                    onClick={() => {
                      if (extracting) return
                      navigate(`/statements/${st._id}`)
                    }}
                    onKeyDown={(e) => {
                      if (extracting) return
                      if (e.key === "Enter" || e.key === " ") navigate(`/statements/${st._id}`)
                    }}
                    className={cn(
                      "md:hidden rounded-md bg-white border border-slate-100 p-4 shadow-2xs transition-all active:scale-[0.99]",
                      extracting ? "cursor-not-allowed opacity-70" : "cursor-pointer active:border-primary/30"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold leading-tight text-slate-900">
                          {st.statementPeriod?.from && st.statementPeriod?.to
                            ? `${formatDate(st.statementPeriod.from)} - ${formatDate(st.statementPeriod.to)}`
                            : formatDate(st.createdAt)}
                        </p>
                        <p className="mt-1 text-[10px] font-semibold text-slate-500">
                          Processed{" "}
                          {new Date(st.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <div className="shrink-0">{renderStatusBadge(st)}</div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                          {st.type === "BANK" ? "Closing" : "Outstanding"}
                        </p>
                        <p className="mt-1 text-xs font-black tabular-nums text-slate-900">
                          {st.type === "BANK" ? fmt(st.closingBalance?.val) : fmt(st.outstandingTotal?.val)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                          {st.type === "BANK" ? "Activity" : "Min due"}
                        </p>
                        {st.type === "BANK" ? (
                          <p className="mt-1 text-xs font-bold leading-snug">
                            <span className="text-emerald-600">+{fmt(st.totalDeposits?.val)}</span>
                            <span className="mx-1 text-slate-300">/</span>
                            <span className="text-rose-500">-{fmt(st.totalWithdrawals?.val)}</span>
                          </p>
                        ) : (
                          <p className="mt-1 text-xs font-black tabular-nums text-amber-700">
                            {fmt(st.minPaymentDue?.val)}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
                      <span
                        className={cn(
                          "text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded bg-slate-900 text-white transition-all",
                          extracting && "bg-slate-100 text-slate-400"
                        )}
                      >
                        {extracting ? "Wait" : "View"}
                      </span>
                    </div>
                  </div>

                  <div
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
                      "hidden md:grid grid-cols-12 items-center px-4 py-3 rounded-md bg-white border border-slate-100 hover:border-slate-300 hover:shadow-xs transition-all cursor-pointer group",
                      extracting && "cursor-not-allowed opacity-70"
                    )}
                  >
                    <div className="col-span-4 flex items-center gap-3">
                      <div className="h-8 w-8 rounded bg-slate-50 border border-slate-200/60 flex items-center justify-center text-slate-500 group-hover:text-slate-800 transition-colors shadow-xs">
                        <IconReceipt2 size={15} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-800">
                          {st.statementPeriod?.from && st.statementPeriod?.to
                            ? `${formatDate(st.statementPeriod.from)} — ${formatDate(st.statementPeriod.to)}`
                            : formatDate(st.createdAt)}
                        </p>
                        <p className="text-[10px] font-medium text-slate-500">
                          Processed:{" "}
                          {new Date(st.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>

                    <div className="col-span-2 font-bold text-xs text-slate-900 tabular-nums text-right pr-4">
                      {st.type === "BANK" ? fmt(st.closingBalance?.val) : fmt(st.outstandingTotal?.val)}
                    </div>

                    <div className="col-span-2 font-bold text-xs text-amber-600 tabular-nums text-right pr-4">
                      {st.type === "BANK" ? (
                        <div className="flex flex-col items-end">
                          <span className="text-emerald-600">+{fmt(st.totalDeposits?.val)}</span>
                          <span className="text-rose-500 text-[10px] font-medium">-{fmt(st.totalWithdrawals?.val)}</span>
                        </div>
                      ) : (
                        fmt(st.minPaymentDue?.val)
                      )}
                    </div>

                    <div className="col-span-2 flex justify-center">
                      {extracting ? (
                        <div className="flex items-center gap-1.5 text-amber-600 font-bold text-[9px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-50 border border-amber-200/50">
                          <IconLoader2 size={10} className="animate-spin" />
                          Extracting
                        </div>
                      ) : status === "FAILED" ? (
                        <div className="flex items-center gap-1.5 text-rose-600 font-bold text-[9px] uppercase tracking-wider px-2 py-0.5 rounded bg-rose-50 border border-rose-200/50">
                          <IconAlertCircle size={10} />
                          Failed
                        </div>
                      ) : st.isApproved ? (
                        <div className="flex items-center gap-1.5 text-emerald-600 font-bold text-[9px] uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200/50">
                          <IconCheck size={10} strokeWidth={3} />
                          Verified
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-blue-600 font-bold text-[9px] uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 border border-blue-200/50">
                          <IconAlertCircle size={10} />
                          Review
                        </div>
                      )}
                    </div>

                    <div className="col-span-2 flex justify-end pr-2">
                      <span
                        className={cn(
                          "text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-slate-50 border border-slate-200/80 group-hover:bg-slate-900 group-hover:text-white group-hover:border-slate-900 transition-all",
                          extracting ? "text-slate-400" : "text-slate-700"
                        )}
                      >
                        {extracting ? "Wait" : "View"}
                      </span>
                    </div>
                  </div>
                  </React.Fragment>
                )
              })}
          </div>
        </div>
      </div>
    </div>
  )
}
