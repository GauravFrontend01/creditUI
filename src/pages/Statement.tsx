import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { IconDownload, IconCheck } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"

import * as pdfjsLib from "pdfjs-dist"

// Ensure worker is set up for PDF rendering
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url"
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

export default function Statement() {
  const [extraction, setExtraction] = React.useState<any>(null)
  const [pdfName, setPdfName] = React.useState("")
  const [activeBox, setActiveBox] = React.useState<{ box: number[], page: number, id: string | number } | null>(null)
  const [pages, setPages] = React.useState<string[]>([])
  const [loadingPdf, setLoadingPdf] = React.useState(true)
  const [linePath, setLinePath] = React.useState<string>("")
  
  const navigate = useNavigate()
  const rootRef = React.useRef<HTMLDivElement>(null)
  const pdfPaneRef = React.useRef<HTMLDivElement>(null)
  const tablePaneRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const rawResult = sessionStorage.getItem("extraction_result")
    const rawName = sessionStorage.getItem("pdf_raw_name")
    const pdfBase64 = sessionStorage.getItem("pdf_base64")
    const pdfPassword = sessionStorage.getItem("pdf_password")
    
    if (rawResult && pdfBase64) {
      setExtraction(JSON.parse(rawResult))
      setPdfName(rawName || "statement.pdf")
      loadPdf(pdfBase64, pdfPassword || "")
    } else {
      navigate("/")
    }
  }, [navigate])

  const loadPdf = async (base64: string, password?: string) => {
    try {
      setLoadingPdf(true)
      const loadingTask = pdfjsLib.getDocument({ 
        url: base64, 
        password: password 
      })
      const pdf = await loadingTask.promise
      const renderedPages: string[] = []
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const viewport = page.getViewport({ scale: 1.5 }) 
        const canvas = document.createElement("canvas")
        const context = canvas.getContext("2d")!
        canvas.height = viewport.height
        canvas.width = viewport.width
        
        await page.render({ 
          canvasContext: context, 
          viewport: viewport 
        } as any).promise
        renderedPages.push(canvas.toDataURL())
      }
      setPages(renderedPages)
      setLoadingPdf(false)
    } catch (err) {
      console.error("PDF load failed in Statement view", err)
      setLoadingPdf(false)
    }
  }

  // Calculate the Zig-Zag path between table row and PDF highlight
  React.useEffect(() => {
    if (!activeBox || loadingPdf) {
      setLinePath("")
      return
    }

    const updatePath = () => {
      const rowId = `table-row-${activeBox.id}`
      const highlightId = `pdf-highlight`
      const rowEl = document.getElementById(rowId)
      const highlightEl = document.getElementById(highlightId)
      const containerEl = rootRef.current

      if (rowEl && highlightEl && containerEl) {
        const rootRect = containerEl.getBoundingClientRect()
        const rowRect = rowEl.getBoundingClientRect()
        const highlightRect = highlightEl.getBoundingClientRect()

        // Start from middle-left of the row (or where it meets the divider)
        const sx = rowRect.left - rootRect.left
        const sy = rowRect.top - rootRect.top + (rowRect.height / 2)

        // End at middle-right of the highlight box
        const ex = highlightRect.right - rootRect.left
        const ey = highlightRect.top - rootRect.top + (highlightRect.height / 2)

        // Generate Zig-Zag path
        const midX = (sx + ex) / 2
        // Path: Move to row, line to mid, zig-zag, to highlight
        const path = `M ${sx} ${sy} L ${midX + 20} ${sy} L ${midX - 20} ${ey} L ${ex} ${ey}`
        setLinePath(path)
      } else {
        setLinePath("")
      }
    }

    // Update on scroll or resize
    const pdfPane = pdfPaneRef.current
    const tablePane = tablePaneRef.current
    
    updatePath() // initial
    pdfPane?.addEventListener('scroll', updatePath, { passive: true })
    tablePane?.addEventListener('scroll', updatePath, { passive: true })
    window.addEventListener('scroll', updatePath, { passive: true }) // Capture window scrolls too
    window.addEventListener('resize', updatePath)

    return () => {
      pdfPane?.removeEventListener('scroll', updatePath)
      tablePane?.removeEventListener('scroll', updatePath)
      window.removeEventListener('scroll', updatePath)
      window.removeEventListener('resize', updatePath)
    }
  }, [activeBox, loadingPdf, pages])

  if (!extraction) return null

  const transactions = extraction.transactions || []
  
  const getCurrencySymbol = (code: string) => {
    switch (code?.toUpperCase()) {
      case 'INR': return '₹';
      case 'USD': return '$';
      case 'GBP': return '£';
      case 'EUR': return '€';
      default: return code || '';
    }
  }

  const currencySymbol = getCurrencySymbol(extraction.currency);
  
  const metrics = [
    { label: "Credit Limit", value: extraction.creditLimit?.val, box: extraction.creditLimit?.box, page: extraction.creditLimit?.page, id: 'limit' },
    { label: "Statement Balance", value: extraction.outstandingTotal?.val, box: extraction.outstandingTotal?.box, page: extraction.outstandingTotal?.page, id: 'outstanding' },
    { label: "Min Amount Due", value: extraction.minPaymentDue?.val, box: extraction.minPaymentDue?.box, page: extraction.minPaymentDue?.page, id: 'min-due' },
  ].filter(m => m.value !== undefined)

  const handleRowClick = (item: any, id: string | number) => {
    if (item.box && item.page) {
      setActiveBox({ box: item.box, page: item.page, id })
      const pageEl = document.getElementById(`pdf-page-${item.page}`)
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }

  return (
    <div className="flex w-full h-full bg-slate-50 overflow-hidden font-sans relative" ref={rootRef}>
      {/* Dynamic Connector SVG */}
      {linePath && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-[100] animate-in fade-in duration-300">
           <path 
             d={linePath} 
             fill="none" 
             stroke="#ef4444" 
             strokeWidth="2" 
             className="opacity-80 drop-shadow-sm"
           />
        </svg>
      )}

      {/* Left Pane: PDF Viewer */}
      <div className="w-1/2 flex flex-col border-r bg-slate-200/50 relative overflow-hidden h-full shrink-0">
        {/* Simple Toolbar */}
        <div className="h-14 bg-white border-b px-6 flex items-center justify-between shrink-0">
           <div className="flex gap-4">
              <span className="text-[11px] font-bold text-slate-800 tracking-tight flex items-center gap-2">
                 <IconCheck className="text-primary" size={16} /> DATA VERIFIED
              </span>
           </div>
           <div className="text-[12px] font-medium text-slate-500 truncate max-w-[240px]">
              {pdfName}
           </div>
           <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-primary">
              <IconDownload size={16} />
           </Button>
        </div>
        
        <div className="flex-1 overflow-y-auto" ref={pdfPaneRef}>
            <div className="p-8 space-y-6 flex flex-col items-center">
                {loadingPdf ? (
                    <div className="flex flex-col items-center justify-center py-40 gap-3">
                        <div className="h-10 w-10 border-2 border-primary/20 border-t-primary animate-spin rounded-full" />
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Rendering Pages...</p>
                    </div>
                ) : (
                    pages.map((img, i) => (
                        <div 
                          key={i} 
                          id={`pdf-page-${i + 1}`}
                          className="relative shadow-md border bg-white animate-in fade-in duration-500"
                        >
                            <img src={img} className="max-w-full h-auto block" alt={`Page ${i + 1}`} />
                            {activeBox && activeBox.page === (i + 1) && (
                                <div 
                                    id="pdf-highlight"
                                    className="absolute ring-2 ring-amber-500 bg-yellow-400/30 shadow-[0_0_10px_rgba(234,179,8,0.3)] animate-pulse"
                                    style={{
                                        top: `${(activeBox.box[0] / 1000) * 100}%`,
                                        left: `${(activeBox.box[1] / 1000) * 100}%`,
                                        height: `${((activeBox.box[2] - activeBox.box[0]) / 1000) * 100}%`,
                                        width: `${((activeBox.box[3] - activeBox.box[1]) / 1000) * 100}%`
                                    }}
                                />
                            )}
                            <div className="absolute top-4 right-4 bg-slate-900/10 text-slate-500 text-[10px] px-2 py-1 rounded font-bold">
                                PAGE {i + 1}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
      </div>

      {/* Right Pane: Table Console */}
      <div className="w-1/2 flex flex-col bg-white overflow-hidden h-full">
          <div className="p-8 border-b space-y-8 bg-white shrink-0">
             <div className="flex items-center justify-between">
                <div>
                   <h2 className="text-2xl font-bold tracking-tight text-slate-900">Spatial Data Audit</h2>
                   <p className="text-xs font-semibold text-slate-400 mt-0.5 uppercase tracking-wide">Statement Transaction Log</p>
                </div>
                <div className="flex gap-8">
                    {metrics.map((m, i) => (
                        <div 
                          key={i} 
                          id={`table-row-${m.id}`}
                          className="text-right cursor-pointer group" 
                          onClick={() => handleRowClick(m, m.id)}
                        >
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide truncate">{m.label}</p>
                            <p className="text-lg font-bold text-slate-900 tabular-nums tracking-tight">
                                {currencySymbol}{m.value.toLocaleString()}
                            </p>
                        </div>
                    ))}
                </div>
             </div>
          </div>
          
          <div className="flex-1 overflow-y-auto" ref={tablePaneRef}>
            <Table>
                <TableHeader className="bg-white sticky top-0 z-10">
                    <TableRow className="border-b-2 hover:bg-transparent h-10">
                        <TableHead className="w-[80px] text-[10px] font-bold text-slate-400 uppercase pl-8">Date</TableHead>
                        <TableHead className="text-[10px] font-bold text-slate-400 uppercase">Description / Purpose</TableHead>
                        <TableHead className="text-right text-[10px] font-bold text-slate-400 uppercase pr-8">Amount ({extraction.currency || 'USD'})</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                {transactions.length > 0 ? transactions.map((row: any, idx: number) => {
                    const isSelected = activeBox?.id === idx
                    return (
                        <TableRow 
                          key={idx} 
                          id={`table-row-${idx}`}
                          onClick={() => handleRowClick(row, idx)}
                          className={cn(
                            "cursor-pointer transition-colors h-14",
                            isSelected ? "bg-slate-100" : "hover:bg-slate-50 border-b border-slate-100"
                          )}
                        >
                            <TableCell className="font-medium text-slate-400 text-[11px] tabular-nums pl-8">
                                {row.date}
                            </TableCell>
                            <TableCell>
                                <p className="font-bold text-sm text-slate-800 uppercase tracking-tight truncate max-w-[300px]">
                                    {row.description}
                                </p>
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                                    {row.type} • Page {row.page}
                                </p>
                            </TableCell>
                            <TableCell className={cn(
                                "text-right font-bold tabular-nums pr-8", 
                                row.type === "Debit" ? "text-slate-900" : "text-green-600"
                            )}>
                                {row.amount ? `${row.type === 'Debit' ? '-' : '+'}${currencySymbol}${row.amount.toLocaleString(undefined, {minimumFractionDigits: 2})}` : "—"}
                            </TableCell>
                        </TableRow>
                    )
                }) : (
                    <TableRow>
                        <TableCell colSpan={3} className="h-40 text-center text-slate-300 font-bold uppercase text-xs">
                           No data found
                        </TableCell>
                    </TableRow>
                )}
                </TableBody>
            </Table>
          </div>
          
          <div className="px-8 py-6 bg-white border-t shrink-0">
             <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Total Audited Balance</p>
                    <p className="text-2xl font-bold text-slate-900 tracking-tighter tabular-nums">
                        {currencySymbol}{transactions.reduce((acc: number, t: any) => acc + (t.type === 'Credit' ? t.amount : -t.amount), 0).toLocaleString(undefined, {minimumFractionDigits: 2})}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" className="h-12 px-6 font-bold text-xs uppercase tracking-wide rounded-lg">
                        Flag Entry
                    </Button>
                    <Button className="h-12 px-10 font-bold text-sm uppercase tracking-wide rounded-lg shadow-sm">
                        Approve Report
                    </Button>
                </div>
             </div>
          </div>
      </div>
    </div>
  )
}
