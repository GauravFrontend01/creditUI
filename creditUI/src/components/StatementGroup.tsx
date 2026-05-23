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

          <div
            className={cn(
              "h-10 w-10 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-400 transition-transform duration-300 shadow-sm",
              isOpen && "rotate-180 text-primary border-primary/20"
            )}
          >
            <IconChevronDown size={20} />
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
          <div className="px-8 pb-8 pt-2 space-y-3">
            <div className="grid grid-cols-12 px-6 py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
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
                          Processed:{" "}
                          {new Date(st.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>

                    <div className="col-span-2 font-bold text-sm text-slate-900 tabular-nums text-right pr-4">
                      {st.type === "BANK" ? fmt(st.closingBalance?.val) : fmt(st.outstandingTotal?.val)}
                    </div>

                    <div className="col-span-2 font-bold text-sm text-amber-600 tabular-nums text-right pr-4">
                      {st.type === "BANK" ? (
                        <div className="flex flex-col items-end">
                          <span className="text-emerald-600">+{fmt(st.totalDeposits?.val)}</span>
                          <span className="text-red-400 text-[10px]">-{fmt(st.totalWithdrawals?.val)}</span>
                        </div>
                      ) : (
                        fmt(st.minPaymentDue?.val)
                      )}
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
                      <span
                        className={cn(
                          "text-[10px] font-bold uppercase tracking-wider",
                          extracting ? "text-slate-400" : "text-primary"
                        )}
                      >
                        {extracting ? "Wait" : "View"}
                      </span>
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
