import React, { useState, useEffect, useRef } from "react"
import { useNavigate, useParams } from "react-router-dom"
import api from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  IconDownload, IconArrowLeft, IconFileOff, IconLoader2,
  IconReceipt2, IconChartBar, IconCreditCard, IconCalendar,
  IconTrendingDown, IconTrendingUp, IconGift,
  IconArrowUp, IconArrowDown, IconArrowsUpDown, IconAlertTriangle, IconCheck
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"

import {
  flexRender, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, getPaginationRowModel, useReactTable,
} from "@tanstack/react-table"
import type { ColumnDef, SortingState } from "@tanstack/react-table"

import * as pdfjsLib from "pdfjs-dist"
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url"
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

// ── Types ──────────────────────────────────────────────────────────────────
interface Transaction {
  _id: string
  date: string
  description: string
  merchantName: string
  amount: number
  type: "Debit" | "Credit"
  category: string
  categoryConfidence?: number
  isRecurring: boolean
  isForex: boolean
  box: number[]
  page: number
}

interface EmiItem {
  name: string
  amount: number
  box: number[]
  page: number
}

interface StatVal { val?: number; box?: number[]; page?: number }
interface StatStr { val?: string; box?: number[]; page?: number }

interface StatementData {
  _id: string
  bankName: string
  currency: string
  creditLimit?: StatVal
  availableLimit?: StatVal
  outstandingTotal?: StatVal
  minPaymentDue?: StatVal
  paymentDueDate?: StatStr
  statementDate?: StatStr
  statementPeriod?: { from?: string; to?: string }
  previousBalance?: StatVal
  lastPaymentAmount?: StatVal
  lastPaymentDate?: StatStr
  totalDebits?: StatVal
  totalCredits?: StatVal
  totalInterestCharged?: StatVal
  totalLateFee?: StatVal
  totalFees?: StatVal
  rewardPointsEarned?: StatVal
  rewardPointsRedeemed?: StatVal
  rewardPointsBalance?: StatVal
  transactions: Transaction[]
  emiList: EmiItem[]
  summary?: string
  pdfStorageUrl?: string
  pdfPassword?: string
  status?: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"
  isApproved?: boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────
const getCurrencySymbol = (code?: string) => {
  switch (code?.toUpperCase()) {
    case 'INR': return '₹'; case 'USD': return '$';
    case 'GBP': return '£'; case 'EUR': return '€';
    default: return code || '₹';
  }
}

const fmt = (val?: number, sym = '₹') =>
  val != null ? `${sym}${val.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'

const CATEGORY_COLORS: Record<string, string> = {
  Food:          'bg-orange-50 text-orange-600',
  Shopping:      'bg-purple-50 text-purple-600',
  Entertainment: 'bg-pink-50 text-pink-600',
  Travel:        'bg-blue-50 text-blue-600',
  EMI:           'bg-indigo-50 text-indigo-600',
  Fee:           'bg-slate-100 text-slate-500',
  Cashback:      'bg-emerald-50 text-emerald-600',
  Utilities:     'bg-cyan-50 text-cyan-600',
  Healthcare:    'bg-red-50 text-red-500',
  Fuel:          'bg-yellow-50 text-yellow-600',
  Subscription:  'bg-violet-50 text-violet-600',
  Forex:         'bg-teal-50 text-teal-600',
  Other:         'bg-slate-50 text-slate-400',
}

function SortHeader({ column, label }: { column: any; label: string }) {
  const sorted = column.getIsSorted()
  return (
    <button
      className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-700 transition-colors"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {label}
      {sorted === "asc" ? <IconArrowUp size={11} className="text-primary" />
        : sorted === "desc" ? <IconArrowDown size={11} className="text-primary" />
        : <IconArrowsUpDown size={11} />}
    </button>
  )
}

// ── Transaction Table Columns ──────────────────────────────────────────────
function buildColumns(
  sym: string,
  onRowClick: (tx: Transaction) => void,
  onCategoryUpdate: (tx: Transaction, newCat: string) => void
): ColumnDef<Transaction>[] {
  return [
    {
      accessorKey: 'date',
      header: ({ column }) => <SortHeader column={column} label="Date" />,
      cell: ({ row }) => (
        <span className="text-[11px] font-semibold text-slate-400 tabular-nums">
          {row.original.date}
        </span>
      ),
    },
    {
      accessorKey: 'description',
      header: ({ column }) => <SortHeader column={column} label="Description" />,
      cell: ({ row }) => {
        const tx = row.original
        return (
          <div>
            <p className="font-bold text-[13px] text-slate-800 truncate max-w-[260px]">
              {tx.merchantName || tx.description}
            </p>
            <p className="text-[10px] text-slate-400 truncate max-w-[260px]">{tx.description}</p>
          </div>
        )
      },
    },
    {
      accessorKey: 'category',
      header: ({ column }) => <SortHeader column={column} label="Category" />,
      cell: ({ row }) => {
        const cat = row.original.category || 'Other'
        const conf = row.original.categoryConfidence ?? 100
        return (
          <div className="relative group flex items-center w-max">
            <span className={cn(
              'text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 group-hover:ring-2 ring-slate-200 transition-all cursor-pointer',
              CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.Other
            )}>
              {cat}
              {conf < 80 && (
                <IconAlertTriangle size={10} className="text-amber-500 opacity-80" />
              )}
            </span>
            <select
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              value={cat}
              onChange={(e) => onCategoryUpdate(row.original, e.target.value)}
              onClick={(e) => e.stopPropagation()}
              title="Change category"
            >
              {Object.keys(CATEGORY_COLORS).map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
        )
      },
    },
    {
      accessorKey: 'type',
      header: ({ column }) => <SortHeader column={column} label="Type" />,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          {row.original.type === 'Debit'
            ? <IconTrendingDown size={13} className="text-red-400" />
            : <IconTrendingUp size={13} className="text-emerald-500" />}
          <span className={cn(
            'text-[10px] font-bold',
            row.original.type === 'Debit' ? 'text-red-500' : 'text-emerald-600'
          )}>
            {row.original.type}
          </span>
        </div>
      ),
    },
    {
      accessorKey: 'amount',
      header: ({ column }) => <SortHeader column={column} label="Amount" />,
      cell: ({ row }) => {
        const tx = row.original
        return (
          <span className={cn(
            'font-bold tabular-nums text-sm',
            tx.type === 'Debit' ? 'text-slate-900' : 'text-emerald-600'
          )}>
            {tx.type === 'Debit' ? '-' : '+'}{fmt(tx.amount, sym)}
          </span>
        )
      },
      sortingFn: (a, b) => a.original.amount - b.original.amount,
    },
    {
      id: 'flags',
      header: () => null,
      cell: ({ row }) => (
        <div className="flex gap-1">
          {row.original.isRecurring && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-500">
              RECURRING
            </span>
          )}
          {row.original.isForex && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-teal-50 text-teal-500">
              FOREX
            </span>
          )}
        </div>
      ),
      enableSorting: false,
    },
    {
      id: 'locate',
      header: () => null,
      cell: ({ row }) => (
        row.original.box?.length > 0 ? (
          <button
            onClick={(e) => { e.stopPropagation(); onRowClick(row.original) }}
            className="text-[9px] font-bold px-2 py-1 rounded border border-slate-200 text-slate-400 hover:border-primary hover:text-primary transition-all"
          >
            P{row.original.page}
          </button>
        ) : null
      ),
      enableSorting: false,
    },
  ]
}

// ── Stat Card ──────────────────────────────────────────────────────────────
function MetricCard({
  label, value, sub, color = 'text-slate-900', small = false
}: {
  label: string; value: string; sub?: string; color?: string; small?: boolean
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
      <p className={cn('font-bold tabular-nums', small ? 'text-sm' : 'text-base', color)}>{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  )
}

// ── Tab Button ─────────────────────────────────────────────────────────────
function TabBtn({
  active, onClick, icon: Icon, label, count
}: {
  active: boolean; onClick: () => void; icon: any; label: string; count?: number
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-lg transition-all',
        active
          ? 'bg-primary text-white shadow-sm'
          : 'text-slate-500 hover:bg-slate-100'
      )}
    >
      <Icon size={14} />
      {label}
      {count != null && (
        <span className={cn(
          'text-[10px] font-bold px-1.5 rounded-full',
          active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
        )}>
          {count}
        </span>
      )}
    </button>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function Statement() {
  const [data, setData] = useState<StatementData | null>(null)
  const [pages, setPages] = useState<string[]>([])
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [activeBox, setActiveBox] = useState<{ box: number[]; page: number; id: string } | null>(null)
  const [linePath, setLinePath] = useState("")
  const [isSavedView, setIsSavedView] = useState(false)
  const [tab, setTab] = useState<'transactions' | 'emi' | 'overview'>('transactions')
  const [txSorting, setTxSorting] = useState<SortingState>([])
  const [txGlobalFilter, setTxGlobalFilter] = useState("")
  const [activeFooterFilter, setActiveFooterFilter] = useState<'debit' | 'credit' | 'fees' | null>(null)
  const [toast, setToast] = useState<{message: string, visible: boolean, type: 'success' | 'error'}>({ message: "", visible: false, type: 'success' })

  const { id } = useParams()
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)
  const pdfPaneRef = useRef<HTMLDivElement>(null)
  const tablePaneRef = useRef<HTMLDivElement>(null)

  // ── Fetch data ────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      if (id) {
        setIsSavedView(true)
        try {
          const { data } = await api.get(`/api/statements/${id}`)
          setData(data)
          if (data.pdfStorageUrl) loadPdfFromUrl(data.pdfStorageUrl, data.pdfPassword)
        } catch (e: any) {
          if (e.response?.status === 401) navigate('/login')
          else navigate('/statements')
        }
      } else {
        const raw = sessionStorage.getItem('extraction_result')
        const b64 = sessionStorage.getItem('pdf_base64')
        const pass = sessionStorage.getItem('pdf_password')
        const name = sessionStorage.getItem('pdf_raw_name')
        if (raw && b64) {
          const parsed = JSON.parse(raw)
          setData({ ...parsed, _id: '', bankName: parsed.bankName || name || 'Statement', transactions: parsed.transactions || [], emiList: parsed.emiList || [] })
          loadPdfFromBase64(b64, pass || '')
        } else navigate('/')
      }
    }
    load()
  }, [id])

  // ── PDF loaders ───────────────────────────────────────────────────────────
  const renderPdfBuffer = async (buf: ArrayBuffer, pass?: string) => {
    setLoadingPdf(true)
    try {
      const pdf = await pdfjsLib.getDocument({ data: buf, password: pass || '' }).promise
      const imgs: string[] = []
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const vp = page.getViewport({ scale: 1.5 })
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')!
        canvas.width = vp.width; canvas.height = vp.height
        await page.render({ canvasContext: ctx, viewport: vp } as any).promise
        imgs.push(canvas.toDataURL())
      }
      setPages(imgs)
    } catch (e) { console.error('PDF render error', e) }
    finally { setLoadingPdf(false) }
  }

  const loadPdfFromUrl = async (url: string, pass?: string) => {
    try {
      const buf = await (await fetch(url)).arrayBuffer()
      await renderPdfBuffer(buf, pass)
    } catch (e) { console.error('PDF URL fetch error', e); setLoadingPdf(false) }
  }

  const loadPdfFromBase64 = async (b64: string, pass?: string) => {
    try {
      const raw = atob(b64.split(',')[1])
      const bytes = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
      await renderPdfBuffer(bytes.buffer, pass)
    } catch (e) { console.error('PDF b64 decode error', e); setLoadingPdf(false) }
  }

  // ── Connector line ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeBox || loadingPdf) { setLinePath(''); return }
    const update = () => {
      const rowEl = document.getElementById(`tx-row-${activeBox.id}`)
      const hlEl = document.getElementById('pdf-highlight')
      const root = rootRef.current
      if (rowEl && hlEl && root) {
        const rr = rootRef.current!.getBoundingClientRect()
        const row = rowEl.getBoundingClientRect()
        const hl = hlEl.getBoundingClientRect()
        const sx = row.left - rr.left, sy = row.top - rr.top + row.height / 2
        const ex = hl.right - rr.left, ey = hl.top - rr.top + hl.height / 2
        const mx = (sx + ex) / 2
        setLinePath(`M ${sx} ${sy} L ${mx + 20} ${sy} L ${mx - 20} ${ey} L ${ex} ${ey}`)
      } else setLinePath('')
    }
    update()
    const pdf = pdfPaneRef.current, tbl = tablePaneRef.current
    pdf?.addEventListener('scroll', update, { passive: true })
    tbl?.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      pdf?.removeEventListener('scroll', update)
      tbl?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [activeBox, loadingPdf, pages])

  // ── Save handler ──────────────────────────────────────────────────────────
  const confirmApproval = async () => {
    if (!id) return
    try {
      await api.put(`/api/statements/${id}/approve`)
      setData(prev => prev ? { ...prev, isApproved: true } : null)
      setToast({ message: 'Forensic Audit Approved', visible: true, type: 'success' })
      setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 4000)
    } catch (e: any) {
      setToast({ message: 'Approval failed: ' + (e.message || "Unknown error"), visible: true, type: 'error' })
      setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 4000)
    }
  }

  // ── TanStack table ────────────────────────────────────────────────────────
  const handleTxRowClick = (tx: Transaction) => {
    if (tx.box?.length && tx.page) {
      setActiveBox({ box: tx.box, page: tx.page, id: tx._id || tx.description })
      document.getElementById(`pdf-page-${tx.page}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }
  const handleCategoryUpdate = async (tx: Transaction, newCat: string) => {
    // Optimistic UI update
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        transactions: prev.transactions.map(t =>
          (t._id && t._id === tx._id) || (!t._id && t.description === tx.description)
            ? { ...t, category: newCat, categoryConfidence: 100 }
            : t
        )
      };
    });

    try {
      if (tx.merchantName) {
        await api.post('/api/vendor-rules', {
          merchantName: tx.merchantName,
          category: newCat
        });
      }
    } catch (e) {
      console.error("Failed to save vendor rule:", e);
    }
  };

  const txColumns = buildColumns(data?.currency ? getCurrencySymbol(data.currency) : '₹', handleTxRowClick, handleCategoryUpdate)

  const table = useReactTable({
    data: data?.transactions ?? [],
    columns: txColumns,
    state: { sorting: txSorting, globalFilter: txGlobalFilter },
    onSortingChange: setTxSorting,
    onGlobalFilterChange: setTxGlobalFilter,
    globalFilterFn: (row, _colId, filterValue: string) => {
      if (filterValue === '__DEBIT__') return row.original.type === 'Debit'
      if (filterValue === '__CREDIT__') return row.original.type === 'Credit'
      if (filterValue === '__FEES__') return row.original.category === 'Fee'
      // Normal text search
      const q = filterValue.toLowerCase()
      const tx = row.original
      return (
        tx.description?.toLowerCase().includes(q) ||
        tx.merchantName?.toLowerCase().includes(q) ||
        tx.category?.toLowerCase().includes(q) ||
        tx.date?.toLowerCase().includes(q) ||
        String(tx.amount).includes(q)
      )
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 100 } },
  })

  // ── Keyboard Navigation for Transactions Table ──────────────
  useEffect(() => {
    if (tab !== 'transactions') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Allow default behavior if they are typing in an input
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') {
        return;
      }

      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

      const rows = table.getRowModel().rows;
      if (!rows.length) return;

      e.preventDefault();

      let nextIndex = 0;
      if (activeBox) {
        const currentIndex = rows.findIndex(r => (r.original._id || r.original.description) === activeBox.id);
        
        if (currentIndex !== -1) {
          if (e.key === 'ArrowDown') {
            nextIndex = currentIndex < rows.length - 1 ? currentIndex + 1 : 0;
          } else if (e.key === 'ArrowUp') {
            nextIndex = currentIndex > 0 ? currentIndex - 1 : rows.length - 1;
          }
        }
      }

      const nextTx = rows[nextIndex].original;
      if (nextTx.box?.length && nextTx.page) {
        setActiveBox({ box: nextTx.box, page: nextTx.page, id: nextTx._id || nextTx.description });
        
        document.getElementById(`pdf-page-${nextTx.page}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Let React render the new active state before scrolling the table
        setTimeout(() => {
          document.getElementById(`tx-row-${nextTx._id || nextTx.description}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 50);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tab, activeBox, table]);

  if (!data) return null

  if (data.status === 'PENDING' || data.status === 'PROCESSING') {
    return (
      <div className="flex flex-col items-center justify-center w-full h-screen bg-slate-50 gap-6">
        <div className="relative">
          <div className="absolute inset-0 bg-primary/20 rounded-full blur-2xl animate-pulse" />
          <IconLoader2 className="h-16 w-16 animate-spin text-primary relative z-10" />
        </div>
        <div className="text-center space-y-2 relative z-10">
          <h2 className="text-2xl font-black tracking-tight text-slate-800 uppercase">Neural Audit in Progress</h2>
          <p className="text-sm text-slate-400 font-bold uppercase tracking-[0.2em]">Mapping spatial vectors & categorizing portfolio risks...</p>
        </div>
        <Button variant="outline" className="rounded-xl px-8 h-12 gap-2 mt-4" onClick={() => navigate('/statements')}>
           <IconArrowLeft size={16} /> Return to Queue
        </Button>
      </div>
    )
  }

  const sym = getCurrencySymbol(data.currency)
  const txs = data.transactions || []
  const emis = data.emiList || []
  const utilPct = data.creditLimit?.val
    ? Math.round(((data.outstandingTotal?.val ?? 0) / data.creditLimit.val) * 100) : 0

  // Compute totals directly from transactions — always matches what user sees
  const txTotalDebits  = txs.filter(t => t.type === 'Debit').reduce((s, t) => s + t.amount, 0)
  const txTotalCredits = txs.filter(t => t.type === 'Credit').reduce((s, t) => s + t.amount, 0)
  const txTotalFees    = txs.filter(t => t.category === 'Fee' && t.type === 'Debit').reduce((s, t) => s + t.amount, 0)


  return (
    <div className="flex w-full h-full bg-slate-50 overflow-hidden font-sans relative" ref={rootRef}>

      {/* Connector SVG */}
      {linePath && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-[100]">
          <path d={linePath} fill="none" stroke="#ef4444" strokeWidth="1.5" className="opacity-70" />
        </svg>
      )}

      {/* ── LEFT: PDF Viewer ─────────────────────────────────────────────── */}
      <div className="w-[45%] flex flex-col border-r bg-slate-200/40 h-full shrink-0">
        {/* Toolbar */}
        <div className="h-12 bg-white border-b px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400" onClick={() => navigate(isSavedView ? '/statements' : '/')}>
              <IconArrowLeft size={16} />
            </Button>
            <div className="h-3 w-px bg-slate-200" />
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded bg-primary/10 flex items-center justify-center">
                <IconCreditCard size={12} className="text-primary" />
              </div>
              <span className="text-xs font-bold text-slate-900">{data.bankName}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data.statementPeriod?.from && (
              <span className="text-[10px] font-semibold text-slate-400">
                {data.statementPeriod.from} – {data.statementPeriod.to}
              </span>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400">
              <IconDownload size={14} />
            </Button>
          </div>
        </div>

        {/* PDF pages */}
        <div className="flex-1 overflow-y-auto" ref={pdfPaneRef}>
          <div className="p-6 space-y-4 flex flex-col items-center">
            {isSavedView && loadingPdf ? (
              <div className="flex flex-col items-center justify-center py-40 gap-3">
                <div className="h-8 w-8 border-2 border-primary/20 border-t-primary animate-spin rounded-full" />
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Fetching & Decrypting...</p>
              </div>
            ) : isSavedView && pages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-40 gap-3 opacity-40">
                <IconFileOff size={36} className="text-slate-400" />
                <p className="text-xs font-bold text-slate-500">PDF unavailable</p>
              </div>
            ) : loadingPdf ? (
              <div className="flex flex-col items-center justify-center py-40 gap-3">
                <div className="h-8 w-8 border-2 border-primary/20 border-t-primary animate-spin rounded-full" />
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Rendering...</p>
              </div>
            ) : pages.map((img, i) => (
              <div key={i} id={`pdf-page-${i + 1}`} className="relative shadow-sm border bg-white w-full">
                <img src={img} className="w-full h-auto block" alt={`Page ${i + 1}`} />
                {activeBox?.page === i + 1 && (
                  <div
                    id="pdf-highlight"
                    className="absolute ring-2 ring-amber-500 bg-yellow-400/25 animate-pulse"
                    style={{
                      top: `${(activeBox.box[0] / 1000) * 100}%`,
                      left: `${(activeBox.box[1] / 1000) * 100}%`,
                      height: `${((activeBox.box[2] - activeBox.box[0]) / 1000) * 100}%`,
                      width: `${((activeBox.box[3] - activeBox.box[1]) / 1000) * 100}%`,
                    }}
                  />
                )}
                <span className="absolute top-2 right-2 bg-black/10 text-[9px] font-bold text-slate-600 px-2 py-0.5 rounded">
                  PG {i + 1}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── RIGHT: Data Panel ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-white overflow-hidden h-full">

        {/* Stat bar */}
        <div className="shrink-0 px-6 py-4 border-b bg-white">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <h2 className="text-lg font-black text-slate-900 tracking-tight">{data.bankName}</h2>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                {data.statementDate?.val && `Statement: ${data.statementDate.val}`}
                {data.paymentDueDate?.val && ` · Due: ${data.paymentDueDate.val}`}
              </p>
            </div>
            <div className="flex items-center gap-8 flex-wrap">
              <MetricCard label="Credit Limit" value={fmt(data.creditLimit?.val, sym)} />
              <MetricCard
                label="Outstanding"
                value={fmt(data.outstandingTotal?.val, sym)}
                color={utilPct >= 80 ? 'text-red-600' : 'text-slate-900'}
                sub={`${utilPct}% utilized`}
              />
              <MetricCard label="Min Due" value={fmt(data.minPaymentDue?.val, sym)} color="text-amber-600" sub={data.paymentDueDate?.val} />
            </div>
            <div className="flex items-center gap-4">
               {isSavedView && !data.isApproved && data.status === 'COMPLETED' && (
                 <Button 
                   onClick={confirmApproval}
                   className="rounded-xl px-6 h-11 gap-2 bg-emerald-600 hover:bg-emerald-700 shadow-[0_8px_16px_-6px_rgba(16,185,129,0.3)] font-bold text-xs uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-[0.98]"
                 >
                   <IconCheck size={16} strokeWidth={3} /> Approve Audit
                 </Button>
               )}
               {data.isApproved && (
                 <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-4 py-2 rounded-xl border border-emerald-100">
                    <IconCheck size={14} strokeWidth={3} />
                    <span className="text-[10px] font-black uppercase tracking-widest">Verified Report</span>
                 </div>
               )}
            </div>
          </div>

          {/* Utilization bar */}
          <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', utilPct >= 80 ? 'bg-red-500' : utilPct >= 50 ? 'bg-amber-400' : 'bg-emerald-500')}
              style={{ width: `${Math.min(utilPct, 100)}%` }}
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="shrink-0 flex items-center gap-1 px-6 py-2 border-b bg-slate-50/50">
          <TabBtn active={tab === 'transactions'} onClick={() => setTab('transactions')} icon={IconReceipt2} label="Transactions" count={txs.length} />
          {emis.length > 0 && (
            <TabBtn active={tab === 'emi'} onClick={() => setTab('emi')} icon={IconCalendar} label="EMI Active" count={emis.length} />
          )}
          <TabBtn active={tab === 'overview'} onClick={() => setTab('overview')} icon={IconChartBar} label="Overview" />
        </div>

        {/* ── Tab: Transactions ── */}
        {tab === 'transactions' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Search bar */}
            <div className="px-4 py-2 border-b flex items-center gap-3 bg-white shrink-0">
              <input
                type="text"
                placeholder="Filter transactions..."
                value={txGlobalFilter}
                onChange={(e) => setTxGlobalFilter(e.target.value)}
                className="flex-1 h-8 px-3 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/30 text-slate-700 placeholder:text-slate-400"
              />
              <span className="text-[10px] font-bold text-slate-400 shrink-0">
                {table.getFilteredRowModel().rows.length} / {txs.length}
              </span>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto" ref={tablePaneRef}>
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((hg) => (
                    <TableRow key={hg.id} className="bg-slate-50/80 hover:bg-slate-50/80 border-b h-9">
                      {hg.headers.map((h) => (
                        <TableHead key={h.id} className="px-4 py-2 first:pl-6">
                          {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.length > 0 ? table.getRowModel().rows.map((row) => {
                    const tx = row.original
                    const isActive = activeBox?.id === (tx._id || tx.description)
                    return (
                      <TableRow
                        key={row.id}
                        id={`tx-row-${tx._id || tx.description}`}
                        className={cn(
                          'cursor-pointer border-b border-slate-50 h-12 transition-colors',
                          isActive ? 'bg-amber-50' : 'hover:bg-slate-50/60'
                        )}
                        onClick={() => handleTxRowClick(tx)}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id} className="px-4 py-2 first:pl-6">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    )
                  }) : (
                    <TableRow>
                      <TableCell colSpan={txColumns.length} className="h-32 text-center text-slate-400 text-xs font-bold">
                        No transactions matched
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Footer: totals as clickable filter chips */}
            <div className="shrink-0 px-6 py-3 bg-white border-t">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">

                  {/* Debit chip */}
                  <button
                    onClick={() => {
                      if (activeFooterFilter === 'debit') { setActiveFooterFilter(null); setTxGlobalFilter("") }
                      else { setActiveFooterFilter('debit'); setTxGlobalFilter("__DEBIT__") }
                    }}
                    className={cn(
                      'flex flex-col items-start px-3 py-2 rounded-xl border transition-all text-left group',
                      activeFooterFilter === 'debit'
                        ? 'border-red-300 bg-red-50 ring-1 ring-red-200'
                        : 'border-slate-100 hover:border-red-200 hover:bg-red-50/40'
                    )}
                    title="Click to see only debit transactions"
                  >
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                      Total Debits
                      {activeFooterFilter === 'debit'
                        ? <span className="text-red-400">· click to clear ✕</span>
                        : <span className="text-slate-300 group-hover:text-red-300">· click to drill down</span>}
                    </span>
                    <span className="font-bold text-sm text-red-600 tabular-nums">{fmt(txTotalDebits, sym)}</span>
                  </button>

                  {/* Credit chip */}
                  <button
                    onClick={() => {
                      if (activeFooterFilter === 'credit') { setActiveFooterFilter(null); setTxGlobalFilter("") }
                      else { setActiveFooterFilter('credit'); setTxGlobalFilter("__CREDIT__") }
                    }}
                    className={cn(
                      'flex flex-col items-start px-3 py-2 rounded-xl border transition-all text-left group',
                      activeFooterFilter === 'credit'
                        ? 'border-emerald-300 bg-emerald-50 ring-1 ring-emerald-200'
                        : 'border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/40'
                    )}
                    title="Click to see only credit transactions"
                  >
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                      Total Credits
                      {activeFooterFilter === 'credit'
                        ? <span className="text-emerald-500">· click to clear ✕</span>
                        : <span className="text-slate-300 group-hover:text-emerald-300">· click to drill down</span>}
                    </span>
                    <span className="font-bold text-sm text-emerald-600 tabular-nums">{fmt(txTotalCredits, sym)}</span>
                  </button>

                  {/* Fees chip */}
                  {txTotalFees > 0 && (
                    <button
                      onClick={() => {
                        if (activeFooterFilter === 'fees') { setActiveFooterFilter(null); setTxGlobalFilter("") }
                        else { setActiveFooterFilter('fees'); setTxGlobalFilter("__FEES__") }
                      }}
                      className={cn(
                        'flex flex-col items-start px-3 py-2 rounded-xl border transition-all text-left group',
                        activeFooterFilter === 'fees'
                          ? 'border-orange-300 bg-orange-50 ring-1 ring-orange-200'
                          : 'border-slate-100 hover:border-orange-200 hover:bg-orange-50/40'
                      )}
                      title="Click to see fees & interest transactions"
                    >
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                        Fees & Interest
                        {activeFooterFilter === 'fees'
                          ? <span className="text-orange-400">· click to clear ✕</span>
                          : <span className="text-slate-300 group-hover:text-orange-300">· click to drill down</span>}
                      </span>
                      <span className="font-bold text-sm text-orange-600 tabular-nums">{fmt(txTotalFees, sym)}</span>
                    </button>
                  )}

                  {/* Row count when filtered */}
                  {activeFooterFilter && (
                    <span className="text-[10px] font-bold text-slate-400 ml-2 self-center">
                      ↑ {table.getFilteredRowModel().rows.length} transactions shown
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {!isSavedView && (
                    <Button 
                      onClick={() => navigate('/statements')}
                      className="rounded-xl h-10 px-6 font-bold text-xs bg-primary"
                    >
                      Audit Queued - View All
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab: EMI ── */}
        {tab === 'emi' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active EMI Plans</p>
            {emis.map((emi, i) => (
              <div
                key={i}
                className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer"
                onClick={() => {
                  if (emi.box?.length && emi.page) {
                    setActiveBox({ box: emi.box, page: emi.page, id: `emi-${i}` })
                    document.getElementById(`pdf-page-${emi.page}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }
                }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                      <IconCalendar size={18} className="text-indigo-600" />
                    </div>
                    <div>
                      <p className="font-bold text-sm text-slate-900">{emi.name}</p>
                      <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Monthly instalment</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-lg text-slate-900 tabular-nums">{fmt(emi.amount, sym)}</p>
                    <p className="text-[10px] text-slate-400 font-semibold">/ month</p>
                  </div>
                </div>
                {emi.page && (
                  <div className="mt-3 pt-3 border-t border-slate-50 flex items-center gap-1.5">
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-slate-50 text-slate-400 border">Page {emi.page}</span>
                    <span className="text-[9px] text-slate-300">Click to locate on PDF</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Tab: Overview ── */}
        {tab === 'overview' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Summary */}
            {data.summary && (
              <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                <div className="flex items-center gap-2 mb-3">
                  <IconChartBar size={14} className="text-primary" />
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">AI Summary</p>
                </div>
                <p className="text-sm text-slate-700 leading-relaxed font-medium">{data.summary}</p>
              </div>
            )}

            {/* Financial breakdown grid */}
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Financial Breakdown</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Previous Balance', value: fmt(data.previousBalance?.val, sym) },
                  { label: 'Last Payment', value: fmt(data.lastPaymentAmount?.val, sym), sub: data.lastPaymentDate?.val },
                  { label: 'Total Debits', value: fmt(data.totalDebits?.val, sym), color: 'text-red-600' },
                  { label: 'Total Credits', value: fmt(data.totalCredits?.val, sym), color: 'text-emerald-600' },
                  { label: 'Interest Charged', value: fmt(data.totalInterestCharged?.val, sym), color: 'text-orange-600' },
                  { label: 'Total Fees', value: fmt(data.totalFees?.val, sym) },
                  { label: 'Late Fee', value: fmt(data.totalLateFee?.val, sym) },
                  { label: 'Available Limit', value: fmt(data.availableLimit?.val, sym), color: 'text-emerald-600' },
                ].map((item, i) => (
                  <div key={i} className="bg-white border border-slate-100 rounded-xl p-4 space-y-1">
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{item.label}</p>
                    <p className={cn('font-bold text-sm tabular-nums', item.color || 'text-slate-900')}>{item.value}</p>
                    {item.sub && <p className="text-[10px] text-slate-400">{item.sub}</p>}
                  </div>
                ))}
              </div>
            </div>

            {/* Rewards */}
            {data.rewardPointsBalance?.val != null && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Reward Points</p>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Earned', value: data.rewardPointsEarned?.val, icon: IconTrendingUp, color: 'text-emerald-600' },
                    { label: 'Redeemed', value: data.rewardPointsRedeemed?.val, icon: IconTrendingDown, color: 'text-orange-500' },
                    { label: 'Balance', value: data.rewardPointsBalance?.val, icon: IconGift, color: 'text-violet-600' },
                  ].map(({ label, value, icon: Icon, color }, i) => (
                    <div key={i} className="bg-white border border-slate-100 rounded-xl p-4 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <Icon size={12} className={color} />
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
                      </div>
                      <p className={cn('font-bold text-base tabular-nums', color)}>
                        {value?.toLocaleString() ?? '—'} <span className="text-[10px] text-slate-400 font-semibold">pts</span>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Category breakdown */}
            {txs.length > 0 && (() => {
              const catMap: Record<string, number> = {}
              txs.filter(t => t.type === 'Debit').forEach(t => {
                catMap[t.category || 'Other'] = (catMap[t.category || 'Other'] || 0) + t.amount
              })
              const sorted = Object.entries(catMap).sort((a, b) => b[1] - a[1])
              const total = sorted.reduce((s, [, v]) => s + v, 0)
              return (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Spend by Category</p>
                  <div className="space-y-2">
                    {sorted.map(([cat, amt]) => {
                      const pct = Math.round((amt / total) * 100)
                      return (
                        <div key={cat} className="flex items-center gap-3">
                          <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full w-24 text-center shrink-0', CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.Other)}>
                            {cat}
                          </span>
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-primary/60 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[10px] font-bold text-slate-500 tabular-nums w-20 text-right">{fmt(amt, sym)}</span>
                          <span className="text-[9px] text-slate-300 w-8 text-right">{pct}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* Approve button if fresh */}
            {!isSavedView && (
              <div className="flex justify-end pt-2">
                <Button onClick={() => navigate('/statements')} className="rounded-xl h-12 px-8 font-bold bg-primary shadow-lg transition-transform active:scale-95">
                  View All Audits
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Global Toast */}
      {toast.visible && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[1000] animate-in slide-in-from-bottom-4 duration-300">
          <div className={cn(
            "text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border backdrop-blur-md",
            toast.type === 'success' ? "bg-slate-900 border-white/10" : "bg-red-600 border-red-400/20"
          )}>
            <div className={cn(
              "h-6 w-6 rounded-full flex items-center justify-center",
              toast.type === 'success' ? "bg-emerald-500" : "bg-white/20"
            )}>
              {toast.type === 'success' ? <IconCheck size={14} strokeWidth={3} /> : <IconAlertTriangle size={14} />}
            </div>
            <span className="text-sm font-bold tracking-tight">{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  )
}
