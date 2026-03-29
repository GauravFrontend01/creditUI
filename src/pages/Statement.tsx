import React, { useState, useEffect, useRef } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { cn } from "@/lib/utils"
import {
  IconDownload, IconArrowLeft, IconFileOff, IconLoader2,
  IconReceipt2, IconChartBar, IconCreditCard, IconCalendar,
  IconTrendingDown, IconTrendingUp, IconGift,
  IconArrowUp, IconArrowDown, IconArrowsUpDown,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import axios from "axios"

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
  onRowClick: (tx: Transaction) => void
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
        return (
          <span className={cn(
            'text-[10px] font-bold px-2 py-0.5 rounded-full',
            CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.Other
          )}>
            {cat}
          </span>
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
          const res = await axios.get(`/api/statements/${id}`)
          setData(res.data)
          if (res.data.pdfStorageUrl) loadPdfFromUrl(res.data.pdfStorageUrl, res.data.pdfPassword)
        } catch { navigate('/statements') }
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
  const handleApprove = async () => {
    try {
      const b64 = sessionStorage.getItem('pdf_base64')
      const pass = sessionStorage.getItem('pdf_password') || ''
      const name = sessionStorage.getItem('pdf_raw_name') || 'statement.pdf'
      if (!b64) throw new Error('PDF not in session')
      const raw = atob(b64.split(',')[1])
      const bytes = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
      const file = new File([bytes], name, { type: 'application/pdf' })
      const form = new FormData()
      form.append('pdf', file)
      form.append('data', JSON.stringify(data))
      form.append('pdfPassword', pass)
      await axios.post('/api/statements', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      navigate('/statements')
    } catch (e: any) {
      alert('Save failed: ' + e.message)
    }
  }

  // ── TanStack table ────────────────────────────────────────────────────────
  const handleTxRowClick = (tx: Transaction) => {
    if (tx.box?.length && tx.page) {
      setActiveBox({ box: tx.box, page: tx.page, id: tx._id || tx.description })
      document.getElementById(`pdf-page-${tx.page}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  const txColumns = buildColumns(data?.currency ? getCurrencySymbol(data.currency) : '₹', handleTxRowClick)

  const table = useReactTable({
    data: data?.transactions ?? [],
    columns: txColumns,
    state: { sorting: txSorting, globalFilter: txGlobalFilter },
    onSortingChange: setTxSorting,
    onGlobalFilterChange: setTxGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 15 } },
  })

  if (!data) return null

  const sym = getCurrencySymbol(data.currency)
  const txs = data.transactions || []
  const emis = data.emiList || []
  const utilPct = data.creditLimit?.val
    ? Math.round(((data.outstandingTotal?.val ?? 0) / data.creditLimit.val) * 100) : 0


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
              {data.rewardPointsBalance?.val != null && (
                <MetricCard label="Reward Points" value={`${data.rewardPointsBalance.val.toLocaleString()} pts`} color="text-violet-600" />
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

            {/* Footer: totals + pagination */}
            <div className="shrink-0 px-6 py-3 bg-white border-t flex items-center justify-between gap-4">
              <div className="flex items-center gap-6">
                <MetricCard label="Total Debits" value={fmt(data.totalDebits?.val, sym)} color="text-red-600" small />
                <MetricCard label="Total Credits" value={fmt(data.totalCredits?.val, sym)} color="text-emerald-600" small />
                {(data.totalFees?.val ?? 0) > 0 && (
                  <MetricCard label="Fees & Interest" value={fmt((data.totalFees?.val ?? 0) + (data.totalInterestCharged?.val ?? 0), sym)} color="text-slate-500" small />
                )}
              </div>
              <div className="flex items-center gap-3">
                {table.getPageCount() > 1 && (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="h-7 w-7 rounded border text-xs disabled:opacity-30 hover:bg-slate-50 flex items-center justify-center">‹</button>
                    <span className="text-[10px] font-bold text-slate-400">{table.getState().pagination.pageIndex + 1}/{table.getPageCount()}</span>
                    <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="h-7 w-7 rounded border text-xs disabled:opacity-30 hover:bg-slate-50 flex items-center justify-center">›</button>
                  </div>
                )}
                {!isSavedView && (
                  <ApproveButton onApprove={handleApprove} />
                )}
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
                <ApproveButton onApprove={handleApprove} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ApproveButton({ onApprove }: { onApprove: () => Promise<void> }) {
  const [loading, setLoading] = React.useState(false)
  const handle = async () => { setLoading(true); await onApprove(); setLoading(false) }
  return (
    <Button
      onClick={handle}
      disabled={loading}
      className="h-9 px-6 font-bold text-xs uppercase tracking-wide rounded-lg shadow-sm"
    >
      {loading ? <><IconLoader2 size={14} className="animate-spin mr-2" />Saving...</> : 'Approve & Save'}
    </Button>
  )
}
