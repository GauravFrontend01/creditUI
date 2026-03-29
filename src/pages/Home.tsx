import React, { useState, useEffect, useRef } from "react"
import { IconUpload, IconFileTypePdf, IconRocket, IconLoader2, IconSparkles, IconScan, IconDatabase, IconCheck, IconLock, IconSettings, IconDeviceFloppy } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { useNavigate } from "react-router-dom"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/Switch"

import * as pdfjsLib from "pdfjs-dist"
import { GoogleGenerativeAI } from "@google/generative-ai"

// Set up PDF.js worker using Vite's ?url import for reliable local worker loading
// @ts-ignore - this is a vite-specific import
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url"
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || ""
const ai = new GoogleGenerativeAI(API_KEY)

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const [password, setPassword] = useState("260703835732")
  const [errorHeader, setErrorHeader] = useState("")
  const [useLiveApi, setUseLiveApi] = useState(false)
  const [lastApiResult, setLastApiResult] = useState<any>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const extractionSteps = [
    { label: "Rendering PDF pages to images...", icon: IconScan },
    { label: "Performing Multi-modal OCR...", icon: IconLoader2 },
    { label: "Identifying spend categories...", icon: IconDatabase },
    { label: "Verifying merchant data units...", icon: IconSparkles },
    { label: "Constructing audit table...", icon: IconCheck },
  ]

  const promptText = `Analyze this credit card statement image carefully. YOU MUST EXTRACT EVERY SINGLE TRANSACTION FROM EVERY SINGLE PAGE. DO NOT SKIP ANY DATA.

For every extracted field, provide bounding box coords [ymin, xmin, ymax, xmax] 
in normalized scale [0-1000] and the page number.

Identify the primary currency used in the statement (e.g., INR, USD, GBP, EUR).
Return the currency as an ISO code.

Categorize each transaction into one of: 
Food, Travel, Shopping, Entertainment, Utilities, Healthcare, 
Fuel, EMI, Subscription, Forex, Fee, Cashback, Other.

Mark isRecurring: true if the merchant appears more than once OR if it looks 
like a subscription (Netflix, Spotify, insurance, etc).

Mark isForex: true if the transaction involves a foreign currency or 
international merchant.

Return ONLY valid JSON in this exact structure:
{
  "currency": string,
  "creditLimit": { "val": number, "box": [], "page": number },
  "availableLimit": { "val": number, "box": [], "page": number },
  "outstandingTotal": { "val": number, "box": [], "page": number },
  "minPaymentDue": { "val": number, "box": [], "page": number },
  "paymentDueDate": { "val": string, "box": [], "page": number },
  "statementDate": { "val": string, "box": [], "page": number },
  "statementPeriod": { "from": string, "to": string, "box": [], "page": number },

  "previousBalance": { "val": number, "box": [], "page": number },
  "lastPaymentAmount": { "val": number, "box": [], "page": number },
  "lastPaymentDate": { "val": string, "box": [], "page": number },

  "totalDebits": { "val": number, "box": [], "page": number },
  "totalCredits": { "val": number, "box": [], "page": number },
  "totalInterestCharged": { "val": number, "box": [], "page": number },
  "totalLateFee": { "val": number, "box": [], "page": number },
  "totalForexFee": { "val": number, "box": [], "page": number },
  "totalFees": { "val": number, "box": [], "page": number },
  "cashAdvance": { "amount": number, "fee": number, "box": [], "page": number },
  "isRevolvingBalance": { "val": boolean },

  "rewardPointsEarned": { "val": number, "box": [], "page": number },
  "rewardPointsRedeemed": { "val": number, "box": [], "page": number },
  "rewardPointsBalance": { "val": number, "box": [], "page": number },
  "rewardPointsExpiry": { "val": string, "box": [], "page": number },

  "transactions": [{
    "date": string,
    "description": string,
    "merchantName": string,
    "amount": number,
    "type": "Debit" | "Credit",
    "category": string,
    "isRecurring": boolean,
    "isForex": boolean,
    "box": [],
    "page": number
  }],

  "emiList": [{
    "name": string,
    "amount": number,
    "box": [],
    "page": number
  }],

  "reconciliation": string,
  "summary": string
}`;

  const defaultDummyData = {
    "currency": "INR",
    "creditLimit": { "val": 85000.0, "box": [227, 138, 235, 198], "page": 1 },
    "availableLimit": { "val": 39899.81, "box": [322, 638, 333, 690], "page": 1 },
    "outstandingTotal": { "val": 45100.19, "box": [785, 805, 794, 877], "page": 1 },
    "minPaymentDue": { "val": 4642.74, "box": [52, 842, 61, 892], "page": 1 },
    "paymentDueDate": { "val": "09 APR 2026", "box": [52, 623, 62, 703], "page": 1 },
    "statementDate": { "val": "22 MAR 2026", "box": [91, 656, 100, 737], "page": 1 },
    "statementPeriod": { "from": "23 FEB 2026", "to": "22 MAR 2026", "box": [91, 563, 101, 737], "page": 1 },
    "previousBalance": { "val": 41640.16, "box": [785, 121, 794, 181], "page": 1 },
    "lastPaymentAmount": { "val": 4400.0, "box": [348, 640, 357, 691], "page": 1 },
    "lastPaymentDate": { "val": "08 MAR", "box": [346, 51, 357, 94], "page": 1 },
    "totalDebits": { "val": 11944.52, "box": [785, 353, 794, 408], "page": 1 },
    "totalCredits": { "val": 8484.49, "box": [785, 588, 794, 638], "page": 1 },
    "totalInterestCharged": { "val": 809.0, "box": [471, 658, 480, 697], "page": 3 },
    "totalLateFee": { "val": 0.0, "box": [], "page": 3 },
    "totalForexFee": { "val": 0.0, "box": [], "page": 3 },
    "totalFees": { "val": 145.62, "box": [483, 658, 492, 691, 496, 658, 504, 691], "page": 3 },
    "cashAdvance": { "amount": 0.0, "fee": 0.0, "box": [549, 658, 558, 691], "page": 3 },
    "isRevolvingBalance": { "val": true },
    "rewardPointsEarned": { "val": 66.0, "box": [841, 405, 851, 433], "page": 1 },
    "rewardPointsRedeemed": { "val": 0.0, "box": [841, 558, 851, 585], "page": 1 },
    "rewardPointsBalance": { "val": 1037.0, "box": [841, 705, 851, 746], "page": 1 },
    "rewardPointsExpiry": { "val": null, "box": [], "page": 1 },
    "transactions": [
      {
        "date": "22 FEB",
        "description": "BUNDL TECHNOLOGIES BENGALURU IN",
        "merchantName": "Swiggy",
        "amount": 548.0,
        "type": "Debit",
        "category": "Food",
        "isRecurring": true,
        "isForex": false,
        "box": [400, 51, 410, 691],
        "page": 1
      },
      {
        "date": "25 FEB",
        "description": "SHIROLE BROS PUNE IN",
        "merchantName": "Shirole Bros",
        "amount": 404.72,
        "type": "Debit",
        "category": "Other",
        "isRecurring": true,
        "isForex": false,
        "box": [425, 51, 436, 691],
        "page": 1
      },
      {
        "date": "22 MAR",
        "description": "Makemytrip India Pvt Lt CC26081201838 PRINCIPAL",
        "merchantName": "Makemytrip",
        "amount": 891.0,
        "type": "Debit",
        "category": "EMI",
        "isRecurring": true,
        "isForex": false,
        "box": [571, 51, 594, 715],
        "page": 2
      }
    ],
    "emiList": [
      {
        "name": "Makemytrip India Pvt Ltd",
        "amount": 924.83,
        "box": [76, 61, 87, 924],
        "page": 4
      }
    ],
    "reconciliation": "Statement reconciled.",
    "summary": "Monthly credit audit cycle completed."
  }

  const [isReadingFile, setIsReadingFile] = useState(false)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setSelectedFile(file)
      setIsReadingFile(true)
      try {
        const arrayBuffer = await file.arrayBuffer()
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
        await loadingTask.promise
        setIsReadingFile(false)
      } catch (err: any) {
        setIsReadingFile(false)
        if (err.name === "PasswordException") {
          setShowPasswordDialog(true)
        }
      }
    }
  }

  const convertPdfToImages = async (file: File, pdfPassword?: string) => {
    const arrayBuffer = await file.arrayBuffer()
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, password: pdfPassword })
    const pdf = await loadingTask.promise
    const imagesForAI: any[] = []
    const numPages = pdf.numPages

    for (let i = 1; i <= numPages; i++) {
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

      imagesForAI.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
        }
      })
    }
    return imagesForAI
  }

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const startExtraction = async (pdfPassword?: string) => {
    if (!selectedFile) return
    setIsExtracting(true)
    setCurrentStep(0)
    setErrorHeader("")
    
    try {
      // 1. Convert PDF to images for AI
      const imagesForAI = await convertPdfToImages(selectedFile, pdfPassword)
      
      // 2. Read full PDF as base64 for later storage
      const pdfBase64 = await readFileAsBase64(selectedFile)
      
      let finalResponse: any = null

      if (useLiveApi) {
        setCurrentStep(1)
        const model = ai.getGenerativeModel({ model: "gemini-3-flash-preview" })
        const result = await model.generateContent([...imagesForAI, { text: promptText }])
        const responseText = result.response.text()
        
        try {
          const jsonMatch = responseText.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            finalResponse = JSON.parse(jsonMatch[0])
            setLastApiResult(finalResponse)
          }
        } catch (e) {
          console.error("JSON parse failed", responseText)
          throw new Error("AI returned invalid JSON structure")
        }
      } else {
        setCurrentStep(1)
        await new Promise(resolve => setTimeout(resolve, 1500))
        const savedDummy = localStorage.getItem("custom_dummy_data")
        finalResponse = savedDummy ? JSON.parse(savedDummy) : defaultDummyData
      }

      for (let i = 2; i < extractionSteps.length; i++) {
        setCurrentStep(i)
        await new Promise(resolve => setTimeout(resolve, 800))
      }

      // Save all to session for the result page
      sessionStorage.setItem("extraction_result", JSON.stringify(finalResponse))
      sessionStorage.setItem("pdf_raw_name", selectedFile.name)
      sessionStorage.setItem("pdf_password", pdfPassword || "")
      sessionStorage.setItem("pdf_base64", pdfBase64)
      
      navigate("/statement")
      
    } catch (err: any) {
      console.error(err)
      setIsExtracting(false)
      setErrorHeader("Extraction failed. " + (err.message || ""))
    }
  }

  const saveAsDummy = () => {
    if (lastApiResult) {
      localStorage.setItem("custom_dummy_data", JSON.stringify(lastApiResult))
      alert("Current API response saved as new dummy data!")
    }
  }

  const triggerUpload = () => {
    fileInputRef.current?.click()
  }

  const handlePasswordSubmit = () => {
    setShowPasswordDialog(false)
    startExtraction(password)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-gradient-to-b from-slate-50 to-white animate-in fade-in transition-all duration-700 overflow-hidden font-sans">
      <div className="max-w-2xl w-full">
        {/* API Control Toggle */}
        <div className="flex justify-center mb-10">
          <div className="bg-slate-100/50 backdrop-blur-sm p-1.5 rounded-2xl border flex items-center gap-4 px-5">
            <div className="flex items-center gap-2">
              <IconSettings size={16} className="text-slate-400" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Model Source</span>
            </div>
            <div className="flex items-center gap-3">
              <span className={cn("text-[11px] font-bold transition-colors", !useLiveApi ? "text-primary" : "text-slate-400")}>MOCK</span>
              <Switch
                checked={useLiveApi}
                onCheckedChange={setUseLiveApi}
                className="data-[state=checked]:bg-primary"
              />
              <span className={cn("text-[11px] font-bold transition-colors", useLiveApi ? "text-primary" : "text-slate-400")}>LIVE GEMINI</span>
            </div>
            {lastApiResult && (
              <Button variant="ghost" size="sm" onClick={saveAsDummy} className="h-7 text-[10px] font-bold px-3 gap-1.5 rounded-lg hover:bg-white transition-all text-primary">
                <IconDeviceFloppy size={14} /> USE AS DUMMY
              </Button>
            )}
          </div>
        </div>

        <header className="space-y-4 mb-12 text-center">
          <div className="flex justify-center mb-6">
            <div className="h-16 w-16 rounded-3xl bg-primary/10 flex items-center justify-center text-primary shadow-sm ring-1 ring-primary/20">
              <IconFileTypePdf size={32} />
            </div>
          </div>
          <h1 className="text-5xl font-black tracking-tighter text-slate-900 leading-tight">
            Financial Audit <span className="text-primary">Intelligence</span>
          </h1>
          <p className="text-lg text-slate-500 leading-relaxed max-w-lg mx-auto font-medium">
            Professional multi-modal auditing engine for rapid bank statement forensics.
          </p>
        </header>

        {!isExtracting ? (
          <div className="space-y-8 animate-in slide-in-from-bottom-6 duration-500">
            <div
              onClick={triggerUpload}
              className={cn(
                "group relative cursor-pointer border-2 border-dashed rounded-[2.5rem] p-16 transition-all duration-300",
                selectedFile
                   ? "bg-white border-primary shadow-xl"
                   : "bg-white/50 border-slate-200 hover:border-primary/50 hover:bg-white hover:shadow-xl",
                isReadingFile && "pointer-events-none opacity-50"
              )}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept=".pdf"
              />

              <div className="space-y-6 text-center">
                <div className="mx-auto w-20 h-20 rounded-full bg-slate-50 flex items-center justify-center border group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300 shadow-sm">
                   {isReadingFile ? (
                     <IconLoader2 className="animate-spin" size={32} />
                   ) : (
                     <IconUpload size={32} />
                   )}
                </div>

                {isReadingFile ? (
                  <div className="space-y-2">
                    <p className="text-xl font-bold text-slate-800 tracking-tight">Scanning PDF...</p>
                    <p className="text-sm font-medium text-slate-400 uppercase tracking-widest text-[10px]">Analyzing document structure</p>
                  </div>
                ) : selectedFile ? (
                  <div className="space-y-2">
                    <p className="text-xl font-bold text-slate-800">File Selected</p>
                    <Badge variant="outline" className="text-xs px-5 py-2 rounded-full bg-green-50 text-green-700 border-green-200 flex mx-auto w-fit gap-2">
                      <IconCheck size={14} /> {selectedFile.name}
                    </Badge>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xl font-bold text-slate-800 tracking-tight">Drop Statement PDF</p>
                    <p className="text-sm font-medium text-slate-400 uppercase tracking-widest text-[10px]">Secure AES-256 Extraction</p>
                  </div>
                )}
              </div>
            </div>

            {selectedFile && (
              <Button
                onClick={() => startExtraction()}
                size="lg"
                className="w-full h-16 rounded-2xl text-lg font-bold shadow-xl gap-3 hover:scale-[1.01] active:scale-[0.98] transition-all bg-primary"
              >
                <IconRocket size={24} /> Start Forensic Extraction
              </Button>
            )}

            {errorHeader && <p className="text-red-500 font-bold text-center text-sm">{errorHeader}</p>}
          </div>
        ) : (
          <div className="space-y-12 py-10 animate-in zoom-in-95 duration-500">
            <div className="space-y-6 text-center">
              <div className="relative inline-flex mb-4">
                <div className="h-32 w-32 rounded-full border-4 border-primary/5 border-t-primary animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  {React.createElement(extractionSteps[currentStep]?.icon || IconLoader2, { size: 48, className: "text-primary animate-pulse" })}
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-3xl font-bold text-slate-900 tracking-tight">
                  {extractionSteps[currentStep]?.label || "Finalizing..."}
                </h3>
                <div className="flex flex-wrap justify-center gap-2 max-w-sm mx-auto">
                  {["OCR-ENGINE", "BOX-MODEL", "MAPPING", "FOREX-SYNC", "EMI-LOC", "P-RATIO"]
                    .map((kw, i) => (
                      <span key={i} className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-400 rounded border border-slate-200 uppercase">
                        {kw}
                      </span>
                    ))}
                </div>
              </div>
            </div>

            <div className="max-w-md mx-auto space-y-6">
              <div className="flex justify-between text-[11px] font-bold text-slate-400 uppercase tracking-widest px-1">
                <span>Verification Progress</span>
                <span>{Math.round(((currentStep + 1) / extractionSteps.length) * 100)}%</span>
              </div>
              <Progress value={((currentStep + 1) / extractionSteps.length) * 100} className="h-3 rounded-full bg-slate-100" />
            </div>
          </div>
        )}
      </div>

      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent className="sm:max-w-md rounded-[2.5rem]">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-3">
              <IconLock className="text-amber-500" /> Decryption Required
            </DialogTitle>
            <DialogDescription className="font-medium text-slate-500">
              This statement is locked. Please provide the decryption key to proceed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="pass" className="font-bold text-slate-400 uppercase text-[10px] tracking-widest">PDF Password</Label>
              <Input
                id="pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-12 rounded-xl focus-visible:ring-primary font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handlePasswordSubmit} className="w-full h-12 rounded-xl font-bold text-md">
              Unlock Document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
