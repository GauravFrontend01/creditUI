import * as React from "react"
import { useNavigate } from "react-router-dom"
import api from "@/lib/api"
import {
  IconSearch,
  IconPlus,
  IconLoader2,
  IconCreditCard,
  IconReceipt2,
  IconTrash,
  IconTable,
  IconLayoutGrid,
  IconArrowUp,
  IconArrowDown,
  IconSelector,
  IconBuildingBank,
  IconCheck,
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
import { StatementGroup } from "@/components/StatementGroup"
import { useStatementsPortfolio } from "@/hooks/useStatementsPortfolio"
import {
  type Statement,
  fmt,
  formatDate,
} from "@/lib/statementShared"

function conciseStatus(st: Statement) {
  const status = st.status || "COMPLETED"
  if (status === "PENDING" || status === "PROCESSING")
    return { label: "Extracting", className: "bg-amber-50 text-amber-700 border-amber-200" }
  if (status === "FAILED")
    return { label: "Failed", className: "bg-rose-50 text-rose-700 border-rose-200" }
  if (st.isApproved)
    return { label: "Verified", className: "bg-emerald-50 text-emerald-700 border-emerald-100" }
  return { label: "Review", className: "bg-blue-50 text-blue-700 border-blue-200" }
}

type SortKey = "bankName" | "type" | "period" | "balance" | "status"
type SortOrder = "asc" | "desc" | null

export default function StatementsList() {
  const [globalFilter, setGlobalFilter] = React.useState("")
  const navigate = useNavigate()

  const [bulkOpen, setBulkOpen] = React.useState(false)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = React.useState(false)

  // Options view mode toggle (defaults to Table View)
  const [viewMode, setViewMode] = React.useState<"grouped" | "table">(() => {
    return (localStorage.getItem("statements-view-mode") as "grouped" | "table") || "table"
  })

  // Table sorting states
  const [sortKey, setSortKey] = React.useState<SortKey>("period")
  const [sortOrder, setSortOrder] = React.useState<SortOrder>("desc")

  const {
    statements,
    setStatements,
    loading,
    groupedData,
    groupedDataAll,
  } = useStatementsPortfolio(globalFilter)

  const selectAllIds = React.useCallback(() => {
    setSelectedIds(new Set(statements.map((s) => s._id)))
  }, [statements])

  const clearSelection = React.useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const toggleId = React.useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleGroup = React.useCallback((items: Statement[]) => {
    const ids = items.map((i) => i._id)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const allOn = ids.length > 0 && ids.every((id) => next.has(id))
      if (allOn) ids.forEach((id) => next.delete(id))
      else ids.forEach((id) => next.add(id))
      return next
    })
  }, [])

  const runBulkDelete = React.useCallback(async () => {
    const ids = Array.from(selectedIds)
    if (!ids.length) return
    const remove = new Set(ids)
    setBulkDeleting(true)
    try {
      await api.post("/api/statements/bulk-delete", { ids })
      setStatements((prev) => prev.filter((s) => !remove.has(s._id)))
      setBulkOpen(false)
      clearSelection()
    } catch (e) {
      console.error("Bulk delete failed", e)
    } finally {
      setBulkDeleting(false)
    }
  }, [selectedIds, clearSelection, setStatements])

  // Custom filter for unified Flat Table View
  const filteredStatements = React.useMemo(() => {
    if (!globalFilter) return statements
    const q = globalFilter.toLowerCase()
    return statements.filter((s) => {
      const bankMatch = (s.bankName?.val || "").toLowerCase().includes(q)
      const accMatch = (s.accountNumber?.val || "").toLowerCase().includes(q)
      const periodMatch = s.statementPeriod?.from && s.statementPeriod?.to
        ? `${formatDate(s.statementPeriod.from)} ${formatDate(s.statementPeriod.to)}`.toLowerCase().includes(q)
        : formatDate(s.createdAt).toLowerCase().includes(q)
      const statusMatch = (s.status || "COMPLETED").toLowerCase().includes(q)
      const typeMatch = (s.type || "CREDIT_CARD").toLowerCase().includes(q)
      return bankMatch || accMatch || periodMatch || statusMatch || typeMatch
    })
  }, [statements, globalFilter])

  // Custom sorting logic for Flat Table View
  const sortedStatements = React.useMemo(() => {
    if (!sortKey || !sortOrder) return filteredStatements

    const sorted = [...filteredStatements].sort((a, b) => {
      let valA: any = ""
      let valB: any = ""

      if (sortKey === "bankName") {
        valA = (a.bankName?.val || "").toLowerCase()
        valB = (b.bankName?.val || "").toLowerCase()
      } else if (sortKey === "type") {
        valA = a.type || "CREDIT_CARD"
        valB = b.type || "CREDIT_CARD"
      } else if (sortKey === "period") {
        valA = a.statementPeriod?.from ? new Date(a.statementPeriod.from).getTime() : new Date(a.createdAt).getTime()
        valB = b.statementPeriod?.from ? new Date(b.statementPeriod.from).getTime() : new Date(b.createdAt).getTime()
      } else if (sortKey === "balance") {
        valA = a.type === "BANK" ? (a.closingBalance?.val ?? 0) : (a.outstandingTotal?.val ?? 0)
        valB = b.type === "BANK" ? (b.closingBalance?.val ?? 0) : (b.outstandingTotal?.val ?? 0)
      } else if (sortKey === "status") {
        valA = a.status || "COMPLETED"
        if (a.isApproved && valA === "COMPLETED") valA = "VERIFIED"
        valB = b.status || "COMPLETED"
        if (b.isApproved && valB === "COMPLETED") valB = "VERIFIED"
      }

      if (valA < valB) return sortOrder === "asc" ? -1 : 1
      if (valA > valB) return sortOrder === "asc" ? 1 : -1
      return 0
    })

    return sorted
  }, [filteredStatements, sortKey, sortOrder])

  // Table view Master Checkbox logic
  const allSortedSelected = sortedStatements.length > 0 && sortedStatements.every((s) => selectedIds.has(s._id))
  const someSortedSelected = sortedStatements.some((s) => selectedIds.has(s._id))

  const handleMasterCheckboxChange = React.useCallback(() => {
    if (allSortedSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        sortedStatements.forEach((s) => next.delete(s._id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        sortedStatements.forEach((s) => next.add(s._id))
        return next
      })
    }
  }, [sortedStatements, allSortedSelected])

  const changeViewMode = (mode: "grouped" | "table") => {
    setViewMode(mode)
    localStorage.setItem("statements-view-mode", mode)
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortOrder === "asc") setSortOrder("desc")
      else if (sortOrder === "desc") {
        setSortKey("period")
        setSortOrder("desc")
      }
    } else {
      setSortKey(key)
      setSortOrder("asc")
    }
  }

  const renderSortHeader = (label: string, key: SortKey, alignment: "left" | "right" | "center" = "left") => {
    const isSorted = sortKey === key
    return (
      <button
        type="button"
        onClick={() => handleSort(key)}
        className={cn(
          "flex items-center gap-1 font-bold text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-800 transition-colors w-full focus:outline-none select-none py-1 group/btn cursor-pointer",
          alignment === "right" && "justify-end",
          alignment === "center" && "justify-center"
        )}
      >
        <span>{label}</span>
        {isSorted ? (
          sortOrder === "asc" ? <IconArrowUp size={11} className="text-slate-800 shrink-0" /> : <IconArrowDown size={11} className="text-slate-800 shrink-0" />
        ) : (
          <IconSelector size={11} className="text-slate-400 opacity-0 group-hover/btn:opacity-100 transition-opacity shrink-0" />
        )}
      </button>
    )
  }

  const renderStatementCard = (s: Statement) => {
    const primary = s.type === "BANK" ? fmt(s.closingBalance?.val) : fmt(s.outstandingTotal?.val)
    const extracting = s.status === "PENDING" || s.status === "PROCESSING"
    const cs = conciseStatus(s)
    const period =
      s.statementPeriod?.from && s.statementPeriod?.to
        ? `${formatDate(s.statementPeriod.from)} - ${formatDate(s.statementPeriod.to)}`
        : formatDate(s.createdAt)

    return (
      <div
        key={s._id}
        role="button"
        tabIndex={extracting ? -1 : 0}
        onClick={() => {
          if (!extracting) navigate(`/statements/${s._id}`)
        }}
        onKeyDown={(e) => {
          if (extracting) return
          if (e.key === "Enter" || e.key === " ") navigate(`/statements/${s._id}`)
        }}
        className={cn(
          "rounded-lg border border-slate-200 bg-white p-4 shadow-2xs transition-all active:scale-[0.99]",
          extracting ? "opacity-75" : "cursor-pointer active:border-primary/30"
        )}
      >
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={selectedIds.has(s._id)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggleId(s._id)}
            className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-primary focus:ring-primary"
            aria-label={`Select statement ${s.bankName?.val}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-black leading-tight text-slate-900">
                  {s.bankName?.val || "Unknown Institution"}
                </p>
                <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {s.accountNumber?.val ? `ACC: ${s.accountNumber.val}` : "Unspecified account"}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded border px-2 py-1 text-[9px] font-black uppercase tracking-wider leading-none",
                  cs.className
                )}
              >
                {cs.label}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Period</p>
                <p className="mt-1 text-xs font-bold leading-snug text-slate-800">{period}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                  {s.type === "BANK" ? "Closing" : "Outstanding"}
                </p>
                <p className="mt-1 text-xs font-black tabular-nums text-slate-900">{primary}</p>
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Type</p>
                <p className="mt-1 text-xs font-bold text-slate-700">{s.type === "BANK" ? "Bank" : "Card"}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                  {s.type === "BANK" ? "Activity" : "Min due"}
                </p>
                {s.type === "BANK" ? (
                  <p className="mt-1 text-xs font-bold leading-snug">
                    <span className="text-emerald-600">+{fmt(s.totalDeposits?.val)}</span>
                    <span className="mx-1 text-slate-300">/</span>
                    <span className="text-rose-500">-{fmt(s.totalWithdrawals?.val)}</span>
                  </p>
                ) : (
                  <p className="mt-1 text-xs font-black tabular-nums text-amber-700">{fmt(s.minPaymentDue?.val)}</p>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-[10px] font-semibold text-slate-400">
                Processed {new Date(s.createdAt).toLocaleDateString("en-GB")}
              </span>
              <span className="rounded-md bg-slate-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white">
                {extracting ? "Wait" : "View"}
              </span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-slate-50 px-4">
        <IconLoader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading statements…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans">
      <div className="max-w-[1600px] mx-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-10 space-y-6 lg:space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900 leading-none">My Statements</h1>
            <p className="text-xs text-slate-500 mt-2 font-medium italic">
              {statements.length} forensic statement audit{statements.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            {/* View mode toggle switch */}
            <div className="flex w-full items-center border border-slate-200 rounded-md p-1 bg-slate-50/50 shrink-0 shadow-2xs sm:w-auto">
              <button
                type="button"
                onClick={() => changeViewMode("table")}
                className={cn(
                  "flex-1 px-3 h-8 gap-1.5 flex items-center justify-center text-xs font-semibold rounded-sm transition-all select-none border border-transparent cursor-pointer sm:flex-none",
                  viewMode === "table"
                    ? "bg-white text-slate-900 shadow-xs border-slate-200/80"
                    : "text-slate-500 hover:text-slate-800"
                )}
              >
                <IconTable size={15} />
                <span>Table</span>
              </button>
              <button
                type="button"
                onClick={() => changeViewMode("grouped")}
                className={cn(
                  "flex-1 px-3 h-8 gap-1.5 flex items-center justify-center text-xs font-semibold rounded-sm transition-all select-none border border-transparent cursor-pointer sm:flex-none",
                  viewMode === "grouped"
                    ? "bg-white text-slate-900 shadow-xs border-slate-200/80"
                    : "text-slate-500 hover:text-slate-800"
                )}
              >
                <IconLayoutGrid size={15} />
                <span>Grouped</span>
              </button>
            </div>

            {/* Search Input */}
            <div className="relative group w-full sm:w-auto">
              <IconSearch
                size={16}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors"
              />
              <input
                type="text"
                placeholder="Search statements…"
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="h-10 w-full pl-10 pr-4 bg-white border border-slate-200 rounded-md shadow-2xs text-xs font-semibold placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/5 focus:border-primary/30 transition-all sm:w-72"
              />
            </div>

            {/* Actions */}
            <Button
              type="button"
              variant="outline"
              disabled={statements.length === 0}
              onClick={() => {
                selectAllIds()
                setBulkOpen(true)
              }}
              className="h-10 flex-1 rounded-md px-4 gap-2 border-slate-200 font-bold text-xs uppercase tracking-wider text-slate-700 hover:bg-red-50 hover:border-red-200 hover:text-red-700 cursor-pointer shadow-2xs sm:flex-none"
            >
              <IconTrash size={16} strokeWidth={2} /> Bulk delete
            </Button>
            <Button
              onClick={() => navigate("/upload")}
              className="h-10 flex-1 rounded-md px-5 gap-2 shadow-sm font-bold text-xs uppercase tracking-wider cursor-pointer sm:flex-none"
            >
              <IconPlus size={16} strokeWidth={3} /> New Audit
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          {viewMode === "table" ? (
            /* Premium modern Flat Table view */
            sortedStatements.length > 0 ? (
              <>
              <div className="space-y-3 md:hidden">
                {sortedStatements.map(renderStatementCard)}
              </div>
              <div className="hidden border border-slate-200/80 rounded-lg overflow-hidden bg-white shadow-2xs md:block">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="bg-slate-50/50 border-b border-slate-100 text-[10px] uppercase font-bold text-slate-500 divide-x divide-transparent">
                        <th className="py-3 px-4 w-12 text-center align-middle">
                          <input
                            type="checkbox"
                            checked={allSortedSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = someSortedSelected && !allSortedSelected
                            }}
                            onChange={handleMasterCheckboxChange}
                            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary cursor-pointer shrink-0"
                            aria-label="Select all sorted statements"
                          />
                        </th>
                        <th className="py-3 px-4 min-w-[240px] group/th font-bold">{renderSortHeader("Institution", "bankName")}</th>
                        <th className="py-3 px-4 w-28 group/th font-bold">{renderSortHeader("Type", "type")}</th>
                        <th className="py-3 px-4 min-w-[180px] group/th font-bold">{renderSortHeader("Statement Period / Date", "period")}</th>
                        <th className="py-3 px-4 w-44 group/th font-bold text-right">{renderSortHeader("Balance / Outstanding", "balance", "right")}</th>
                        <th className="py-3 px-4 w-44 font-bold text-right">Activity / Min Due</th>
                        <th className="py-3 px-4 w-32 group/th font-bold text-center">{renderSortHeader("Status", "status", "center")}</th>
                        <th className="py-3 px-4 w-28 text-right font-bold">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sortedStatements.map((s) => {
                        const primary = s.type === "BANK" ? fmt(s.closingBalance?.val) : fmt(s.outstandingTotal?.val)
                        const extracting = s.status === "PENDING" || s.status === "PROCESSING"
                        const failed = s.status === "FAILED"
                        const isApproved = s.isApproved

                        return (
                          <tr
                            key={s._id}
                            className={cn(
                              "hover:bg-slate-50/40 transition-colors group cursor-pointer",
                              extracting && "opacity-75"
                            )}
                            onClick={(e) => {
                              // Prevent navigation if clicking on checkbox or actions or extracting
                              if ((e.target as HTMLElement).closest("input[type=checkbox]") || (e.target as HTMLElement).closest("span.action-btn") || extracting) return
                              navigate(`/statements/${s._id}`)
                            }}
                          >
                            <td className="py-3.5 px-4 text-center align-middle" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedIds.has(s._id)}
                                onChange={() => toggleId(s._id)}
                                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary cursor-pointer shrink-0"
                                aria-label={`Select statement ${s.bankName?.val}`}
                              />
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded bg-slate-50 border border-slate-200/60 flex items-center justify-center text-slate-500 shrink-0 shadow-inner">
                                  {s.type === "BANK" ? <IconBuildingBank size={15} /> : <IconCreditCard size={15} />}
                                </div>
                                <div className="min-w-0">
                                  <span className="font-semibold text-slate-900 block text-xs truncate leading-tight group-hover:text-primary transition-colors">{s.bankName?.val || "Unknown Institution"}</span>
                                  <span className="text-[9px] text-slate-500 block font-semibold uppercase tracking-wider leading-none mt-1 truncate">
                                    {s.accountNumber?.val ? `ACC: ${s.accountNumber.val}` : "UNSPECIFIED ACCOUNT"}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              <span className={cn(
                                "text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border leading-none inline-block",
                                s.type === "BANK"
                                  ? "bg-purple-50 text-purple-700 border-purple-200/60"
                                  : "bg-indigo-50 text-indigo-700 border-indigo-200/60"
                              )}>
                                {s.type === "BANK" ? "Bank" : "Card"}
                              </span>
                            </td>
                            <td className="py-3.5 px-4">
                              <div>
                                <span className="font-semibold text-slate-800 block text-xs leading-none">
                                  {s.statementPeriod?.from && s.statementPeriod?.to
                                    ? `${formatDate(s.statementPeriod.from)} — ${formatDate(s.statementPeriod.to)}`
                                    : formatDate(s.createdAt)}
                                </span>
                                <span className="text-[9px] text-slate-400 font-medium block mt-1 leading-none">
                                  Processed: {new Date(s.createdAt).toLocaleDateString("en-GB")}
                                </span>
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <span className="font-bold text-slate-900 text-xs tabular-nums">
                                {primary}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              {s.type === "BANK" ? (
                                <div className="flex flex-col items-end">
                                  <span className="text-emerald-600 font-bold text-xs leading-none">+{fmt(s.totalDeposits?.val)}</span>
                                  <span className="text-rose-500 text-[10px] font-semibold mt-1 leading-none">-{fmt(s.totalWithdrawals?.val)}</span>
                                </div>
                              ) : (
                                <div className="flex flex-col items-end">
                                  <span className="font-bold text-slate-900 text-xs leading-none">{fmt(s.minPaymentDue?.val)}</span>
                                  <span className="text-[9px] text-slate-400 font-semibold mt-1 leading-none">MIN DUE</span>
                                </div>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <div className="flex justify-center">
                                {extracting ? (
                                  <div className="flex items-center gap-1.5 text-amber-600 font-bold text-[9px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-50 border border-amber-200/50 leading-none">
                                    <IconLoader2 size={10} className="animate-spin" />
                                    Extracting
                                  </div>
                                ) : failed ? (
                                  <div className="flex items-center gap-1.5 text-rose-600 font-bold text-[9px] uppercase tracking-wider px-2 py-0.5 rounded bg-rose-50 border border-rose-200/50 leading-none">
                                    <IconAlertCircle size={10} />
                                    Failed
                                  </div>
                                ) : isApproved ? (
                                  <div className="flex items-center gap-1.5 text-emerald-600 font-bold text-[9px] uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200/50 leading-none">
                                    <IconCheck size={10} strokeWidth={3} />
                                    Verified
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5 text-blue-600 font-bold text-[9px] uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 border border-blue-200/50 leading-none">
                                    <IconAlertCircle size={10} />
                                    Review
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                              <span
                                className={cn(
                                  "action-btn text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-slate-50 border border-slate-200/80 group-hover:bg-slate-900 group-hover:text-white group-hover:border-slate-900 transition-all select-none leading-none inline-block",
                                  extracting ? "text-slate-400 pointer-events-none" : "text-slate-700 cursor-pointer"
                                )}
                                onClick={() => {
                                  if (extracting) return
                                  navigate(`/statements/${s._id}`)
                                }}
                              >
                                {extracting ? "Wait" : "View"}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              </>
            ) : (
              /* No statements search results empty state with low roundness */
              <div className="py-16 sm:py-24 px-4 flex flex-col items-center justify-center bg-white rounded-lg border border-dashed border-slate-200 text-slate-300 gap-4">
                <div className="h-16 w-16 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center shadow-2xs">
                  <IconReceipt2 size={32} className="opacity-20 text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-base font-bold text-slate-700">No statements found</p>
                  <p className="text-xs font-semibold text-slate-400 mt-1 uppercase tracking-wider">
                    {globalFilter ? "Try a different search query" : "Upload your first statement to get started"}
                  </p>
                </div>
                {!globalFilter && (
                  <Button
                    onClick={() => navigate("/upload")}
                    variant="outline"
                    className="mt-2 rounded-md px-6 h-10 border-slate-200 text-slate-500 font-bold hover:bg-slate-50 transition-all shadow-2xs"
                  >
                    Upload statement
                  </Button>
                )}
              </div>
            )
          ) : (
            /* Grouped / Accordions View with low roundness */
            groupedData.length > 0 ? (
              groupedData.map((group) => (
                <StatementGroup
                  key={`${group.name}-${group.accNum}`}
                  name={group.name}
                  accNum={group.accNum}
                  items={group.items}
                />
              ))
            ) : (
              /* No statements grouped view empty state */
              <div className="py-16 sm:py-24 px-4 flex flex-col items-center justify-center bg-white rounded-lg border border-dashed border-slate-200 text-slate-300 gap-4">
                <div className="h-16 w-16 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center shadow-2xs">
                  <IconReceipt2 size={32} className="opacity-20 text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-base font-bold text-slate-700">No statements found</p>
                  <p className="text-xs font-semibold text-slate-400 mt-1 uppercase tracking-wider">
                    {globalFilter ? "Try a different search query" : "Upload your first statement to get started"}
                  </p>
                </div>
                {!globalFilter && (
                  <Button
                    onClick={() => navigate("/upload")}
                    variant="outline"
                    className="mt-2 rounded-md px-6 h-10 border-slate-200 text-slate-500 font-bold hover:bg-slate-50 transition-all shadow-2xs"
                  >
                    Upload statement
                  </Button>
                )}
              </div>
            )
          )}
        </div>

        <Dialog
          open={bulkOpen}
          onOpenChange={(open) => {
            setBulkOpen(open)
            if (open) selectAllIds()
          }}
        >
          <DialogContent
            showCloseButton
            className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[min(90vh,720px)] flex flex-col gap-0 p-0 overflow-hidden rounded-lg border border-slate-200 shadow-lg"
          >
            <div className="px-4 sm:px-6 pt-5 sm:pt-6 pb-4 border-b border-slate-100 shrink-0">
              <DialogHeader>
                <DialogTitle className="text-xl font-black tracking-tight text-slate-900 leading-none">
                  Delete statements
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500 font-medium mt-2">
                  Grouped by bank and account. Uncheck anything you want to keep, then confirm.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap items-center gap-2 mt-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-md h-8 text-[10px] font-bold uppercase tracking-wide cursor-pointer"
                  onClick={selectAllIds}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-md h-8 text-[10px] font-bold uppercase tracking-wide cursor-pointer"
                  onClick={clearSelection}
                >
                  Unselect all
                </Button>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-auto tabular-nums">
                  {selectedIds.size} of {statements.length} selected
                </span>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
              {groupedDataAll.length === 0 ? (
                <p className="text-xs text-slate-500 font-semibold text-center py-8">No statements to show.</p>
              ) : (
                groupedDataAll.map((group) => {
                  const gIds = group.items.map((i) => i._id)
                  const allInGroup = gIds.length > 0 && gIds.every((id) => selectedIds.has(id))
                  const someInGroup = gIds.some((id) => selectedIds.has(id))
                  return (
                    <div
                      key={`${group.name}-${group.accNum}`}
                      className="rounded-md border border-slate-200/80 bg-slate-50/20 overflow-hidden shadow-2xs"
                    >
                      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-100">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary shrink-0 cursor-pointer"
                          checked={allInGroup}
                          ref={(el) => {
                            if (el) el.indeterminate = someInGroup && !allInGroup
                          }}
                          onChange={() => toggleGroup(group.items)}
                          aria-label={`Select all in ${group.name}`}
                        />
                        <IconCreditCard size={16} className="text-slate-500 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-slate-900 truncate leading-tight">{group.name}</p>
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider truncate leading-none mt-1">
                            {group.accNum ? `Acc ${group.accNum}` : "Unspecified account"} · {group.items.length}{" "}
                            statement{group.items.length === 1 ? "" : "s"}
                          </p>
                        </div>
                      </div>
                      <ul className="divide-y divide-slate-100">
                        {group.items
                          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                          .map((st) => {
                            const cs = conciseStatus(st)
                            const primary =
                              st.type === "BANK" ? fmt(st.closingBalance?.val) : fmt(st.outstandingTotal?.val)
                            const period =
                              st.statementPeriod?.from && st.statementPeriod?.to
                                ? `${formatDate(st.statementPeriod.from)} — ${formatDate(st.statementPeriod.to)}`
                                : formatDate(st.createdAt)
                            return (
                              <li
                                key={st._id}
                                className="flex items-start gap-3 px-4 py-2.5 bg-white/40 hover:bg-white transition-colors"
                              >
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary mt-0.5 shrink-0 cursor-pointer"
                                  checked={selectedIds.has(st._id)}
                                  onChange={() => toggleId(st._id)}
                                  aria-label={`Select statement ${period}`}
                                />
                                <div className="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 items-center">
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-slate-800 truncate leading-tight">{period}</p>
                                    <p className="text-[9px] font-medium text-slate-500 leading-none mt-1">
                                      {st.type === "BANK" ? "Bank" : "Card"} ·{" "}
                                      {new Date(st.createdAt).toLocaleDateString("en-GB")}
                                    </p>
                                  </div>
                                  <div className="flex items-center justify-end gap-2 sm:flex-col sm:items-end sm:gap-1">
                                    <span
                                      className={cn(
                                        "text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border leading-none inline-block",
                                        cs.className
                                      )}
                                    >
                                      {cs.label}
                                    </span>
                                    <span className="text-xs font-bold text-slate-900 tabular-nums leading-none">{primary}</span>
                                  </div>
                                </div>
                              </li>
                            )
                          })}
                      </ul>
                    </div>
                  )
                })
              )}
            </div>

            <DialogFooter className="px-4 sm:px-6 py-4 border-t border-slate-100 bg-slate-50/50 shrink-0 gap-2 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-md font-bold text-xs h-9 cursor-pointer"
                onClick={() => setBulkOpen(false)}
                disabled={bulkDeleting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="rounded-md font-bold text-xs h-9 bg-red-600 hover:bg-red-700 text-white gap-2 cursor-pointer shadow-sm"
                disabled={selectedIds.size === 0 || bulkDeleting}
                onClick={runBulkDelete}
              >
                {bulkDeleting ? (
                  <>
                    <IconLoader2 size={14} className="animate-spin" /> Deleting…
                  </>
                ) : (
                  <>
                    <IconTrash size={14} /> Delete {selectedIds.size || ""}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
