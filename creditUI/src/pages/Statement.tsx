import { useState, useEffect, useRef, useMemo } from "react"
import { useNavigate, useParams } from "react-router-dom"
import api from "@/lib/api"
import { txRuleKey } from "@/lib/vendorRules"
import { cn } from "@/lib/utils"
import {
  IconDownload, IconArrowLeft, IconFileOff, IconLoader2,
  IconReceipt2, IconChartBar, IconCreditCard, IconCalendar,
  IconTrendingDown, IconTrendingUp, IconGift, IconShieldCheck, IconAlertTriangle, IconShieldX,
  IconArrowUp, IconArrowDown, IconArrowsUpDown, IconCheck, IconX, IconEqual, IconPlus, IconMinus, IconMath,
  IconTerminal2, IconPlayerPlay, IconHistory, IconArrowRight, IconBrain
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
interface VendorRuleRow {
  _id?: string
  merchantName: string
  category: string
  vendorLabel?: string
}

interface Transaction {
  _id: string
  date: string
  description: string
  merchantName?: string
  amount?: number
  deposit?: number
  withdrawal?: number
  balance?: number
  type: "Debit" | "Credit"
  category?: string
  categoryConfidence?: number
  isRecurring?: boolean
  isForex?: boolean
  isInternal?: boolean
  box: number[]
  page: number
}

interface EmiItem {
  name: string
  amount: number
  tenure?: number
  paidInstallments?: number
  remainingInstallments?: number
  box: number[]
  page: number
}

interface StatVal { val?: number; box?: number[]; page?: number }
interface StatStr { val?: string; box?: number[]; page?: number }

interface VersionHistory {
  snapshotAt: string
  transactions: Transaction[]
  emiList: EmiItem[]
  summary: string
  reconciliation: any
  extractionQuality: string
  ocrEngine: string
}

interface StatementData {
  _id: string
  bankName: StatStr
  type?: 'CREDIT_CARD' | 'BANK'
  currency: string
  creditLimit?: StatVal
  availableLimit?: StatVal
  outstandingTotal?: StatVal
  minPaymentDue?: StatVal
  paymentDueDate?: StatStr
  accountNumber?: StatStr
  openingBalance?: StatVal
  closingBalance?: StatVal
  totalDeposits?: StatVal
  totalWithdrawals?: StatVal
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
  processingError?: string
  isApproved?: boolean
  isUserRejected?: boolean
  ocrEngine?: 'gemini' | 'ocr_space' | 'ocr_space_v1' | 'ocr_space_v2' | 'ocr_space_v3'
  extractionQuality?: 'verified' | 'minor_mismatch' | 'extraction_error' | 'unverified'
  versions?: VersionHistory[]
  reconciliation?: {
    matched: boolean;
    balanceDelta: number;
    debitDelta: number;
    creditDelta: number;
    calculatedClosing: number;
    expectedClosing: number;
    extractedDebits: number;
    extractedCredits: number;
    extractedDeposits?: number;
    extractedWithdrawals?: number;
    transactionCount: number;
    continuityErrors?: number;
    duplicateCount?: number;
    reasons?: string[];
    checkedAt: string;
  }
  reconciliationSummary?: any
  rawAIResponse?: any
}

// ── Helpers ────────────────────────────────────────────────────────────────
const getCurrencySymbol = (code?: string) => {
  const c = code?.toUpperCase() || ''
  if (c.includes('INR') || c.includes('RUPEE')) return '₹';
  if (c.includes('USD') || c.includes('DOLLAR')) return '$';
  if (c.includes('GBP') || c.includes('POUND')) return '£';
  if (c.includes('EUR') || c.includes('EURO')) return '€';
  return '₹';
}

const fmt = (val?: any, sym = '₹') => {
  if (val == null) return '—'

  let num: number;
  if (typeof val === 'string') {
    // Robust cleaning for strings like "INDIAN RUPEE 7,142.45"
    const cleaned = val.replace(/[^\d.-]/g, '');
    num = parseFloat(cleaned);
  } else {
    num = val;
  }

  if (isNaN(num)) return '—';

  return `${sym}${num.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
}

const CATEGORY_COLORS: Record<string, string> = {
  Food: 'bg-orange-50 text-orange-600',
  Shopping: 'bg-purple-50 text-purple-600',
  Entertainment: 'bg-pink-50 text-pink-600',
  Travel: 'bg-blue-50 text-blue-600',
  EMI: 'bg-indigo-50 text-indigo-600',
  Fee: 'bg-slate-100 text-slate-500',
  Cashback: 'bg-emerald-50 text-emerald-600',
  Utilities: 'bg-cyan-50 text-cyan-600',
  Healthcare: 'bg-red-50 text-red-500',
  Fuel: 'bg-yellow-50 text-yellow-600',
  Subscription: 'bg-violet-50 text-violet-600',
  Forex: 'bg-teal-50 text-teal-600',
  Other: 'bg-slate-50 text-slate-400',
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
  onCategoryUpdate: (tx: Transaction, newCat: string) => void,
  type: 'CREDIT_CARD' | 'BANK' = 'CREDIT_CARD',
  vendorExtras?: {
    getVendorLabel: (tx: Transaction) => string
    onVendorLabelBlur: (tx: Transaction, value: string) => void
  }
): ColumnDef<Transaction>[] {
  const isBank = type === 'BANK';

  const baseColumns: ColumnDef<Transaction>[] = [
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
          <div className="py-1">
            <p className="font-bold text-[13px] text-slate-800 truncate max-w-[320px] flex items-center">
              {tx.merchantName || tx.description}
              {tx.isInternal && (
                <span className="ml-2 text-[8px] font-black uppercase tracking-widest bg-indigo-50 text-indigo-500 px-1.5 py-0.5 rounded border border-indigo-100 shrink-0">
                  Internal
                </span>
              )}
            </p>
            {tx.merchantName && tx.merchantName !== tx.description && (
              <p className="text-[10px] text-slate-400 truncate max-w-[320px] leading-tight mt-0.5">{tx.description}</p>
            )}
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
        const vLabel = vendorExtras?.getVendorLabel(row.original) ?? ''
        return (
          <div className="flex flex-col gap-1 items-start min-w-[128px]">
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
            {vendorExtras && (
              <input
                type="text"
                className="w-full max-w-[148px] text-[9px] font-semibold text-slate-500 border border-slate-200/80 rounded-md px-1.5 py-0.5 bg-white placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-primary/30"
                placeholder="Vendor tag (e.g. office food)"
                defaultValue={vLabel}
                key={`${txRuleKey(row.original)}-${vLabel}`}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => vendorExtras.onVendorLabelBlur(row.original, e.target.value)}
              />
            )}
          </div>
        )
      },
    },
  ];

  if (!isBank) {
    baseColumns.push(
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
        sortingFn: (a, b) => (a.original.amount || 0) - (b.original.amount || 0),
      }
    );
  } else {
    // Bank columns: Withdrawal, Deposit, Balance
    baseColumns.push(
      {
        accessorKey: 'withdrawal',
        header: ({ column }) => <SortHeader column={column} label="Withdrawal" />,
        cell: ({ row }) => (
          <span className="font-bold tabular-nums text-sm text-red-500">
            {row.original.withdrawal ? fmt(row.original.withdrawal, sym) : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'deposit',
        header: ({ column }) => <SortHeader column={column} label="Deposit" />,
        cell: ({ row }) => (
          <span className="font-bold tabular-nums text-sm text-emerald-600">
            {row.original.deposit ? fmt(row.original.deposit, sym) : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'balance',
        header: ({ column }) => <SortHeader column={column} label="Balance" />,
        cell: ({ row }) => (
          <span className="font-bold tabular-nums text-sm text-slate-900">
            {fmt(row.original.balance, sym)}
          </span>
        ),
      }
    );
  }

  // Add common end columns (flags, locate)
  baseColumns.push(
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
  );

  return baseColumns;
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
function Statement() {
  const [data, setData] = useState<StatementData | null>(null)
  const [pages, setPages] = useState<any[]>([])
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [activeBox, setActiveBox] = useState<{ box: number[]; page: number; id: string } | null>(null)
  const [linePath, setLinePath] = useState("")
  const [isSavedView, setIsSavedView] = useState(false)
  const [tab, setTab] = useState<'transactions' | 'emi' | 'overview' | 'raw_ocr' | 'history'>('transactions')
  const [forensicType, setForensicType] = useState<'CREDIT_CARD' | 'BANK'>('CREDIT_CARD');
  const [txSorting, setTxSorting] = useState<SortingState>([])
  const [txGlobalFilter, setTxGlobalFilter] = useState("")
  const [activeFooterFilter, setActiveFooterFilter] = useState<'debit' | 'credit' | 'fees' | null>(null)
  const [toast, setToast] = useState<{ message: string, visible: boolean, type: 'success' | 'error' }>({ message: "", visible: false, type: 'success' })
  const [showMathDetails, setShowMathDetails] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [showVault, setShowVault] = useState(false);
  const [injectedJson, setInjectedJson] = useState('');
  const [vendorRules, setVendorRules] = useState<VendorRuleRow[]>([])
  const [isPreview, setIsPreview] = useState(false)
  const [, setPreviewData] = useState<any>(null)
  const [sendingToAI, setSendingToAI] = useState(false)

  const { id } = useParams()
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)
  const pdfPaneRef = useRef<HTMLDivElement>(null)
  const tablePaneRef = useRef<HTMLDivElement>(null)
  const [showRawJson, setShowRawJson] = useState(false)

  // ── Fetch data ────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      if (id === 'preview') {
        console.log("[Statement] Entered PREVIEW mode via /statements/preview");
        setIsPreview(true)
        const imgs = sessionStorage.getItem('preview_pdf_images')
        const name = sessionStorage.getItem('preview_pdf_name')
        const gmailData = sessionStorage.getItem('preview_gmail_data')
        const manualData = sessionStorage.getItem('preview_manual_data')
        const password = sessionStorage.getItem('preview_pdf_password')

        console.log(`[Statement] Preview assets found: ${imgs ? JSON.parse(imgs).length : 0} images, name: ${name}, hasPassword: ${!!password}`);
        
        if (imgs) {
          const parsed = JSON.parse(imgs);
          const normalizedPages = parsed.map((p: any) => typeof p === 'string' ? { image: p, isRelevant: true } : p);
          setPages(normalizedPages)
          setData({
            _id: 'preview',
            bankName: { val: name || 'Preview Statement', box: [], page: 0 },
            transactions: [],
            emiList: [],
            status: 'COMPLETED',
            currency: 'INR'
          })
          if (gmailData) {
            console.log("[Statement] Gmail candidate data detected for preview audit");
            setPreviewData(JSON.parse(gmailData));
          }
          if (manualData) {
            const parsed = JSON.parse(manualData);
            if (parsed.statementType) setForensicType(parsed.statementType);
          }
        } else {
          navigate('/upload')
        }
        return;
      }

      if (id) {
        setIsSavedView(true)
        try {
          const { data } = await api.get(`/api/statements/${id}`)
          setData(data)
          if (data.type) setForensicType(data.type);

          if (data.rawAIResponse) {
            console.log("[Neural Core] Raw AI Extraction Response:", data.rawAIResponse);
          }

          if (data.rawAIResponse?.type === 'OCR_SPACE_RAW' && (!data.transactions || data.transactions.length === 0)) {
            setTab('raw_ocr')
          }

          if (data.pdfStorageUrl && pages.length === 0) loadPdfFromUrl(data.pdfStorageUrl, data.pdfPassword)
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
          const finalBankName = typeof parsed.bankName === 'object' && parsed.bankName !== null
            ? parsed.bankName
            : { val: parsed.bankName || name || 'Statement', box: [], page: 0 };

          setData({
            ...parsed,
            _id: '',
            bankName: finalBankName,
            transactions: parsed.transactions || [],
            emiList: parsed.emiList || []
          })
          loadPdfFromBase64(b64, pass || '')
        } else navigate('/')
      }
    }
    load()
  }, [id])

  useEffect(() => {
    if (!id || id === 'preview') return
    if (!data || data._id !== id) return
    if (data.status !== 'PENDING' && data.status !== 'PROCESSING') return

    const tick = async () => {
      try {
        const { data: d } = await api.get(`/api/statements/${id}`)
        setData(d)
        if (d.type) setForensicType(d.type)
      } catch (e) {
        console.error('Statement poll failed', e)
      }
    }

    const t = setInterval(tick, 3000)
    return () => clearInterval(t)
  }, [id, data?._id, data?.status])

  useEffect(() => {
    api.get('/api/vendor-rules').then((res) => setVendorRules(res.data)).catch(() => { })
  }, [])

  const vendorRulesByKey = useMemo(() => {
    const m = new Map<string, VendorRuleRow>()
    for (const r of vendorRules) {
      m.set(r.merchantName.trim().toLowerCase(), r)
    }
    return m
  }, [vendorRules])

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
      setData(prev => prev ? { ...prev, isApproved: true, isUserRejected: false } : null)
      setToast({ message: 'Forensic Audit Approved', visible: true, type: 'success' })
      setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 4000)
    } catch (e: any) {
      setToast({ message: 'Approval failed: ' + (e.message || "Unknown error"), visible: true, type: 'error' })
      setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 4000)
    }
  }

  const confirmReject = async () => {
    if (!id) return
    try {
      await api.put(`/api/statements/${id}/reject`)
      setData(prev => prev ? { ...prev, isApproved: false, isUserRejected: true } : null)
      setToast({ message: 'Marked as not accepted', visible: true, type: 'success' })
      setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 4000)
    } catch (e: any) {
      setToast({ message: 'Update failed: ' + (e.message || 'Unknown error'), visible: true, type: 'error' })
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
    const rk = txRuleKey(tx)
    const existing = vendorRulesByKey.get(rk)
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
      const merchantName = (tx.merchantName || '').trim() || (tx.description || '').trim().slice(0, 96)
      if (merchantName) {
        await api.post('/api/vendor-rules', {
          merchantName,
          category: newCat,
          vendorLabel: existing?.vendorLabel ?? '',
        });
        setVendorRules((prev) => {
          const key = merchantName.trim().toLowerCase()
          const rest = prev.filter((r) => r.merchantName.trim().toLowerCase() !== key)
          return [...rest, { merchantName: key, category: newCat, vendorLabel: existing?.vendorLabel ?? '' }]
        })
      }
    } catch (e) {
      console.error("Failed to save vendor rule:", e);
    }
  };

  const handleVendorLabelBlur = async (tx: Transaction, value: string) => {
    const merchantName = (tx.merchantName || '').trim() || (tx.description || '').trim().slice(0, 96)
    if (!merchantName) return
    const category = tx.category || 'Other'
    const trimmed = value.trim()
    try {
      await api.post('/api/vendor-rules', { merchantName, category, vendorLabel: trimmed })
      const key = merchantName.trim().toLowerCase()
      setVendorRules((prev) => {
        const rest = prev.filter((r) => r.merchantName.trim().toLowerCase() !== key)
        return [...rest, { merchantName: key, category, vendorLabel: trimmed }]
      })
    } catch (e) {
      console.error("Failed to save vendor label:", e);
    }
  }

  const txColumns = buildColumns(
    data?.currency ? getCurrencySymbol(data.currency) : '₹',
    handleCategoryUpdate,
    data?.type,
    {
      getVendorLabel: (tx) => vendorRulesByKey.get(txRuleKey(tx))?.vendorLabel ?? '',
      onVendorLabelBlur: handleVendorLabelBlur,
    }
  )

  const handleReprocess = async () => {
    if (!id) return;
    try {
      setReprocessing(true);
      const res = await api.post(`/api/statements/${id}/reprocess`, { targetType: forensicType });
      setData(res.data.statement);
      setToast({ message: "Audit re-mapped successfully", visible: true, type: 'success' });
      setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 3000);
    } catch (error: any) {
      console.error(error);
      setToast({ message: error.response?.data?.message || "Failed to re-sync audit", visible: true, type: 'error' });
      setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 4000);
    } finally {
      setReprocessing(false);
    }
  };

  const handleReIngest = async () => {
    if (!id) return;
    try {
      setReprocessing(true);
      const { data: d } = await api.post(`/api/statements/${id}/re-ingest`);
      setData(d);
      if (d.type) setForensicType(d.type);
      setToast({ message: "Re-ingestion cycle initiated", visible: true, type: "success" });
      setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 3000);
    } catch (error: any) {
      setToast({ message: error.response?.data?.message || "Re-ingestion failed", visible: true, type: "error" });
      setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 4000);
    } finally {
      setReprocessing(false);
    }
  };

  const handleInjection = async () => {
    if (!id || !injectedJson) return;
    try {
      setReprocessing(true);
      const parsed = JSON.parse(injectedJson);
      const res = await api.post(`/api/statements/${id}/reprocess`, { manualExtraction: parsed });
      setData(res.data.statement);
      setShowVault(false);
      setInjectedJson('');
      setToast({ message: "Cyber Injection Successful", visible: true, type: 'success' });
      setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 3000);
    } catch (e: any) {
      console.error(e);
      setToast({ message: "Invalid JSON Payload", visible: true, type: 'error' });
      setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 4000);
    } finally {
      setReprocessing(false);
    }
  };

  const handleSendToAI = async () => {
    setSendingToAI(true);
    try {
      const gmailData = sessionStorage.getItem('preview_gmail_data');
      const manualData = sessionStorage.getItem('preview_manual_data');
      const password = sessionStorage.getItem('preview_pdf_password') || '';
      console.log(`[Statement] Initiating AI Extraction. Type: ${forensicType}, Source: ${gmailData ? 'Gmail' : manualData ? 'Manual' : 'Unknown'}`);

      if (gmailData) {
        const parsed = JSON.parse(gmailData);
        console.log(`[Statement] Syncing Gmail PDF: ${parsed.filename}`);
        
        // Final relevancy check: Only send pages marked as relevant
        const relevantIndices = pages.length > 0 && typeof pages[0] === 'object' 
          ? pages.map((p, idx) => p.isRelevant ? idx + 1 : -1).filter(idx => idx !== -1)
          : null;
        
        console.log(`[Statement] Filtered relevant pages for sync:`, relevantIndices);

        const { data: syncRes } = await api.post('/api/gmail/sync-selected', {
          selections: [{
            messageId: parsed.messageId,
            filename: parsed.filename,
            password: password,
            statementType: forensicType,
            ocrEngine: 'gemini',
            targetPages: relevantIndices // Backend should support skipping non-relevant pages if needed
          }]
        });

        if (syncRes.created?.length > 0) {
          const newId = syncRes.created[0]._id;
          console.log(`[Statement] Sync successful. Redirecting to background extraction node: ${newId}`);
          clearPreviewSession();
          navigate(`/statements/${newId}`);
        } else {
          console.error("[Statement] Sync failed - no statement created", syncRes);
          setToast({ message: "Sync failed", visible: true, type: 'error' });
        }
      } else if (manualData) {
        const parsed = JSON.parse(manualData);
        console.log(`[Statement] Uploading manual PDF for AI audit: ${parsed.name}`);
        
        const relevantIndices = pages.length > 0 && typeof pages[0] === 'object' 
          ? pages.map((p, idx) => p.isRelevant ? idx + 1 : -1).filter(idx => idx !== -1)
          : null;

        console.log(`[Statement] Filtered relevant pages for manual upload:`, relevantIndices);

        const b64 = sessionStorage.getItem('preview_pdf_base64');
        if (!b64) throw new Error("File data lost");

        // Convert base64 to blob/file
        const res = await fetch(b64);
        const blob = await res.blob();
        const file = new File([blob], parsed.name, { type: 'application/pdf' });

        const formData = new FormData();
        formData.append('pdf', file);
        formData.append('statementType', forensicType);
        formData.append('ocrEngine', 'gemini');
        if (password) formData.append('pdfPassword', password);
        if (relevantIndices) formData.append('targetPages', JSON.stringify(relevantIndices));

        const { data } = await api.post('/api/statements', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        
        clearPreviewSession();
        navigate(`/statements/${data._id}`);
      }
    } catch (err: any) {
      console.error(err);
      setToast({ message: err.response?.data?.message || err.message || "Audit failed to start", visible: true, type: 'error' });
    } finally {
      setSendingToAI(false);
    }
  };

  const clearPreviewSession = () => {
    sessionStorage.removeItem('preview_pdf_images');
    sessionStorage.removeItem('preview_pdf_name');
    sessionStorage.removeItem('preview_pdf_password');
    sessionStorage.removeItem('preview_gmail_data');
    sessionStorage.removeItem('preview_manual_data');
    sessionStorage.removeItem('preview_pdf_base64');
  }



  const handleDownloadUnlocked = async () => {
    if (!id) {
      // Session only: Rebuild locally if possible or from memory
      const b64 = sessionStorage.getItem('pdf_base64');
      if (b64) {
        const link = document.createElement('a');
        link.href = b64;
        link.download = `${data?.bankName?.val || 'statement'}_unlocked.pdf`;
        link.click();
      }
      return;
    }

    // NEW: Use Forensic Reconstruction from images
    if (pages.length > 0) {
      console.log(`[Forensic] Triggering reconstruction for ${pages.length} pages.`);
      handleRebuildDownload();
      return;
    }

    try {
      console.log(`[Forensic] Attempting standard unlocked download for ID: ${id}`);
      const response = await api.get(`/api/statements/${id}/download-unlocked`, {
        responseType: 'blob'
      });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${data?.bankName?.val || 'statement'}_unlocked.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download failed', e);
      setToast({ message: "Failed to download unlocked PDF", visible: true, type: 'error' });
      setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 4000);
    }
  };

  const handleRebuildDownload = async () => {
    if (pages.length === 0) {
      console.warn("[Forensic] Reconstruction requested but no pages found in state.");
      return;
    }
    
    console.log(`[Forensic] Packaging ${pages.length} images for backend reassembly...`);
    setToast({ message: "Reconstructing forensic PDF...", visible: true, type: 'success' });
    setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 2000);

    try {
      // Get the image URLs (handles both simple strings or objects with 'image' property)
      const imageUrls = pages.map(p => typeof p === 'string' ? p : p.image);
      
      const response = await api.post('/api/statements/rebuild-pdf', {
        images: imageUrls,
        filename: `${data?.bankName?.val || 'statement'}_unlocked_forensic.pdf`
      }, {
        responseType: 'blob'
      });

      console.log("[Forensic] PDF Bytes received. Triggering browser download...");
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${data?.bankName?.val || 'statement'}_unlocked_forensic.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Forensic rebuild failed', e);
      setToast({ message: "PDF reconstruction failed. Standard download attempted.", visible: true, type: 'error' });
      setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 4000);
    }
  };

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
        String(tx.amount || tx.deposit || tx.withdrawal || 0).includes(q)
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

  const isBank = data.type === 'BANK';

  if (data.status === 'PENDING' || data.status === 'PROCESSING') {
    return (
      <div className="flex flex-col items-center justify-center w-full h-screen bg-slate-50 gap-6 px-6">
        <div className="relative">
          <div className="absolute inset-0 bg-primary/20 rounded-full blur-2xl animate-pulse" />
          <IconLoader2 className="h-16 w-16 animate-spin text-primary relative z-10" />
        </div>
        <div className="text-center space-y-2 relative z-10 max-w-md">
          <p className="text-[10px] font-black text-primary uppercase tracking-[0.25em]">Extraction stage</p>
          <h2 className="text-2xl font-black tracking-tight text-slate-800">Reading your statement</h2>
          <p className="text-sm text-slate-500 font-medium leading-relaxed">
            AI is pulling amounts and transactions from the PDF and reconciling totals. The full statement view unlocks when this finishes.
          </p>
        </div>
        <Button variant="outline" className="rounded-xl px-8 h-12 gap-2 mt-4" onClick={() => navigate('/statements')}>
          <IconArrowLeft size={16} /> Back to statements
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
  // ROOT CAUSE FIX: Exclude merchant EMIs (mostly SBI Card "FP EMI") and Internal Transfers from sums
  const txTotalDebits = txs
    .filter(t => t.type === 'Debit' && !t.description?.toUpperCase().includes('FP EMI') && !t.isInternal && t.category !== 'Transfer')
    .reduce((s, t) => s + (t.amount || t.withdrawal || 0), 0)
  const txTotalCredits = txs
    .filter(t => t.type === 'Credit' && !t.isInternal && t.category !== 'Transfer')
    .reduce((s, t) => s + (t.amount || t.deposit || 0), 0)
  const txTotalFees = txs
    .filter(t => t.category === 'Fee' && t.type === 'Debit' && !t.description?.toUpperCase().includes('FP EMI'))
    .reduce((s, t) => s + (t.amount || 0), 0)


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
              <span className="text-xs font-bold text-slate-900">
                {typeof data.bankName === 'object' ? data.bankName?.val : data.bankName}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data.statementPeriod?.from && (
              <span className="text-[10px] font-semibold text-slate-400">
                {data.statementPeriod.from} – {data.statementPeriod.to}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-400 hover:text-primary transition-colors"
              onClick={handleDownloadUnlocked}
              title="Download Unlocked PDF"
            >
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
            ) : pages.map((pageObj, i) => {
              const pageNum = i + 1;
              const img = typeof pageObj === 'string' ? pageObj : pageObj.image;
              const isRelevant = typeof pageObj === 'string' ? true : pageObj.isRelevant;

              const rawOcr = data.rawAIResponse?.type === 'OCR_SPACE_RAW'
                ? data.rawAIResponse.parsedResults?.find((p: any) => p.page === pageNum)
                : null;

              return (
                <div key={i} id={`pdf-page-${pageNum}`} className={cn(
                  "relative shadow-sm border bg-white w-full transition-opacity",
                  !isRelevant && isPreview ? "opacity-40 grayscale" : "opacity-100"
                )}>
                  <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
                    <Badge variant="outline" className="bg-white/80 backdrop-blur shadow-sm border-slate-200 text-[10px] font-black uppercase tracking-[0.2em]">
                      PAGE {pageNum}
                    </Badge>
                    {isPreview && (
                      <Badge className={cn(
                        "shadow-sm text-[10px] font-black uppercase tracking-widest border-0",
                        isRelevant ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
                      )}>
                        {isRelevant ? "Forensic Relevance: High" : "Noise / Metadata"}
                      </Badge>
                    )}
                  </div>
                  <img src={img} className="w-full h-auto block" alt={`Page ${pageNum}`} />

                  {/* OCR.space Raw Highlights */}
                  {rawOcr && rawOcr.overlay?.Lines?.map((line: any, li: number) => (
                    line.Words?.map((word: any, wi: number) => (
                      <div
                        key={`ocr-${li}-${wi}`}
                        className="absolute bg-yellow-400/30 hover:bg-yellow-400/60 transition-colors cursor-help border border-yellow-500/20"
                        title={word.WordText}
                        style={{
                          // Heuristic for image dimensions if not explicitly provided by the engine
                          top: `${(word.Top / (rawOcr.overlay.ImageHeight || word.ImageHeight || 2048)) * 100}%`,
                          left: `${(word.Left / (rawOcr.overlay.ImageWidth || word.ImageWidth || 2048)) * 100}%`,
                          width: `${(word.Width / (rawOcr.overlay.ImageWidth || word.ImageWidth || 2048)) * 100}%`,
                          height: `${(word.Height / (rawOcr.overlay.ImageHeight || word.ImageHeight || 2048)) * 100}%`,
                        }}
                      />
                    ))
                  ))}

                  {activeBox?.page === pageNum && (
                    <div
                      id="pdf-highlight"
                      className="absolute ring-2 ring-amber-500 bg-yellow-400/25 animate-pulse z-10"
                      style={{
                        top: `${(activeBox.box[0] / 1000) * 100}%`,
                        left: `${(activeBox.box[1] / 1000) * 100}%`,
                        height: `${((activeBox.box[2] - activeBox.box[0]) / 1000) * 100}%`,
                        width: `${((activeBox.box[3] - activeBox.box[1]) / 1000) * 100}%`,
                      }}
                    />
                  )}
                  <span className="absolute top-2 right-2 bg-black/10 text-[9px] font-bold text-slate-600 px-2 py-0.5 rounded z-20">
                    PG {pageNum}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── RIGHT: Data Panel ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-white overflow-hidden h-full relative">
        {isPreview && (
          <div className="absolute inset-0 z-50 bg-white/80 backdrop-blur-md flex flex-col items-center justify-center p-12 text-center animate-in fade-in duration-500">
             <div className="w-24 h-24 rounded-[2rem] bg-primary/10 flex items-center justify-center text-primary mb-8 animate-bounce duration-[3s]">
                <IconBrain size={48} strokeWidth={1.5} />
             </div>
             <h2 className="text-4xl font-black text-slate-900 tracking-tight mb-4">Audit Staged</h2>
             <p className="text-slate-500 max-w-md mb-12 text-lg font-medium leading-relaxed">
               We have successfully unlocked <span className="text-primary font-bold">"{data.bankName?.val}"</span>. 
               Review the pages on the left. Click below to initiate neural extraction.
             </p>

             <div className="flex flex-col gap-4 w-full max-w-sm">
                <div className="flex justify-center mb-2">
                  <Button
                    variant="outline"
                    onClick={handleDownloadUnlocked}
                    size="icon"
                    className="rounded-2xl h-14 w-14 border-slate-200 text-slate-600 hover:bg-slate-50 transition-all shrink-0"
                    title="Download unlocked PDF"
                  >
                    <IconDownload size={22} strokeWidth={2} />
                  </Button>
                </div>

                <div className="flex bg-slate-100 p-1 rounded-2xl gap-1 border border-slate-200/50 mb-4">
                  <button
                    onClick={() => setForensicType('CREDIT_CARD')}
                    className={cn(
                      "flex-1 py-3 rounded-xl text-xs font-black tracking-widest transition-all uppercase",
                      forensicType === 'CREDIT_CARD' ? "bg-white shadow-sm text-slate-900" : "text-slate-400 hover:text-slate-600"
                    )}
                  >
                    Credit Card
                  </button>
                  <button
                    onClick={() => setForensicType('BANK')}
                    className={cn(
                      "flex-1 py-3 rounded-xl text-xs font-black tracking-widest transition-all uppercase",
                      forensicType === 'BANK' ? "bg-white shadow-sm text-slate-900" : "text-slate-400 hover:text-slate-600"
                    )}
                  >
                    Bank Account
                  </button>
                </div>

                <Button 
                  onClick={handleSendToAI}
                  disabled={sendingToAI}
                  className="h-20 rounded-[2rem] bg-primary hover:bg-primary/90 text-xl font-black uppercase tracking-[0.2em] shadow-2xl shadow-primary/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  {sendingToAI ? (
                    <div className="flex items-center gap-3">
                      <IconLoader2 size={24} className="animate-spin" />
                      Starting...
                    </div>
                  ) : "Send to Gemini"}
                </Button>
                
                <Button 
                  variant="ghost" 
                  onClick={() => navigate('/upload')}
                  className="text-slate-400 font-bold hover:text-slate-600"
                >
                  Cancel & Go Back
                </Button>
             </div>
          </div>
        )}

        {/* Stat bar */}
        <div className="shrink-0 px-6 py-4 border-b bg-white">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-black text-slate-900 tracking-tight">
                  {typeof data.bankName === 'object' ? data.bankName?.val : data.bankName}
                </h2>
                <span className="text-[9px] font-black uppercase tracking-[0.15em] bg-primary/5 text-primary px-2 py-0.5 rounded border border-primary/10">
                  {data.ocrEngine === 'ocr_space' ? 'OCR.space v1' :
                    data.ocrEngine === 'ocr_space_v1' ? 'OCR.space v1' :
                      data.ocrEngine === 'ocr_space_v2' ? 'OCR.space v2' :
                        data.ocrEngine === 'ocr_space_v3' ? 'OCR.space v3' : 'Gemini Native'}
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                {data.statementDate?.val && `Statement: ${data.statementDate.val}`}
                {data.paymentDueDate?.val && ` · Due: ${data.paymentDueDate.val}`}
              </p>
            </div>
            <div className="flex items-center gap-8 flex-wrap">
              {!isBank ? (
                <>
                  <MetricCard label="Credit Limit" value={fmt(data.creditLimit?.val, sym)} />
                  <MetricCard
                    label="Outstanding"
                    value={fmt(data.outstandingTotal?.val, sym)}
                    color={utilPct >= 80 ? 'text-red-600' : 'text-slate-900'}
                    sub={`${utilPct}% utilized`}
                  />
                  <MetricCard label="Min Due" value={fmt(data.minPaymentDue?.val, sym)} color="text-amber-600" sub={data.paymentDueDate?.val} />
                </>
              ) : (
                <>
                  <MetricCard label="Opening Balance" value={fmt(data.openingBalance?.val, sym)} />
                  <MetricCard
                    label="Closing Balance"
                    value={fmt(data.closingBalance?.val, sym)}
                    color="text-emerald-600"
                  />
                  <MetricCard label="A/C Number" value={data.accountNumber?.val || '—'} small />
                </>
              )}
            </div>
            <div className="flex items-center gap-4">
              {isSavedView && !data.isApproved && data.status === 'COMPLETED' && (
                <div className="flex gap-2 flex-wrap">
                  <Button
                    onClick={confirmApproval}
                    className="rounded-xl px-6 h-11 gap-2 bg-emerald-600 hover:bg-emerald-700 shadow-[0_8px_16px_-6px_rgba(16,185,129,0.3)] font-bold text-xs uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <IconCheck size={16} strokeWidth={3} /> Approve
                  </Button>
                  <Button
                    onClick={confirmReject}
                    variant="outline"
                    className="rounded-xl px-6 h-11 gap-2 border-red-200 text-red-600 hover:bg-red-50 font-bold text-xs uppercase tracking-widest transition-all"
                  >
                    <IconX size={16} /> Reject
                  </Button>
                  <Button
                    onClick={handleDownloadUnlocked}
                    variant="outline"
                    size="icon"
                    className="rounded-xl h-11 w-11 shrink-0 border-primary text-primary hover:bg-primary/5"
                    title="Unlocked PDF"
                  >
                    <IconDownload size={18} strokeWidth={2} />
                  </Button>
                </div>
              )}

              {isSavedView && (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowRawJson(true)}
                    className="h-11 px-4 rounded-xl border border-slate-100/50 hover:bg-slate-50 transition-all font-mono text-[10px] font-bold text-slate-400 hover:text-slate-900 uppercase tracking-widest"
                  >
                    Raw JSON
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReIngest}
                    disabled={reprocessing}
                    className={cn(
                      "h-11 px-4 rounded-xl border-dashed transition-all font-bold text-[10px] uppercase tracking-widest gap-2",
                      reprocessing && "animate-pulse",
                      data?.status === 'FAILED'
                        ? "border-red-300 bg-red-50 text-red-600 hover:bg-red-100 ring-1 ring-red-200 shadow-[0_0_15px_-3px_rgba(239,68,68,0.2)]"
                        : "border-slate-200 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200"
                    )}
                    title={data?.status === 'FAILED' ? `Error: ${data.processingError}` : "Re-launch AI extraction cycle"}
                  >
                    {reprocessing ? (
                      <>
                        <IconLoader2 size={14} className={cn("animate-spin", data?.status === 'FAILED' ? "text-red-500" : "text-emerald-500")} />
                        {data?.status === 'FAILED' ? 'Retrying...' : 'Ingesting...'}
                      </>
                    ) : (
                      <>
                        {data?.status === 'FAILED' ? <IconAlertTriangle size={14} /> : <IconReceipt2 size={14} />}
                        {data?.status === 'FAILED' ? 'Retry Audit' : 'Re-Ingest'}
                      </>
                    )}
                  </Button>


                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReprocess}
                    disabled={reprocessing}
                    className={cn(
                      "h-11 px-4 rounded-xl border-dashed border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all font-bold text-[10px] uppercase tracking-widest gap-2",
                      reprocessing && "animate-pulse"
                    )}
                  >
                    {reprocessing ? (
                      <>
                        <IconLoader2 size={14} className="animate-spin text-indigo-500" />
                        Mapping...
                      </>
                    ) : (
                      <>
                        <IconMath size={14} />
                        Re-Sync AI
                      </>
                    )}
                  </Button>
                </div>
              )}

              {isSavedView && data.status === 'COMPLETED' && (
                <div
                  onClick={() => setShowMathDetails(true)}
                  className={cn("flex flex-col items-end gap-1 px-4 py-1.5 rounded-xl border border-l-4 cursor-pointer hover:shadow-md transition-all active:scale-95",
                    data.extractionQuality === 'verified' ? "bg-emerald-50 border-emerald-100 border-l-emerald-500 hover:bg-emerald-100/50" :
                      data.extractionQuality === 'minor_mismatch' ? "bg-amber-50 border-amber-100 border-l-amber-500 hover:bg-amber-100/50" :
                        data.extractionQuality === 'extraction_error' ? "bg-red-50 border-red-100 border-l-red-500 hover:bg-red-100/50" :
                          "bg-slate-50 border-slate-100 border-l-slate-400 hover:bg-slate-100"
                  )}>
                  <div className="flex items-center gap-2">
                    {data.extractionQuality === 'verified' && <IconShieldCheck size={14} className="text-emerald-600" />}
                    {data.extractionQuality === 'minor_mismatch' && <IconAlertTriangle size={14} className="text-amber-600" />}
                    {data.extractionQuality === 'extraction_error' && <IconShieldX size={14} className="text-red-600" />}
                    {data.extractionQuality === 'unverified' && <IconFileOff size={14} className="text-slate-400" />}

                    <span className={cn("text-[10px] font-black uppercase tracking-widest",
                      data.extractionQuality === 'verified' ? "text-emerald-700" :
                        data.extractionQuality === 'minor_mismatch' ? "text-amber-700" :
                          data.extractionQuality === 'extraction_error' ? "text-red-700" :
                            "text-slate-500"
                    )}>
                      {data.extractionQuality === 'verified' ? 'Math Verified' :
                        data.extractionQuality === 'minor_mismatch' ? 'Minor Mismatch' :
                          data.extractionQuality === 'extraction_error' ? 'Extraction Error' : 'Unverified'}
                    </span>
                  </div>

                  {data.reconciliation && data.extractionQuality !== 'unverified' && (
                    <span className="text-[9px] font-bold text-slate-500 tracking-wider">
                      {data.reconciliation.balanceDelta === 0
                        ? 'Zero Tolerance Δ'
                        : `Δ ${fmt(data.reconciliation.balanceDelta, sym)} error`
                      }
                    </span>
                  )}
                </div>
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

        {data.status === 'COMPLETED' && data.isUserRejected && !data.isApproved && (
          <div className="mx-6 mt-4 p-4 bg-amber-50/80 border border-amber-100 rounded-2xl flex items-start gap-4">
            <div className="h-10 w-10 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0 border border-amber-200">
              <IconAlertTriangle size={20} className="text-amber-700" />
            </div>
            <div className="flex-1 space-y-1 py-0.5">
              <h4 className="text-xs font-black text-amber-900 uppercase tracking-tighter">Not accepted</h4>
              <p className="text-[11px] font-bold text-amber-800/80 leading-relaxed max-w-2xl">
                You rejected this extraction. Use <span className="font-black">Re-Ingest</span> to run the AI again on the stored unlocked PDF, or <span className="font-black">Approve</span> if the numbers look correct after review.
              </p>
            </div>
          </div>
        )}

        {data.status === 'FAILED' && (
          <div className="mx-6 mt-4 p-4 bg-red-50/50 border border-red-100 rounded-2xl flex items-start gap-4 animate-in slide-in-from-top-4 duration-500">
            <div className="h-10 w-10 rounded-2xl bg-red-100 flex items-center justify-center shrink-0 border border-red-200">
              <IconAlertTriangle size={20} className="text-red-600" />
            </div>
            <div className="flex-1 space-y-1 py-0.5">
              <h4 className="text-xs font-black text-red-900 uppercase tracking-tighter">AI Extraction Engine Offline</h4>
              <p className="text-[11px] font-bold text-red-600/70 leading-relaxed max-w-2xl">
                The forensic pipeline encountered a blockage: <span className="text-red-700">{data.processingError || "Unknown connection error."}</span>
              </p>
              <div className="flex items-center gap-4 mt-2">
                <button onClick={handleReIngest} className="text-[10px] font-black text-red-600 hover:text-red-800 uppercase tracking-widest flex items-center gap-1.5 transition-colors">
                  <IconReceipt2 size={12} /> Re-Initialize Engine
                </button>
                <span className="h-1 w-1 rounded-full bg-red-200" />
                <p className="text-[9px] font-bold text-red-400 uppercase tracking-widest">
                  Tip: If spending cap is exceeded, wait a few minutes or switch API keys.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="shrink-0 flex items-center gap-1 px-6 py-2 border-b bg-slate-50/50">
          <TabBtn active={tab === 'transactions'} onClick={() => setTab('transactions')} icon={IconReceipt2} label="Transactions" count={txs.length} />
          {emis.length > 0 && (
            <TabBtn active={tab === 'emi'} onClick={() => setTab('emi')} icon={IconCalendar} label="EMI Active" count={emis.length} />
          )}
          {data.rawAIResponse?.type === 'OCR_SPACE_RAW' && (
            <TabBtn active={tab === 'raw_ocr' as any} onClick={() => setTab('raw_ocr' as any)} icon={IconReceipt2} label="Raw OCR" />
          )}
          <TabBtn active={tab === 'overview'} onClick={() => setTab('overview')} icon={IconChartBar} label="Overview" />
          {data.versions && data.versions.length > 0 && (
            <TabBtn active={tab === 'history'} onClick={() => setTab('history')} icon={IconHistory} label="History" count={data.versions.length} />
          )}
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
        {/* ── Tab: Raw OCR ── */}
        {tab === 'raw_ocr' as any && (
          <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 p-6">
            <div className="bg-white rounded-2xl border p-6 shadow-sm overflow-y-auto flex-1">
              <div className="flex items-center justify-between mb-6 sticky top-0 bg-white pb-4 z-10 border-b border-slate-50">
                <div className="space-y-1">
                  <h3 className="text-sm font-black uppercase tracking-widest text-slate-800">Forensic OCR Extraction</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Bypassed Gemini mapping. Viewing raw spatial text.</p>
                </div>

                <div className="flex bg-slate-100 p-1 rounded-xl gap-1 border border-slate-200/50">
                  <button
                    onClick={() => setForensicType('CREDIT_CARD')}
                    className={cn(
                      "px-5 py-1.5 rounded-lg text-[10px] font-black tracking-widest transition-all uppercase",
                      forensicType === 'CREDIT_CARD' ? "bg-white shadow-sm text-slate-900" : "text-slate-400 hover:text-slate-600"
                    )}
                  >
                    Credit Card
                  </button>
                  <button
                    onClick={() => setForensicType('BANK')}
                    className={cn(
                      "px-5 py-1.5 rounded-lg text-[10px] font-black tracking-widest transition-all uppercase",
                      forensicType === 'BANK' ? "bg-white shadow-sm text-slate-900" : "text-slate-400 hover:text-slate-600"
                    )}
                  >
                    Bank Account
                  </button>
                </div>
                <Button
                  size="sm"
                  variant="default"
                  onClick={handleReprocess}
                  disabled={reprocessing}
                  className="gap-2 h-10 px-6 rounded-xl font-bold text-[10px] uppercase tracking-widest bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200"
                >
                  {reprocessing ? <IconLoader2 size={14} className="animate-spin" /> : <IconMath size={14} />}
                  Run Gemini Audit
                </Button>
              </div>

              <div className="space-y-8 mt-4">
                {data.rawAIResponse?.parsedResults?.map((page: any, pi: number) => (
                  <div key={pi} className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-black bg-slate-900 text-white px-3 py-1 rounded-full">PAGE {page.page}</span>
                      <div className="h-px flex-1 bg-slate-100" />
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{page.text?.length || 0} characters</span>
                    </div>
                    <div className="relative group">
                      <pre className="text-[12px] font-mono text-slate-600 bg-slate-50/50 p-6 rounded-2xl border border-slate-100 overflow-x-auto whitespace-pre-wrap leading-relaxed font-medium">
                        {page.text}
                      </pre>
                      <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button size="icon" variant="ghost" className="h-8 w-8 bg-white/80 backdrop-blur" onClick={() => navigator.clipboard.writeText(page.text)}>
                          <IconDownload size={14} className="text-slate-400" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-12 pt-12 border-t border-slate-100 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Neural Injection Vault</h4>
                    <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest leading-none">Bypass AI logic with manual JSON data stream</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowVault(!showVault)}
                    className={cn(
                      "h-9 px-4 rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all",
                      showVault ? "bg-red-50 text-red-500 hover:bg-red-100" : "bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
                    )}
                  >
                    <IconTerminal2 size={14} className="mr-2" />
                    {showVault ? 'Seal Vault' : 'Access Vault'}
                  </Button>
                </div>

                {showVault && (
                  <div className="space-y-4 animate-in slide-in-from-top-4 duration-500">
                    <div className="relative group">
                      <textarea
                        className="w-full h-80 font-mono text-[11px] p-6 bg-slate-900 text-emerald-400 border border-slate-800 rounded-3xl shadow-2xl focus-visible:outline-none focus:ring-2 focus:ring-emerald-500/20 leading-relaxed scrollbar-hide"
                        placeholder='{ "transactions": [...], "reconciliationSummary": {...} }'
                        value={injectedJson}
                        onChange={(e) => setInjectedJson(e.target.value)}
                      />
                      <div className="absolute top-4 right-4 flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                        <div className="text-[9px] font-black uppercase text-emerald-500 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20 backdrop-blur-md">manual/injection-v1</div>
                      </div>
                    </div>
                    <Button
                      onClick={handleInjection}
                      disabled={reprocessing || !injectedJson}
                      className="w-full h-14 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] bg-emerald-600 hover:bg-emerald-700 shadow-xl shadow-emerald-200/50 gap-3 group transition-all active:scale-[0.99]"
                    >
                      {reprocessing ? <IconLoader2 size={18} className="animate-spin" /> : <IconPlayerPlay size={18} className="group-hover:translate-x-1 transition-transform" />}
                      Overwrite Neural State
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

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
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="bg-slate-50/50 p-2 rounded-xl border border-slate-100">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-[0.1em]">Total Tenure</p>
                    <p className="text-xs font-black text-slate-700">{emi.tenure ? `${emi.tenure} months` : '—'}</p>
                  </div>
                  <div className="bg-emerald-50/50 p-2 rounded-xl border border-emerald-100">
                    <p className="text-[8px] font-black text-emerald-500 uppercase tracking-[0.1em]">Paid So Far</p>
                    <p className="text-xs font-black text-emerald-700">{emi.paidInstallments ?? '—'}</p>
                  </div>
                  <div className="bg-amber-50/50 p-2 rounded-xl border border-amber-100">
                    <p className="text-[8px] font-black text-amber-500 uppercase tracking-[0.1em]">Installments Left</p>
                    <p className="text-xs font-black text-amber-700">{emi.remainingInstallments ?? '—'}</p>
                  </div>
                </div>

                {emi.page && (
                  <div className="mt-4 pt-3 border-t border-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-slate-50 text-slate-400 border">Page {emi.page}</span>
                      <span className="text-[9px] text-slate-300">Located on PDF audit</span>
                    </div>
                    {emi.tenure && emi.paidInstallments && (
                      <div className="flex items-center gap-1">
                        <div className="h-1 w-12 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full"
                            style={{ width: `${Math.min(100, (emi.paidInstallments / emi.tenure) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[9px] font-black text-slate-400">{Math.round((emi.paidInstallments / emi.tenure) * 100)}%</span>
                      </div>
                    )}
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
                {!isBank ? [
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
                )) : [
                  { label: 'Opening Balance', value: fmt(data.openingBalance?.val, sym) },
                  { label: 'Total Deposits', value: fmt(data.totalDeposits?.val, sym), color: 'text-emerald-600' },
                  { label: 'Total Withdrawals', value: fmt(data.totalWithdrawals?.val, sym), color: 'text-red-600' },
                  { label: 'Closing Balance', value: fmt(data.closingBalance?.val, sym), color: 'text-slate-900' },
                ].map((item, i) => (
                  <div key={i} className="bg-white border border-slate-100 rounded-xl p-4 space-y-1">
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{item.label}</p>
                    <p className={cn('font-bold text-sm tabular-nums', item.color || 'text-slate-900')}>{item.value}</p>
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
                catMap[t.category || 'Other'] = (catMap[t.category || 'Other'] || 0) + (t.amount || t.withdrawal || 0)
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

        {/* ── Tab: History ── */}
        {tab === 'history' && data && data.versions && (
          <div className="flex-1 overflow-auto p-8 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-400">
            <div>
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter mb-1">Audit Version History</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Historical Snapshots from Re-Ingestion Cycles</p>
            </div>

            <div className="grid gap-4">
              {[...data.versions].reverse().map((ver, idx) => (
                <div key={idx} className="group bg-white border border-slate-100 rounded-3xl p-6 hover:shadow-xl hover:border-slate-200 transition-all border-l-4 border-l-slate-200 hover:border-l-primary">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-slate-300 group-hover:bg-primary transition-colors" />
                        <span className="text-xs font-black text-slate-700">Audit Version #{data.versions!.length - idx}</span>
                        <span className="text-[10px] font-bold text-slate-400 tabular-nums uppercase">
                          {new Date(ver.snapshotAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] ml-4">
                        Engine: <span className="text-slate-600 font-black">{ver.ocrEngine || 'gemini'}</span> • Quality: <span className={cn(
                          ver.extractionQuality === 'verified' ? "text-emerald-600" : "text-amber-600 font-bold"
                        )}>{ver.extractionQuality?.replace('_', ' ')?.toUpperCase()}</span>
                      </p>
                    </div>

                    <div className="flex gap-4">
                      <MetricCard label="Transactions" value={String(ver.transactions?.length || 0)} small />
                      <MetricCard label="Matched" value={ver.reconciliation?.matched ? 'YES' : 'NO'} color={ver.reconciliation?.matched ? 'text-emerald-600' : 'text-red-500'} small />
                    </div>
                  </div>

                  {ver.summary && (
                    <div className="mt-4 p-4 bg-slate-50/50 rounded-2xl border border-slate-100 italic text-[11px] text-slate-500 leading-relaxed line-clamp-2 hover:line-clamp-none transition-all cursor-default">
                      "{ver.summary}"
                    </div>
                  )}

                  <div className="mt-4 flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        window.alert(`Snapshot Sequence ID: VER-${data.versions!.length - idx}\n\nHistorical extraction data for this sequence is archived. You can inspect the 'versions' field in the raw JSON payload if needed.`);
                      }}
                      className="text-[9px] font-bold uppercase tracking-widest text-slate-400 hover:text-primary transition-colors group"
                    >
                      Audit Snapshot Log <IconArrowRight size={12} className="ml-1 translate-x-0 group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
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
      {/* Math Transparency Modal */}
      {showMathDetails && data?.reconciliation && (
        <div className="fixed inset-0 z-[2000] flex items-start justify-end p-12 pr-12 pt-24 animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-transparent" onClick={() => setShowMathDetails(false)} />
          <div className="relative w-full max-w-[34rem] bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl overflow-hidden flex flex-col border border-slate-200 pointer-events-auto">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-xl",
                  data.extractionQuality === 'verified' ? "bg-emerald-100 text-emerald-600" :
                    data.extractionQuality === 'minor_mismatch' ? "bg-amber-100 text-amber-600" :
                      "bg-red-100 text-red-600"
                )}>
                  <IconMath size={20} strokeWidth={2.5} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-800 tracking-tight">Mathematical Proof</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Reconciliation Engine</p>
                </div>
              </div>
              <button onClick={() => setShowMathDetails(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
                <IconX size={20} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-4 text-center relative z-10">
                <div
                  className="flex flex-col gap-1.5 cursor-pointer hover:bg-slate-100 p-2 rounded-xl border border-transparent hover:border-slate-200 transition-all active:scale-95 group"
                  onClick={() => {
                    const field = isBank ? (data.openingBalance || data.reconciliationSummary?.openingBalance) : data.previousBalance;
                    if (field?.box?.length && field.page) {
                      setActiveBox({ box: field.box, page: field.page, id: 'opening' })
                      document.getElementById(`pdf-page-${field.page}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    } else {
                      setToast({ message: "Bounding box not identified for Opening Balance", visible: true, type: 'error' });
                      setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 4000);
                    }
                  }}
                >
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-100 py-0.5 rounded text-[8px] group-hover:bg-slate-200">Printed</span>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest leading-tight mt-1">Opening<br />Balance</span>
                  <span className="text-sm font-black tabular-nums">{fmt(data.reconciliationSummary?.openingBalance || 0, sym)}</span>
                </div>

                <div className="flex items-center justify-center text-slate-300"><IconPlus size={16} /></div>

                <div className="flex flex-col gap-1.5 p-2 border border-dashed border-sky-200 rounded-xl bg-sky-50/50">
                  <span className="text-[10px] font-bold text-sky-400 uppercase tracking-widest bg-sky-100/50 py-0.5 rounded text-[8px]">Calculated</span>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest leading-tight mt-1">Extracted<br />{isBank ? 'Deposits' : 'Debits'}</span>
                  <span className={cn("text-sm font-black tabular-nums", isBank ? "text-emerald-600" : "text-red-600")}>
                    {fmt(isBank ? (data.reconciliation.extractedDeposits || 0) : (data.reconciliation.extractedDebits || 0), sym)}
                  </span>
                </div>

                <div className="flex items-center justify-center text-slate-300"><IconMinus size={16} /></div>

                <div className="flex flex-col gap-1.5 p-2 border border-dashed border-orange-200 rounded-xl bg-orange-50/50">
                  <span className="text-[10px] font-bold text-orange-400 uppercase tracking-widest bg-orange-100/50 py-0.5 rounded text-[8px]">Calculated</span>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest leading-tight mt-1">Extracted<br />{isBank ? 'Withdrawals' : 'Credits'}</span>
                  <span className={cn("text-sm font-black tabular-nums", isBank ? "text-red-600" : "text-emerald-600")}>
                    {fmt(isBank ? (data.reconciliation.extractedWithdrawals || 0) : (data.reconciliation.extractedCredits || 0), sym)}
                  </span>
                </div>
              </div>

              <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 flex items-center justify-between shadow-inner">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest shrink-0">Calculated Net</span>
                  <span className="text-xl font-black tabular-nums text-slate-800">{fmt(data.reconciliation.calculatedClosing || 0, sym)}</span>
                </div>

                <div className="flex justify-center text-slate-300 shrink-0"><IconEqual size={24} /></div>

                <div
                  className="flex flex-col gap-1 text-right cursor-pointer hover:bg-slate-200/50 p-2 -my-2 -mr-2 rounded-xl transition-all active:scale-95"
                  onClick={() => {
                    const field = isBank ? (data.closingBalance || data.outstandingTotal) : data.outstandingTotal;
                    if (field?.box?.length && field.page) {
                      setActiveBox({ box: field.box, page: field.page, id: 'closing' })
                      document.getElementById(`pdf-page-${field.page}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    } else {
                      setToast({ message: "Bounding box not identified for Closing Balance", visible: true, type: 'error' });
                      setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 4000);
                    }
                  }}
                >
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest shrink-0 bg-slate-200/50 px-2 py-0.5 rounded inline-flex self-end items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> Printed PDF Box</span>
                  <span className={cn("text-xl font-black tabular-nums",
                    data.reconciliation.matched ? "text-emerald-500" :
                      data.reconciliation.balanceDelta < 10 ? "text-amber-500" : "text-red-500"
                  )}>
                    {fmt(data.reconciliation.expectedClosing || 0, sym)}
                  </span>
                </div>
              </div>

              <div className={cn("px-5 py-3 rounded-xl flex items-center justify-between border",
                data.reconciliation.matched ? "bg-emerald-50 border-emerald-100" :
                  data.reconciliation.balanceDelta < 10 ? "bg-amber-50 border-amber-100" : "bg-red-50 border-red-100"
              )}>
                <span className={cn("text-xs font-bold",
                  data.reconciliation.matched ? "text-emerald-800" :
                    data.reconciliation.balanceDelta < 10 ? "text-amber-800" : "text-red-800"
                )}>
                  {data.reconciliation.matched ? "Extraction mathematically flawless." : `Discrepancy of ${fmt(data.reconciliation.balanceDelta, sym)} detected.`}
                </span>
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest bg-white/50 px-2 py-1 rounded-lg">
                  {data.reconciliation.transactionCount} Extracted
                </span>
              </div>

              {data.reconciliation.reasons && data.reconciliation.reasons.length > 0 && (
                <div className="bg-red-50/50 border border-red-100/50 rounded-2xl p-5 space-y-3 mt-4">
                  <div className="flex items-center gap-1.5">
                    <IconAlertTriangle size={14} className="text-red-500" />
                    <span className="text-[10px] font-black text-red-600 uppercase tracking-widest">Diagnostic Findings</span>
                  </div>
                  <ul className="space-y-2">
                    {data.reconciliation.reasons.map((reason, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs font-semibold text-slate-600 leading-tight">
                        <span className="h-1 w-2 rounded-full bg-red-400 mt-1.5 shrink-0" />
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {Array.isArray(data.rawAIResponse?.calculationChecker?.why) && data.rawAIResponse.calculationChecker.why.length > 0 && (
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-3 mt-4">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Why this matches (or not)</p>
                  <ul className="space-y-2">
                    {data.rawAIResponse.calculationChecker.why.map((line: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-xs font-semibold text-slate-600 leading-tight">
                        <span className="h-1 w-2 rounded-full bg-primary/60 mt-1.5 shrink-0" />
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Raw JSON Overlay Modal */}
      {showRawJson && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center p-6 sm:p-12">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setShowRawJson(false)} />
          <div className="relative w-full max-w-5xl h-full max-h-[85vh] bg-[#0d1117] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col border border-white/10 animate-in fade-in zoom-in-95 duration-300">
            <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between shrink-0 bg-slate-900">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <IconMath size={20} className="text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-white uppercase tracking-tight">Neural Raw Capture</h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Gemini 2.5 Flash Lite Production Payload</p>
                </div>
              </div>
              <button onClick={() => setShowRawJson(false)} className="h-10 w-10 flex items-center justify-center rounded-full hover:bg-white/10 text-slate-400 transition-colors">
                <IconX size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-8 font-mono text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap">
              {data.rawAIResponse ? JSON.stringify(data.rawAIResponse, null, 2) : "No raw response stored for this record."}
            </div>

            <div className="px-8 py-4 bg-slate-900/50 border-t border-white/5 flex items-center justify-between shrink-0">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.2em]">Source: Structured Extraction v2.5 (Authenticated)</p>
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl border-white/10 text-white hover:bg-white/5"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(data.rawAIResponse, null, 2));
                  setToast({ message: "Payload copied to clipboard", visible: true, type: 'success' });
                  setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 3000);
                }}
              >
                Copy JSON
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Statement
