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
    return { label: "Extracting", className: "bg-amber-50 text-amber-700 border-amber-100" }
  if (status === "FAILED")
    return { label: "Failed", className: "bg-red-50 text-red-700 border-red-100" }
  if (st.isApproved)
    return { label: "Verified", className: "bg-emerald-50 text-emerald-700 border-emerald-100" }
  return { label: "Review", className: "bg-blue-50 text-blue-700 border-blue-100" }
}

export default function StatementsList() {
  const [globalFilter, setGlobalFilter] = React.useState("")
  const navigate = useNavigate()

  const [bulkOpen, setBulkOpen] = React.useState(false)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = React.useState(false)

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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 gap-4">
        <IconLoader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Loading statements…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans">
      <div className="max-w-[1600px] mx-auto px-8 py-10 space-y-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-slate-900">My Statements</h1>
            <p className="text-sm text-slate-500 mt-1 font-medium italic">
              {statements.length} forensic statement audit{statements.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative group">
              <IconSearch
                size={18}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors"
              />
              <input
                type="text"
                placeholder="Search by bank, account, period…"
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="h-12 w-80 pl-11 pr-4 bg-white border border-slate-200 rounded-2xl shadow-sm text-sm font-bold placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-primary/5 focus:border-primary/30 transition-all"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={statements.length === 0}
              onClick={() => {
                selectAllIds()
                setBulkOpen(true)
              }}
              className="rounded-2xl px-5 h-12 gap-2 border-slate-200 font-black text-sm uppercase tracking-wider text-slate-700 hover:bg-red-50 hover:border-red-200 hover:text-red-700"
            >
              <IconTrash size={18} strokeWidth={2} /> Bulk delete
            </Button>
            <Button
              onClick={() => navigate("/upload")}
              className="rounded-2xl px-6 h-12 gap-2 shadow-lg shadow-primary/20 font-black text-sm uppercase tracking-wider"
            >
              <IconPlus size={18} strokeWidth={3} /> New Audit
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          {groupedData.length > 0 ? (
            groupedData.map((group) => (
              <StatementGroup
                key={`${group.name}-${group.accNum}`}
                name={group.name}
                accNum={group.accNum}
                items={group.items}
              />
            ))
          ) : (
            <div className="py-32 flex flex-col items-center justify-center bg-white rounded-[3rem] border border-dashed border-slate-200 text-slate-300 gap-4">
              <div className="h-20 w-20 rounded-3xl bg-slate-50 flex items-center justify-center">
                <IconReceipt2 size={40} className="opacity-20" />
              </div>
              <div className="text-center">
                <p className="text-lg font-black text-slate-400">No statements found</p>
                <p className="text-sm font-bold text-slate-300 mt-1 uppercase tracking-widest">
                  {globalFilter ? "Try a different search" : "Upload your first statement"}
                </p>
              </div>
              {!globalFilter && (
                <Button
                  onClick={() => navigate("/upload")}
                  variant="outline"
                  className="mt-4 rounded-xl px-8 h-12 border-slate-200 text-slate-500 font-bold hover:bg-slate-50 transition-all"
                >
                  Upload statement
                </Button>
              )}
            </div>
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
            className="sm:max-w-2xl max-h-[min(90vh,720px)] flex flex-col gap-0 p-0 overflow-hidden rounded-[1.5rem]"
          >
            <div className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
              <DialogHeader>
                <DialogTitle className="text-xl font-black tracking-tight text-slate-900">
                  Delete statements
                </DialogTitle>
                <DialogDescription className="text-sm text-slate-500 font-medium">
                  Grouped by bank and account. Uncheck anything you want to keep, then confirm.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap items-center gap-2 mt-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-lg h-9 text-[11px] font-bold uppercase tracking-wide"
                  onClick={selectAllIds}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-lg h-9 text-[11px] font-bold uppercase tracking-wide"
                  onClick={clearSelection}
                >
                  Unselect all
                </Button>
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-auto tabular-nums">
                  {selectedIds.size} of {statements.length} selected
                </span>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-5">
              {groupedDataAll.length === 0 ? (
                <p className="text-sm text-slate-500 font-medium text-center py-8">No statements to show.</p>
              ) : (
                groupedDataAll.map((group) => {
                  const gIds = group.items.map((i) => i._id)
                  const allInGroup = gIds.length > 0 && gIds.every((id) => selectedIds.has(id))
                  const someInGroup = gIds.some((id) => selectedIds.has(id))
                  return (
                    <div
                      key={`${group.name}-${group.accNum}`}
                      className="rounded-2xl border border-slate-100 bg-slate-50/40 overflow-hidden"
                    >
                      <div className="flex items-center gap-3 px-4 py-3 bg-white/80 border-b border-slate-100/80">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary shrink-0"
                          checked={allInGroup}
                          ref={(el) => {
                            if (el) el.indeterminate = someInGroup && !allInGroup
                          }}
                          onChange={() => toggleGroup(group.items)}
                          aria-label={`Select all in ${group.name}`}
                        />
                        <IconCreditCard size={18} className="text-primary shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-black text-slate-900 truncate">{group.name}</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">
                            {group.accNum ? `Acc ${group.accNum}` : "Unspecified account"} · {group.items.length}{" "}
                            statement{group.items.length === 1 ? "" : "s"}
                          </p>
                        </div>
                      </div>
                      <ul className="divide-y divide-slate-100/80">
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
                                className="flex items-start gap-3 px-4 py-2.5 bg-white/50 hover:bg-white/90 transition-colors"
                              >
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary mt-0.5 shrink-0"
                                  checked={selectedIds.has(st._id)}
                                  onChange={() => toggleId(st._id)}
                                  aria-label={`Select statement ${period}`}
                                />
                                <div className="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 items-center">
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold text-slate-800 truncate">{period}</p>
                                    <p className="text-[10px] font-semibold text-slate-400 tabular-nums">
                                      {st.type === "BANK" ? "Bank" : "Card"} ·{" "}
                                      {new Date(st.createdAt).toLocaleDateString("en-GB")}
                                    </p>
                                  </div>
                                  <div className="flex items-center justify-end gap-2 sm:flex-col sm:items-end sm:gap-1">
                                    <span
                                      className={cn(
                                        "text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border",
                                        cs.className
                                      )}
                                    >
                                      {cs.label}
                                    </span>
                                    <span className="text-xs font-black text-slate-900 tabular-nums">{primary}</span>
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

            <DialogFooter className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 shrink-0 gap-2 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl font-bold"
                onClick={() => setBulkOpen(false)}
                disabled={bulkDeleting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="rounded-xl font-bold bg-red-600 hover:bg-red-700 text-white gap-2"
                disabled={selectedIds.size === 0 || bulkDeleting}
                onClick={runBulkDelete}
              >
                {bulkDeleting ? (
                  <>
                    <IconLoader2 size={16} className="animate-spin" /> Deleting…
                  </>
                ) : (
                  <>
                    <IconTrash size={16} /> Delete {selectedIds.size || ""}
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
