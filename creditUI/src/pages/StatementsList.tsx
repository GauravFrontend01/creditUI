import * as React from "react"
import { useNavigate } from "react-router-dom"
import api from "@/lib/api"
import {
  IconSearch,
  IconPlus,
  IconLoader2,
  IconTrash,
  IconCreditCard,
  IconReceipt2,
  IconTrendingUp,
  IconAlertCircle,
  IconCheck,
  IconChevronDown,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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
  transactions?: { _id: string; amount: number; type: string }[]
  currency?: string
  status?: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"
  isApproved?: boolean
  type?: "CREDIT_CARD" | "BANK"
  closingBalance?: { val: number }
  totalDeposits?: { val: number }
  totalWithdrawals?: { val: number }
}

// ── Helpers ────────────────────────────────────────────────────────────────
const fmt = (val?: number) =>
  val !== undefined ? `₹${val.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"

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
              <div className="col-span-2 text-right pr-4">Action</div>
            </div>

            {items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(st => {
              const status = st.status || "COMPLETED"
              return (
                <div 
                  key={st._id}
                  onClick={() => navigate(`/statements/${st._id}`)}
                  className="grid grid-cols-12 items-center px-6 py-4 rounded-2xl bg-slate-50/30 hover:bg-white hover:shadow-md border border-transparent hover:border-slate-100 transition-all cursor-pointer group"
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
                           <span className="text-emerald-600">+{st.totalDeposits?.val?.toLocaleString() || '0'}</span>
                           <span className="text-red-400 text-[10px]">-{st.totalWithdrawals?.val?.toLocaleString() || '0'}</span>
                        </div>
                      )
                      : fmt(st.minPaymentDue?.val)}
                  </div>

                  <div className="col-span-2 flex justify-center">
                    {status === "PROCESSING" ? (
                      <div className="flex items-center gap-1.5 text-amber-500 font-bold text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 border border-amber-100/50">
                        <IconLoader2 size={10} className="animate-spin" />
                        Linking
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

                  <div className="col-span-2 flex justify-end pr-2" onClick={e => e.stopPropagation()}>
                    <DeleteButton statementId={st._id} bankName={st.bankName.val} />
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
export default function StatementsList() {
  const [statements, setStatements] = React.useState<Statement[]>([])
  const [loading, setLoading] = React.useState(true)
  const [globalFilter, setGlobalFilter] = React.useState("")
  const [deleteDialog, setDeleteDialog] = React.useState<{id: string, name: string} | null>(null)
  const navigate = useNavigate()

  React.useEffect(() => {
    let timeoutId: NodeJS.Timeout;

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

  const groupedData = React.useMemo(() => {
    const groups: Record<string, { name: string; accNum: string; items: Statement[] }> = {}
    
    statements.forEach(s => {
      if (globalFilter) {
        const q = globalFilter.toLowerCase()
        const bankMatch = s.bankName.val.toLowerCase().includes(q)
        const accMatch = (s.accountNumber?.val || "").toLowerCase().includes(q)
        const periodMatch = `${s.statementPeriod?.from || ""} ${s.statementPeriod?.to || ""}`.toLowerCase().includes(q)
        if (!bankMatch && !accMatch && !periodMatch) return
      }

      const bankKey = s.bankName.val || "Unknown Bank"
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

        {deleteDialog && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setDeleteDialog(null)} />
            <div className="relative w-full max-w-md bg-white rounded-[2rem] p-8 shadow-2xl border border-slate-100 flex flex-col items-center text-center space-y-6 animate-in zoom-in-95 duration-200">
              <div className="w-16 h-16 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center">
                <IconTrash size={32} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-slate-900">Delete Audit?</h3>
                <p className="text-sm text-slate-500 leading-relaxed px-4">
                  Confirm deletion of <span className="font-bold text-slate-700">"{deleteDialog.name}"</span> audit record? 
                  This forensic evidence will be unrecoverable.
                </p>
              </div>
              <div className="flex gap-3 w-full">
                <Button variant="outline" className="flex-1 h-12 rounded-xl font-bold text-slate-500 border-slate-200" onClick={() => setDeleteDialog(null)}>Cancel</Button>
                <Button 
                  className="flex-1 h-12 rounded-xl font-bold bg-red-500 hover:bg-red-600 border-0" 
                  onClick={async () => {
                    const id = deleteDialog.id;
                    setDeleteDialog(null);
                    try {
                      await api.delete(`/api/statements/${id}`);
                      window.dispatchEvent(new CustomEvent('statement-deleted', { detail: id }));
                    } catch (err) {
                      console.error("Delete failed", err);
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
