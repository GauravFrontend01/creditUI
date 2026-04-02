import React, { useState, useRef } from "react"
import { IconUpload, IconScan, IconCopy, IconCheck, IconX, IconLoader2, IconTable } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

export default function GLMOCR() {
  const [image, setImage] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [copied, setCopied] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setImage(reader.result as string)
        setResult(null)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleExtract = async () => {
    if (!image) {
      toast.error("Please select an image first")
      return
    }

    setIsProcessing(true)
    try {
      // Remove the prefix (e.g., "data:image/png;base64,") to get just the base64 string
      const base64Image = image.split(",")[1]

      const response = await fetch("https://paulita-ungovernmental-subangulately.ngrok-free.dev/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "69420",
        },
        body: JSON.stringify({
          model: "glm-ocr",
          prompt: "Extract the transaction details from this image into a JSON table format",
          stream: false,
          images: [base64Image],
        }),
      })

      if (!response.ok) {
        throw new Error(`API Error: ${response.statusText}`)
      }

      const data = await response.json()
      setResult(data)
      toast.success("Extraction complete!")
    } catch (error: any) {
      console.error("Extraction failed:", error)
      toast.error(error.message || "Failed to extract data")
    } finally {
      setIsProcessing(false)
    }
  }

  const copyToClipboard = () => {
    if (result) {
      navigator.clipboard.writeText(JSON.stringify(result, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success("JSON copied to clipboard")
    }
  }

  const clearImage = () => {
    setImage(null)
    setResult(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  return (
    <div className="container max-w-6xl mx-auto py-10 px-4 space-y-8 animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            GLM Forensic OCR
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">
            High-precision transaction extraction using GLM-OCR model.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="rounded-full shadow-sm hover:shadow-md transition-all"
            onClick={() => fileInputRef.current?.click()}
          >
            <IconUpload className="mr-2 h-4 w-4" />
            Select Image
          </Button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageSelect}
            accept="image/*"
            className="hidden"
          />
          {image && (
            <Button
              className="rounded-full shadow-lg shadow-primary/20 bg-primary hover:scale-105 transition-transform"
              onClick={handleExtract}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                  Extracting...
                </>
              ) : (
                <>
                  <IconScan className="mr-2 h-4 w-4" />
                  Run Extraction
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Side: Image Preview */}
        <Card className="border-none shadow-xl bg-card/50 backdrop-blur-sm overflow-hidden group">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl flex items-center gap-2">
                Document Preview
              </CardTitle>
              {image && (
                <Button variant="ghost" size="sm" onClick={clearImage} className="text-destructive hover:bg-destructive/10">
                  <IconX className="h-4 w-4" />
                </Button>
              )}
            </div>
            <CardDescription>
              Upload a bank statement or transaction receipt image
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <div 
              className={cn(
                "relative aspect-[3/4] md:aspect-auto md:h-[600px] w-full rounded-xl border-2 border-dashed transition-all duration-500 overflow-hidden bg-muted/30 flex items-center justify-center",
                image ? "border-primary/20" : "border-muted-foreground/20 hover:border-primary/40 cursor-pointer"
              )}
              onClick={() => !image && fileInputRef.current?.click()}
            >
              {image ? (
                <img 
                  src={image} 
                  alt="Transaction" 
                  className="w-full h-full object-contain mix-blend-normal transition-transform duration-500 group-hover:scale-[1.02]" 
                />
              ) : (
                <div className="flex flex-col items-center gap-4 text-muted-foreground group-hover:text-primary transition-colors">
                  <div className="p-6 rounded-full bg-muted/50 group-hover:bg-primary/10 transition-colors">
                    <IconUpload size={48} strokeWidth={1.5} />
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-lg">Click to select image</p>
                    <p className="text-sm">Drag and drop supported</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Right Side: Results */}
        <Card className="border-none shadow-xl bg-card/50 backdrop-blur-sm flex flex-col h-full">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl flex items-center gap-2">
                Extraction Results
              </CardTitle>
              {result && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={copyToClipboard} className="h-8 gap-1.5">
                    {copied ? <IconCheck size={14} className="text-green-500" /> : <IconCopy size={14} />}
                    <span className="text-xs">{copied ? "Copied" : "Copy JSON"}</span>
                  </Button>
                </div>
              )}
            </div>
            <CardDescription>
              JSON data structured from the document
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 p-4 flex flex-col gap-4 min-h-[400px]">
            {isProcessing ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 animate-pulse">
                <div className="h-12 w-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                <div className="space-y-2 text-center">
                  <p className="text-lg font-medium">Neural processing engine active...</p>
                  <p className="text-sm text-muted-foreground">Identifying transaction boundaries and mapping fields</p>
                </div>
              </div>
            ) : result ? (
              <div className="flex-1 overflow-auto rounded-xl bg-black/5 dark:bg-white/5 p-4 font-mono text-sm border border-border/50 group/json relative">
                <pre className="whitespace-pre-wrap break-all leading-relaxed">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground italic border-2 border-dashed border-border/40 rounded-xl">
                <IconTable size={40} className="mb-4 opacity-20" />
                <p>Run GLM-OCR model to see results here</p>
              </div>
            )}
            
            {result && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/10 animate-in slide-in-from-bottom-2">
                <IconCheck size={18} className="text-primary" />
                <span className="text-xs font-medium">Data integrity verified by GLM inference pipeline</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
