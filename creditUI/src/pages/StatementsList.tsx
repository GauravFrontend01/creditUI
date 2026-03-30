import * as React from "react"
import { useNavigate } from "react-router-dom"
import api from "@/lib/api"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import type {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table"
import {
  IconArrowUp,
  IconArrowDown,
  IconArrowsUpDown,
  IconSearch,
  IconPlus,
  IconLoader2,
  IconTrash,
  IconChevronLeft,
  IconChevronRight,
  IconCreditCard,
  IconReceipt2,
  IconTrendingUp,
  IconAlertCircle,
  IconCheck,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

// ── Types ──────────────────────────────────────────────────────────────────
interface Statement {
  _id: string
  bankName: string
  createdAt: string
  creditLimit?: { val: number }
  availableLimit?: { val: number }
  outstandingTotal?: { val: number }
  minPaymentDue?: { val: number }
  transactions?: { _id: string; amount: number; type: string }[]
  currency?: string
  status?: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"
  isApproved?: boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────
const fmt = (val?: number) =>
  val !== undefined ? `₹${val.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"

const utilizationColor = (pct: number) => {
  if (pct >= 80) return "text-red-600 bg-red-50"
  if (pct >= 50) return "text-amber-600 bg-amber-50"
  return "text-emerald-600 bg-emerald-50"
}

// ── Sortable Header ────────────────────────────────────────────────────────
function SortHeader({ column, label }: { column: any; label: string }) {
  const sorted = column.getIsSorted()
  return (
    <button
      className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-700 transition-colors"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {label}
      {sorted === "asc" ? (
        <IconArrowUp size={12} className="text-primary" />
      ) : sorted === "desc" ? (
        <IconArrowDown size={12} className="text-primary" />
      ) : (
        <IconArrowsUpDown size={12} />
      )}
    </button>
  )
}

// ── Column Definitions ─────────────────────────────────────────────────────
const columns: ColumnDef<Statement>[] = [
  {
    accessorKey: "bankName",
    header: ({ column }) => <SortHeader column={column} label="Bank / Statement" />,
    cell: ({ row }) => (
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-primary/8 flex items-center justify-center text-primary shrink-0">
          <IconCreditCard size={18} />
        </div>
        <div>
          <p className="font-bold text-sm text-slate-900 leading-tight">{row.original.bankName}</p>
          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">
            {new Date(row.original.createdAt).toLocaleDateString("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>
      </div>
    ),
  },
  {
    id: "auditStatus",
    header: ({ column }) => <SortHeader column={column} label="Audit Status" />,
    cell: ({ row }) => {
      const status = row.original.status || "COMPLETED"
      const isApproved = row.original.isApproved

      if (status === "PENDING" || status === "PROCESSING") {
        return (
          <div className="flex items-center gap-2 text-amber-600 bg-amber-100/50 px-3 py-1 rounded-full w-fit border border-amber-200">
            <IconLoader2 size={12} className="animate-spin text-amber-600" />
            <span className="text-[9px] font-black uppercase tracking-wider">Brain Processing</span>
          </div>
        )
      }

      if (status === "FAILED") {
        return (
          <div className="flex items-center gap-2 text-red-600 bg-red-50 px-3 py-1 rounded-full w-fit border border-red-100">
            <IconAlertCircle size={12} />
            <span className="text-[9px] font-black uppercase tracking-wider">Failed</span>
          </div>
        )
      }

      if (!isApproved) {
        return (
          <div className="flex items-center gap-2 text-blue-600 bg-blue-50 px-3 py-1 rounded-full w-fit border border-blue-100">
            <IconAlertCircle size={12} className="opacity-70" />
            <span className="text-[9px] font-black uppercase tracking-wider">Draft Review</span>
          </div>
        )
      }

      return (
        <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full w-fit border border-emerald-100">
          <IconCheck size={12} strokeWidth={3} />
          <span className="text-[9px] font-black uppercase tracking-wider">Verified Audit</span>
        </div>
      )
    },
  },
  {
    accessorKey: "creditLimit.val",
    id: "creditLimit",
    header: ({ column }) => <SortHeader column={column} label="Credit Limit" />,
    cell: ({ row }) => (
      <p className="font-bold text-sm text-slate-900 tabular-nums">
        {fmt(row.original.creditLimit?.val)}
      </p>
    ),
    sortingFn: (a, b) =>
      (a.original.creditLimit?.val ?? 0) - (b.original.creditLimit?.val ?? 0),
  },
  {
    id: "utilization",
    header: ({ column }) => <SortHeader column={column} label="Utilization" />,
    cell: ({ row }) => {
      const limit = row.original.creditLimit?.val ?? 0
      const outstanding = row.original.outstandingTotal?.val ?? 0
      const pct = limit > 0 ? Math.round((outstanding / limit) * 100) : 0
      return (
        <div className="flex items-center gap-3 min-w-[120px]">
          <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                pct >= 80 ? "bg-red-500" : pct >= 50 ? "bg-amber-500" : "bg-emerald-500"
              )}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full tabular-nums", utilizationColor(pct))}>
            {pct}%
          </span>
        </div>
      )
    },
    sortingFn: (a, b) => {
      const pctA = ((a.original.outstandingTotal?.val ?? 0) / (a.original.creditLimit?.val ?? 1)) * 100
      const pctB = ((b.original.outstandingTotal?.val ?? 0) / (b.original.creditLimit?.val ?? 1)) * 100
      return pctA - pctB
    },
  },
  {
    accessorKey: "outstandingTotal.val",
    id: "outstandingTotal",
    header: ({ column }) => <SortHeader column={column} label="Outstanding" />,
    cell: ({ row }) => (
      <p className="font-bold text-sm text-slate-900 tabular-nums">
        {fmt(row.original.outstandingTotal?.val)}
      </p>
    ),
    sortingFn: (a, b) =>
      (a.original.outstandingTotal?.val ?? 0) - (b.original.outstandingTotal?.val ?? 0),
  },
  {
    accessorKey: "minPaymentDue.val",
    id: "minPaymentDue",
    header: ({ column }) => <SortHeader column={column} label="Min Due" />,
    cell: ({ row }) => (
      <p className="font-semibold text-sm text-amber-600 tabular-nums">
        {fmt(row.original.minPaymentDue?.val)}
      </p>
    ),
    sortingFn: (a, b) =>
      (a.original.minPaymentDue?.val ?? 0) - (b.original.minPaymentDue?.val ?? 0),
  },
  {
    id: "txCount",
    header: ({ column }) => <SortHeader column={column} label="Transactions" />,
    cell: ({ row }) => {
      const txs = row.original.transactions ?? []
      const debits = txs.filter((t) => t.type === "Debit").length
      const credits = txs.filter((t) => t.type === "Credit").length
      return (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-xs font-bold text-slate-700">
            <IconReceipt2 size={14} className="text-slate-400" />
            {txs.length}
          </span>
          {txs.length > 0 && (
            <span className="text-[10px] text-slate-400 font-semibold">
              {debits}D · {credits}C
            </span>
          )}
        </div>
      )
    },
    sortingFn: (a, b) =>
      (a.original.transactions?.length ?? 0) - (b.original.transactions?.length ?? 0),
  },
  {
    id: "actions",
    header: () => null,
    cell: ({ row }) => {
      const id = row.original._id
      const name = row.original.bankName
      return (
        <div className="flex justify-end pr-2" onClick={(e) => e.stopPropagation()}>
          <DeleteButton statementId={id} bankName={name} />
        </div>
      )
    },
    enableSorting: false,
  },
]

// ── Delete Button ──────────────────────────────────────────────────────────
function DeleteButton({ statementId, bankName }: { statementId: string; bankName: string }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={(e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('request-delete', { detail: { id: statementId, name: bankName } }));
      }}
      className="h-8 gap-1.5 text-xs font-bold text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg px-3 transition-colors"
    >
      <IconTrash size={14} />
      Delete
    </Button>
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
    <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3 shadow-sm">
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
export default function StatementsList() {
  const [statements, setStatements] = React.useState<Statement[]>([])
  const [loading, setLoading] = React.useState(true)
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "createdAt", desc: true },
  ])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [globalFilter, setGlobalFilter] = React.useState("")
  const [deleteDialog, setDeleteDialog] = React.useState<{id: string, name: string} | null>(null)
  const navigate = useNavigate()

  React.useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const fetch_ = async () => {
      try {
        const res = await api.get("/api/statements");
        setStatements(res.data);

        // Check for active background jobs
        const hasActiveJobs = res.data.some((s: Statement) => 
          s.status === "PENDING" || s.status === "PROCESSING"
        );

        if (hasActiveJobs) {
          // Poll every 4 seconds
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

  // Remove deleted row from state instantly without refetch
  React.useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent).detail
      setStatements((prev) => prev.filter((s) => s._id !== id))
    }
    window.addEventListener('statement-deleted', handler)
    
    const deleteHandler = (e: Event) => {
      setDeleteDialog((e as CustomEvent).detail)
    }
    window.addEventListener('request-delete', deleteHandler)
    
    return () => {
      window.removeEventListener('statement-deleted', handler)
      window.removeEventListener('request-delete', deleteHandler)
    }
  }, [])

  const table = useReactTable({
    data: statements,
    columns,
    state: { sorting, columnFilters, columnVisibility, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  })

  // ── Aggregate stats ──
  const totalOutstanding = statements.reduce((s, st) => s + (st.outstandingTotal?.val ?? 0), 0)
  const totalCreditLimit = statements.reduce((s, st) => s + (st.creditLimit?.val ?? 0), 0)
  const totalMinDue = statements.reduce((s, st) => s + (st.minPaymentDue?.val ?? 0), 0)
  const avgUtil = totalCreditLimit > 0 ? Math.round((totalOutstanding / totalCreditLimit) * 100) : 0

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 gap-4">
        <IconLoader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Loading Statements...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans">
      <div className="max-w-[1200px] mx-auto px-8 py-10 space-y-8">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">My Statements</h1>
            <p className="text-sm text-slate-500 mt-1 font-medium">
              {statements.length} audited statement{statements.length !== 1 ? "s" : ""} on record
            </p>
          </div>
          <Button
            onClick={() => navigate("/")}
            className="rounded-xl px-6 h-11 gap-2 shadow-sm font-bold text-sm"
          >
            <IconPlus size={16} /> New Analysis
          </Button>
        </div>

        {/* ── Summary Cards ── */}
        {statements.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={IconCreditCard}
              label="Total Credit Limit"
              value={fmt(totalCreditLimit)}
              sub={`Across ${statements.length} cards`}
              color="bg-blue-50 text-blue-600"
            />
            <StatCard
              icon={IconAlertCircle}
              label="Total Outstanding"
              value={fmt(totalOutstanding)}
              sub="Combined balance"
              color="bg-red-50 text-red-500"
            />
            <StatCard
              icon={IconTrendingUp}
              label="Avg Utilization"
              value={`${avgUtil}%`}
              sub={avgUtil >= 80 ? "⚠ High utilization" : "Healthy range"}
              color={avgUtil >= 80 ? "bg-red-50 text-red-500" : "bg-emerald-50 text-emerald-600"}
            />
            <StatCard
              icon={IconReceipt2}
              label="Total Min Due"
              value={fmt(totalMinDue)}
              sub="This month"
              color="bg-amber-50 text-amber-600"
            />
          </div>
        )}

        {/* ── Table Card ── */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">

          {/* Toolbar */}
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <IconSearch
                size={15}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Search statements..."
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="w-full h-9 pl-9 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all"
              />
            </div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest shrink-0">
              {table.getFilteredRowModel().rows.length} results
            </p>
          </div>

          {/* Table */}
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="bg-slate-50/80 hover:bg-slate-50/80 border-b border-slate-100">
                  {hg.headers.map((h) => (
                    <TableHead
                      key={h.id}
                      className="px-6 py-3 first:pl-6 last:pr-6"
                    >
                      {h.isPlaceholder
                        ? null
                        : flexRender(h.column.columnDef.header, h.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>

            <TableBody>
              {table.getRowModel().rows.length > 0 ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer border-b border-slate-50 hover:bg-slate-50/70 transition-colors group"
                    onClick={() => navigate(`/statements/${row.original._id}`)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="px-6 py-4 first:pl-6 last:pr-6">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-48 text-center">
                    <div className="flex flex-col items-center gap-3 text-slate-300">
                      <IconCreditCard size={40} />
                      <div>
                        <p className="font-bold text-sm text-slate-500">No statements found</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {globalFilter ? "Try a different search term" : "Start by analysing a bank statement"}
                        </p>
                      </div>
                      {!globalFilter && (
                        <Button size="sm" variant="outline" className="mt-2 rounded-lg font-bold text-xs" onClick={() => navigate("/")}>
                          Start Analysis
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {table.getPageCount() > 1 && (
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">
                Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0 rounded-lg border-slate-200"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                >
                  <IconChevronLeft size={14} />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0 rounded-lg border-slate-200"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                >
                  <IconChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Custom Delete Confirmation Modal */}
        {deleteDialog && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setDeleteDialog(null)} />
            <div className="relative w-full max-w-md bg-white rounded-[2rem] p-8 shadow-2xl border border-slate-100 flex flex-col items-center text-center space-y-6 animate-in zoom-in-95 duration-200">
              <div className="w-16 h-16 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center">
                <IconTrash size={32} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-slate-900">Delete Statement?</h3>
                <p className="text-sm text-slate-500 leading-relaxed px-4">
                  Are you sure you want to delete <span className="font-bold text-slate-700">"{deleteDialog.name}"</span>? 
                  This action is permanent and will remove all audit data.
                </p>
              </div>
              <div className="flex gap-3 w-full">
                <Button 
                  variant="outline" 
                  className="flex-1 h-12 rounded-xl font-bold text-slate-500 border-slate-200" 
                  onClick={() => setDeleteDialog(null)}
                >
                  Cancel
                </Button>
                <Button 
                  className="flex-1 h-12 rounded-xl font-bold bg-red-500 hover:bg-red-600 border-0" 
                  onClick={async () => {
                    const id = deleteDialog.id;
                    setDeleteDialog(null);
                    try {
                      await api.delete(`/api/statements/${id}`);
                      window.dispatchEvent(new CustomEvent('statement-deleted', { detail: id }));
                    } catch (err) {
                      console.error("Delete failed from modal", err);
                    }
                  }}
                >
                  Delete Now
                </Button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
