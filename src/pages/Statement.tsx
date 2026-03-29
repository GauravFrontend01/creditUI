import React, { useState, useEffect, useRef } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { IconDownload, IconCheck, IconArrowLeft, IconFileOff } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import axios from "axios"

import * as pdfjsLib from "pdfjs-dist"

// Ensure worker is set up for PDF rendering
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url"
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

export default function Statement() {
  const [extraction, setExtraction] = useState<any>(null)
  const [pdfName, setPdfName] = useState("")
  const [activeBox, setActiveBox] = useState<{ box: number[], page: number, id: string | number } | null>(null)
  const [pages, setPages] = useState<string[]>([])
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [linePath, setLinePath] = useState<string>("")
  const [isSavedView, setIsSavedView] = useState(false)
  
  const { id } = useParams()
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)
  const pdfPaneRef = useRef<HTMLDivElement>(null)
  const tablePaneRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fetchData = async () => {
      if (id) {
        // Saved Statement View
        try {
          setIsSavedView(true)
          const response = await axios.get(`/api/statements/${id}`)
          const data = response.data
          setExtraction(data)
          setPdfName(data.bankName || "Saved Statement")
          
          // Load PDF from Supabase Storage URL if available
          if (data.pdfStorageUrl) {
            loadPdfFromUrl(data.pdfStorageUrl, data.pdfPassword || "")
          }
        } catch (err) {
          console.error("Failed to fetch statement detail", err)
          navigate("/statements")
        }
      } else {
        // Fresh Analysis View (from session)
        const rawResult = sessionStorage.getItem("extraction_result")
        const rawName = sessionStorage.getItem("pdf_raw_name")
        const pdfBase64 = sessionStorage.getItem("pdf_base64")
        const pdfPassword = sessionStorage.getItem("pdf_password")
        
        if (rawResult && pdfBase64) {
          setExtraction(JSON.parse(rawResult))
          setPdfName(rawName || "statement.pdf")
          // Fresh view: base64 data URL from sessionStorage
          loadPdfFromBase64(pdfBase64, pdfPassword || "")
        } else {
          navigate("/")
        }
      }
    }
    
    fetchData()
  }, [id, navigate])

  // Shared PDF renderer — accepts an ArrayBuffer
  const renderPdfBuffer = async (buffer: ArrayBuffer, password?: string) => {
    setLoadingPdf(true)
    try {
      const loadingTask = pdfjsLib.getDocument({ data: buffer, password: password || '' })
      const pdf = await loadingTask.promise
      const renderedPages: string[] = []
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const viewport = page.getViewport({ scale: 1.5 })
        const canvas = document.createElement("canvas")
        const context = canvas.getContext("2d")!
        canvas.height = viewport.height
        canvas.width = viewport.width
        await page.render({ canvasContext: context, viewport: viewport } as any).promise
        renderedPages.push(canvas.toDataURL())
      }
      setPages(renderedPages)
    } catch (err) {
      console.error("PDF render failed", err)
    } finally {
      setLoadingPdf(false)
    }
  }

  // For saved view: fetch from Supabase URL then render
  const loadPdfFromUrl = async (url: string, password?: string) => {
    try {
      const res = await fetch(url)
      const buffer = await res.arrayBuffer()
      await renderPdfBuffer(buffer, password)
    } catch (err) {
      console.error("PDF fetch from URL failed", err)
      setLoadingPdf(false)
    }
  }

  // For fresh view: base64 data URL → ArrayBuffer
  const loadPdfFromBase64 = async (base64DataUrl: string, password?: string) => {
    try {
      const base64 = base64DataUrl.split(',')[1]
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      await renderPdfBuffer(bytes.buffer, password)
    } catch (err) {
      console.error("PDF base64 decode failed", err)
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

  const handleApprove = async () => {
    try {
      // Retrieve PDF binary from sessionStorage (stored as base64 data URL)
      const pdfBase64DataUrl = sessionStorage.getItem("pdf_base64")
      const pdfPassword = sessionStorage.getItem("pdf_password") || ""
      const rawName = sessionStorage.getItem("pdf_raw_name") || "statement.pdf"

      if (!pdfBase64DataUrl) {
        throw new Error("PDF not found in session. Please re-upload the file.")
      }

      // Convert base64 data URL → Blob → File
      const base64 = pdfBase64DataUrl.split(',')[1]
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const pdfBlob = new Blob([bytes], { type: 'application/pdf' })
      const pdfFile = new File([pdfBlob], rawName, { type: 'application/pdf' })

      // Send as multipart/form-data — NO base64 in JSON body
      const formData = new FormData()
      formData.append('pdf', pdfFile)
      formData.append('data', JSON.stringify(extraction))
      formData.append('pdfPassword', pdfPassword)

      await axios.post("/api/statements", formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      navigate("/statements")
    } catch (err: any) {
      console.error("Failed to approve statement", err)
      alert("Failed to save statement: " + (err.message || "Please try again."))
    }
  };

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
           <div className="flex gap-4 items-center">
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-slate-400 hover:text-slate-900"
                onClick={() => navigate(isSavedView ? "/statements" : "/")}
              >
                <IconArrowLeft size={18} />
              </Button>
              <div className="h-4 w-[1px] bg-slate-200 mx-1" />
              <span className="text-[11px] font-bold text-slate-800 tracking-tight flex items-center gap-2">
                 <IconCheck className={cn(isSavedView ? "text-green-500" : "text-primary")} size={16} /> 
                 {isSavedView ? "AUDIT ARCHIVED" : "DATA VERIFIED"}
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
            <div className="p-8 space-y-6 flex flex-col items-center min-h-full">
                {isSavedView && loadingPdf ? (
                    <div className="flex flex-col items-center justify-center py-40 gap-3">
                        <div className="h-10 w-10 border-2 border-primary/20 border-t-primary animate-spin rounded-full" />
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Fetching & Decrypting PDF...</p>
                    </div>
                ) : isSavedView && pages.length === 0 ? (
                   <div className="flex-1 flex flex-col items-center justify-center py-40 gap-4 text-center opacity-40">
                       <div className="h-20 w-20 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                         <IconFileOff size={40} />
                       </div>
                       <div className="space-y-1">
                         <p className="text-sm font-bold text-slate-900 uppercase tracking-widest">PDF Could Not Be Loaded</p>
                         <p className="text-xs font-semibold text-slate-500 max-w-[240px]">
                           The stored PDF URL may have expired or Supabase storage is misconfigured.
                         </p>
                       </div>
                   </div>
                ) : loadingPdf ? (
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
                   <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                      {isSavedView ? "Audit History" : "Spatial Data Audit"}
                   </h2>
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
                    {!isSavedView && <PrimaryApproveButton onApprove={handleApprove} />}
                </div>
             </div>
          </div>
      </div>
    </div>
  )
}

function PrimaryApproveButton({ onApprove }: { onApprove: () => void }) {
  const [loading, setLoading] = React.useState(false);
  
  const handleClick = async () => {
    setLoading(true);
    await onApprove();
    setLoading(false);
  };

  return (
    <Button 
      onClick={handleClick}
      disabled={loading}
      className="h-12 px-10 font-bold text-sm uppercase tracking-wide rounded-lg shadow-sm"
    >
      {loading ? "Saving..." : "Approve Report"}
    </Button>
  );
}
