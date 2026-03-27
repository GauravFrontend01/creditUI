import * as React from "react"
import { IconUpload, IconFileTypePdf, IconRocket, IconLoader2, IconSparkles, IconScan, IconDatabase, IconCheck, IconLock } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { useNavigate } from "react-router-dom"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import * as pdfjsLib from "pdfjs-dist"
import { GoogleGenerativeAI } from "@google/generative-ai"

// Set up PDF.js worker using Vite's ?url import for reliable local worker loading
// @ts-ignore - this is a vite-specific import
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url"
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || ""
const ai = new GoogleGenerativeAI(API_KEY)

export default function Home() {
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const [isExtracting, setIsExtracting] = React.useState(false)
  const [currentStep, setCurrentStep] = React.useState(0)
  const [showPasswordDialog, setShowPasswordDialog] = React.useState(false)
  const [password, setPassword] = React.useState("260703835732")
  const [errorHeader, setErrorHeader] = React.useState("")

  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const extractionSteps = [
    { label: "Rendering PDF pages to images...", icon: IconScan },
    { label: "Performing Multi-modal OCR...", icon: IconLoader2 },
    { label: "Identifying transaction patterns...", icon: IconDatabase },
    { label: "Verifying merchant data units...", icon: IconSparkles },
    { label: "Constructing audit table...", icon: IconCheck },
  ]

  const promptText = `Analyze bank statement images. For every piece of data extracted, YOU MUST PROVIDE THE BOUNDING BOX COORDS [ymin, xmin, ymax, xmax] in normalized scale [0-1000].
Return JSON: { 
  "creditLimit": { "val": number, "box": [number, number, number, number], "page": number },
  "availableLimit": { "val": number, "box": [number, number, number, number], "page": number },
  "outstandingTotal": { "val": number, "box": [number, number, number, number], "page": number },
  "minPaymentDue": { "val": number, "box": [number, number, number, number], "page": number },
  "transactions": [{ "date": string, "description": string, "amount": number, "type": "Debit" | "Credit", "box": [number, number, number, number], "page": number }],
  "emiList": [{ "name": string, "amount": number, "box": [number, number, number, number], "page": number }],
  "reconciliation": string, "summary": string 
}`;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setSelectedFile(file)
      // Check for password
      try {
        const arrayBuffer = await file.arrayBuffer()
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
        await loadingTask.promise
      } catch (err: any) {
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

    // Process first 10 pages maximum for the demo
    const numPages = Math.min(pdf.numPages, 10)

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

  const startExtraction = async (pdfPassword?: string) => {
    if (!selectedFile) return
    setIsExtracting(true)
    setCurrentStep(0)
    
    try {
      // Step 0: Render
      await convertPdfToImages(selectedFile, pdfPassword)
      
      // Step 1: Mock Gemini Call (Using provided user data)
      setCurrentStep(1)
      await new Promise(resolve => setTimeout(resolve, 1500))
      
      const dummyResponse = {
        "creditLimit":{"val":85000,"box":[227,142,237,197],"page":1},
        "availableLimit":{"val":39899.81,"box":[321,638,332,688],"page":1},
        "outstandingTotal":{"val":45100.19,"box":[784,804,796,882],"page":1},
        "minPaymentDue":{"val":4642.74,"box":[50,807,62,893],"page":1},
        "transactions":[
          {"date":"08MAR","description":"BBPS PMT BBPSPU016067DHOZWTD37394","amount":4400,"type":"Credit","box":[348,48,359,688],"page":1},
          {"date":"22FEB","description":"BUNDL TECHNOLOGIES BENGALURU IN","amount":548,"type":"Debit","box":[399,48,411,688],"page":1},
          {"date":"25FEB","description":"SHIROLE BROS PUNE IN","amount":404.72,"type":"Debit","box":[424,48,436,688],"page":1},
          {"date":"28FEB","description":"GOOGLE PLAY APP PURCHA MUMBAI IN","amount":99,"type":"Debit","box":[451,48,461,688],"page":1},
          {"date":"28FEB","description":"AMAZONIN GURGAON IN","amount":394,"type":"Debit","box":[476,48,486,688],"page":1},
          {"date":"01MAR","description":"ZEPTO MARKETPLACE PRIV Bangalore IN","amount":696,"type":"Debit","box":[501,48,511,688],"page":1},
          {"date":"01MAR","description":"IAP ZEPTO909NPLCYBS Bangalore","amount":696,"type":"Credit","box":[526,48,538,688],"page":1},
          {"date":"01MAR","description":"ZEPTO MARKETPLACE PRIV Bangalore IN","amount":305.45,"type":"Debit","box":[552,48,562,688],"page":1},
          {"date":"03MAR","description":"SHIROLE BROS PUNE IN","amount":404.72,"type":"Debit","box":[577,48,587,688],"page":1},
          {"date":"03MAR","description":"ZEPTO MARKETPLACE PRIV Bangalore IN","amount":235,"type":"Debit","box":[602,48,613,688],"page":1},
          {"date":"05MAR","description":"Fuel Surcharge Refund 01-28 FEB'26","amount":4,"type":"Credit","box":[629,48,638,688],"page":1},
          {"date":"07MAR","description":"BUNDL TECHNOLOGIES BENGALURU IN","amount":789,"type":"Debit","box":[654,48,663,688],"page":1},
          {"date":"08MAR","description":"ZEPTO MARKETPLACE PRIV Bangalore IN","amount":223,"type":"Debit","box":[679,48,689,688],"page":1},
          {"date":"10MAR","description":"IAP Swiggy Limited Bangalore","amount":295,"type":"Debit","box":[704,48,715,688],"page":1},
          {"date":"10MAR","description":"AMAZON PAY INDIA PRIVA WWW.AMAZON.IN IN","amount":354,"type":"Debit","box":[341,48,350,688],"page":2},
          {"date":"12MAR","description":"SHIROLE BROS PUNE IN","amount":809.44,"type":"Debit","box":[365,48,376,688],"page":2},
          {"date":"12MAR","description":"IAP Swiggy Limited Bangalore","amount":185,"type":"Debit","box":[391,48,401,688],"page":2},
          {"date":"15MAR","description":"IAP Swiggy Limited Bangalore","amount":169,"type":"Debit","box":[416,48,426,688],"page":2},
          {"date":"18MAR","description":"IAP DISTRICT MOVIE TICKET GURUGRAM","amount":806.2,"type":"Debit","box":[441,48,452,688],"page":2},
          {"date":"18MAR","description":"WWW SWIGGY IN BANGALORE IN","amount":326,"type":"Debit","box":[467,48,477,688],"page":2},
          {"date":"19MAR","description":"IAP Swiggy Limited Bangalore","amount":176,"type":"Debit","box":[492,48,502,688],"page":2},
          {"date":"20MAR","description":"SHREE MART 4809245 PUNE IN","amount":348,"type":"Debit","box":[517,48,527,688],"page":2},
          {"date":"22MAR","description":"Makemytrip India Pvt Lt CC26081201838 PRINCIPAL","amount":891,"type":"Credit","box":[543,48,563,688],"page":2},
          {"date":"22MAR","description":"Makemytrip India Pvt Lt CC26081201838 PRINCIPAL","amount":891,"type":"Debit","box":[568,48,588,688],"page":2},
          {"date":"22MAR","description":"Makemytrip India Pvt Lt CC26081201838 INTEREST","amount":33.83,"type":"Credit","box":[593,48,613,688],"page":2},
          {"date":"22MAR","description":"Makemytrip India Pvt Lt CC26081201838 INTEREST","amount":33.83,"type":"Debit","box":[618,48,638,688],"page":2},
          {"date":"22MAR","description":"UTTARANCHAL UNIVERSIT CC26081201839 PRINCIPAL","amount":2282.99,"type":"Credit","box":[643,48,663,688],"page":2},
          {"date":"22MAR","description":"UTTARANCHAL UNIVERSIT CC26081201839 PRINCIPAL","amount":2282.99,"type":"Debit","box":[668,48,688,688],"page":2},
          {"date":"22MAR","description":"UTTARANCHAL UNIVERSIT CC26081201839 INTEREST","amount":176.67,"type":"Credit","box":[693,48,713,688],"page":2},
          {"date":"22MAR","description":"UTTARANCHAL UNIVERSIT CC26081201839 INTEREST","amount":176.67,"type":"Debit","box":[693,48,713,688],"page":2}
        ],
        "emiList":[],
        "reconciliation": "Statement reconciled. All manual and AI-extracted totals match.",
        "summary": "Full monthly audit across 2 pages completed."
      }

      // Progress steps animation
      for (let i = 2; i < extractionSteps.length; i++) {
        setCurrentStep(i)
        await new Promise(resolve => setTimeout(resolve, 800))
      }

      // 1. Pass data to Statement page
      sessionStorage.setItem("extraction_result", JSON.stringify(dummyResponse))
      sessionStorage.setItem("pdf_raw_name", selectedFile.name)
      sessionStorage.setItem("pdf_password", pdfPassword || "")
      
      // 2. Conver PDF to Base64 to pass it between pages
      const reader = new FileReader();
      reader.onload = () => {
        sessionStorage.setItem("pdf_base64", reader.result as string);
        navigate("/statement")
      };
      reader.readAsDataURL(selectedFile);
      
    } catch (err: any) {
      console.error(err)
      setIsExtracting(false)
      setErrorHeader("Extraction failed. " + (err.message || ""))
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
    <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-gradient-to-b from-slate-50 to-white animate-in fade-in transition-all duration-700 overflow-hidden">
      <div className="max-w-2xl w-full">
        <header className="space-y-4 mb-12 text-center">
          <div className="flex justify-center mb-6">
            <div className="h-20 w-20 rounded-3xl bg-primary/10 flex items-center justify-center text-primary shadow-[0_0_40px_rgba(var(--primary),0.05)] ring-1 ring-primary/20 animate-pulse">
              <IconFileTypePdf size={40} />
            </div>
          </div>
          <h1 className="text-5xl font-black tracking-tighter text-slate-900 leading-tight">
            Financial Audit <span className="text-primary">Intelligence</span>
          </h1>
          <p className="text-xl text-muted-foreground leading-relaxed max-w-xl mx-auto font-medium">
            Next-gen multi-modal auditing for secure bank statement verification.
          </p>
        </header>

        {!isExtracting ? (
          <div className="space-y-8 animate-in slide-in-from-bottom-6 duration-500">
            <div
              onClick={triggerUpload}
              className={cn(
                "group relative cursor-pointer border-2 border-dashed rounded-[3rem] p-16 transition-all duration-300",
                selectedFile
                  ? "bg-white border-primary shadow-2xl shadow-primary/5"
                  : "bg-white/50 border-slate-200 hover:border-primary/50 hover:bg-white hover:shadow-2xl hover:shadow-slate-200/50"
              )}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept=".pdf"
              />

              <div className="space-y-6">
                <div className="mx-auto w-24 h-24 rounded-full bg-slate-50 flex items-center justify-center border group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300 transform group-hover:scale-110 shadow-sm">
                  <IconUpload size={40} />
                </div>

                {selectedFile ? (
                  <div className="space-y-2">
                    <p className="text-2xl font-black text-slate-800 tracking-tight">Ready to Audit!</p>
                    <Badge variant="outline" className="text-md px-6 py-2 rounded-full bg-green-50 text-green-700 border-green-200 flex mx-auto w-fit gap-2 shadow-sm">
                      <IconCheck size={18} /> {selectedFile.name}
                    </Badge>
                  </div>
                ) : (
                  <div className="space-y-2 px-10">
                    <p className="text-2xl font-black text-slate-800 tracking-tight">Drop your Statement PDF here</p>
                    <p className="text-sm font-semibold text-slate-400">Secure banking grade encryption enabled</p>
                  </div>
                )}
              </div>
            </div>

            {selectedFile && (
              <Button
                onClick={() => startExtraction()}
                size="lg"
                className="w-full h-16 rounded-2xl text-lg font-black shadow-2xl shadow-primary/20 gap-3 hover:scale-[1.01] active:scale-[0.98] transition-all bg-primary"
              >
                <IconRocket size={24} /> Process Verification
              </Button>
            )}

            {errorHeader && <p className="text-red-500 font-bold">{errorHeader}</p>}
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
                <h3 className="text-4xl font-black text-slate-900 tracking-tighter">
                  {extractionSteps[currentStep]?.label || "Finalizing..."}
                </h3>
                <div className="flex flex-wrap justify-center gap-2 max-w-sm mx-auto">
                  {["GEMINI-3", "FLASH-P", "NORMALIZED", "BOX-MAPPING", "OCR", "P-RATIO"]
                    .map((kw, i) => (
                      <span key={i} className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-400 rounded-md border border-slate-200 animate-pulse">
                        {kw}
                      </span>
                    ))}
                </div>
              </div>
            </div>

            <div className="max-w-md mx-auto space-y-6">
              <div className="flex justify-between text-xs font-black text-slate-400 uppercase tracking-widest px-1">
                <span>Engine Capacity</span>
                <span>{Math.round(((currentStep + 1) / extractionSteps.length) * 100)}%</span>
              </div>
              <Progress value={((currentStep + 1) / extractionSteps.length) * 100} className="h-4 rounded-full bg-slate-100 shadow-inner" />

              <div className="grid grid-cols-1 gap-3 bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl overflow-hidden relative">
                {extractionSteps.slice(0, currentStep + 1).map((step, idx) => (
                  <div key={idx} className="flex items-center gap-4 text-md font-bold text-slate-700 animate-in fade-in slide-in-from-left-6 duration-300">
                    <div className="h-6 w-6 rounded-full bg-green-500 text-white flex items-center justify-center shadow-md">
                      <IconCheck size={14} />
                    </div>
                    <span>{step.label}</span>
                  </div>
                ))}
                {currentStep < extractionSteps.length - 1 && (
                  <div className="flex items-center gap-4 text-md font-bold text-primary animate-pulse">
                    <IconLoader2 size={18} className="animate-spin" />
                    <span>System thinking...</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent className="sm:max-w-md rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black flex items-center gap-3">
              <IconLock className="text-amber-500" /> Password Protected
            </DialogTitle>
            <DialogDescription className="font-medium">
              This statement requires a password to unlock. Please enter it below to proceed with the audit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="pass" className="font-bold text-slate-400 uppercase text-xs">PDF Password</Label>
              <Input
                id="pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-12 rounded-xl focus-visible:ring-primary"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handlePasswordSubmit} className="w-full h-12 rounded-xl font-black text-md">
              Unlock & Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
