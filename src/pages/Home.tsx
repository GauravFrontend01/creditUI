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
  const [useGroqHybrid, setUseGroqHybrid] = useState(false)
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

CRITICAL INSTRUCTIONS:
1. You are a rigid JSON generation machine. 
2. Output ONLY the raw JSON object. Do NOT include any markdown formatting like \`\`\`json.
3. Do NOT include any conversational text, explanations, or analysis before or after the JSON.
4. Do NOT abbreviate, truncate, or skip any transactions. NEVER use "...". You must output the entire list.

For every extracted field, provide bounding box coords in a flat array of exactly 4 numbers: [ymin, xmin, ymax, xmax] in normalized scale [0-1000] and the page number. Do not use nested arrays like [[y,x], [y,x]].

Identify the primary currency used in the statement (e.g., INR, USD, GBP, EUR).
Return the currency as an ISO code.

Categorize each transaction into one of: 
Food, Travel, Shopping, Entertainment, Utilities, Healthcare, 
Fuel, EMI, Subscription, Forex, Fee, Cashback, Other.

Also provide a "categoryConfidence" score from 0 to 100 indicating how certain you are of the category choice. If it's ambiguous (e.g., SWIGGY could be Food or Groceries), provide a lower score like 60-70.

Mark isRecurring: true if the merchant appears more than once OR if it looks 
like a subscription (Netflix, Spotify, insurance, etc).

Mark isForex: true if the transaction involves a foreign currency or 
international merchant.

Return ONLY valid JSON in this exact structure:
{
  "currency": string,
  "bankName": string,
  "creditLimit": { "val": number, "box": [number, number, number, number], "page": number },
  "availableLimit": { "val": number, "box": [number, number, number, number], "page": number },
  "outstandingTotal": { "val": number, "box": [number, number, number, number], "page": number },
  "minPaymentDue": { "val": number, "box": [number, number, number, number], "page": number },
  "paymentDueDate": { "val": string, "box": [number, number, number, number], "page": number },
  "statementDate": { "val": string, "box": [number, number, number, number], "page": number },
  "statementPeriod": { "from": string, "to": string, "box": [number, number, number, number], "page": number },

  "previousBalance": { "val": number, "box": [number, number, number, number], "page": number },
  "lastPaymentAmount": { "val": number, "box": [number, number, number, number], "page": number },
  "lastPaymentDate": { "val": string, "box": [number, number, number, number], "page": number },

  "totalDebits": { "val": number, "box": [number, number, number, number], "page": number },
  "totalCredits": { "val": number, "box": [number, number, number, number], "page": number },
  "totalInterestCharged": { "val": number, "box": [number, number, number, number], "page": number },
  "totalLateFee": { "val": number, "box": [number, number, number, number], "page": number },
  "totalForexFee": { "val": number, "box": [number, number, number, number], "page": number },
  "totalFees": { "val": number, "box": [number, number, number, number], "page": number },
  "cashAdvance": { "amount": number, "fee": number, "box": [number, number, number, number], "page": number },
  "isRevolvingBalance": { "val": boolean },

  "rewardPointsEarned": { "val": number, "box": [number, number, number, number], "page": number },
  "rewardPointsRedeemed": { "val": number, "box": [number, number, number, number], "page": number },
  "rewardPointsBalance": { "val": number, "box": [number, number, number, number], "page": number },
  "rewardPointsExpiry": { "val": string, "box": [number, number, number, number], "page": number },

  "transactions": [{
    "date": string,
    "description": "string (the FULL raw text of the transaction line)",
    "merchantName": "string (the cleaned-up, concise name of the merchant)",
    "amount": number,
    "type": "Debit" | "Credit",
    "category": string,
    "categoryConfidence": number,
    "isRecurring": boolean,
    "isForex": boolean,
    "box": [number, number, number, number],
    "page": number
  }],

  "emiList": [{
    "name": string,
    "amount": number,
    "box": [number, number, number, number],
    "page": number
  }],

  "reconciliation": string,
  "summary": string
}`;

  const defaultDummyData = {
    "currency": "INR",
    "bankName": "HSBC",
    "creditLimit": { "val": 85000.0, "box": [227, 142, 237, 208], "page": 1 },
    "availableLimit": { "val": 39899.81, "box": [322, 640, 331, 690], "page": 1 },
    "outstandingTotal": { "val": 45100.19, "box": [787, 838, 796, 892], "page": 1 },
    "minPaymentDue": { "val": 4642.74, "box": [52, 841, 61, 894], "page": 1 },
    "paymentDueDate": { "val": "09 APR 2026", "box": [51, 623, 61, 686], "page": 1 },
    "statementDate": { "val": "22 MAR 2026", "box": [91, 680, 97, 737], "page": 1 },
    "statementPeriod": { "from": "23 FEB 2026", "to": "22 MAR 2026", "box": [89, 561, 98, 739], "page": 1 },
    "previousBalance": { "val": 41640.16, "box": [788, 121, 797, 176], "page": 1 },
    "lastPaymentAmount": { "val": 4400.0, "box": [348, 640, 357, 711], "page": 1 },
    "lastPaymentDate": { "val": "08 MAR", "box": [348, 50, 357, 100], "page": 1 },
    "totalDebits": { "val": 11944.52, "box": [788, 352, 797, 408], "page": 1 },
    "totalCredits": { "val": 8484.49, "box": [788, 588, 797, 638], "page": 1 },
    "totalInterestCharged": { "val": 809.0, "box": [465, 647, 473, 687], "page": 3 },
    "totalLateFee": { "val": 0.0, "box": [], "page": 1 },
    "totalForexFee": { "val": 0.0, "box": [], "page": 1 },
    "totalFees": { "val": 183.5, "box": [415, 651, 496, 687], "page": 3 },
    "cashAdvance": { "amount": 0.0, "fee": 0.0, "box": [547, 663, 555, 687], "page": 3 },
    "isRevolvingBalance": { "val": true },
    "rewardPointsEarned": { "val": 66.0, "box": [842, 396, 851, 432], "page": 1 },
    "rewardPointsRedeemed": { "val": 0.0, "box": [842, 555, 851, 586], "page": 1 },
    "rewardPointsBalance": { "val": 1037.0, "box": [842, 701, 851, 746], "page": 1 },
    "rewardPointsExpiry": { "val": null, "box": [], "page": 1 },
    "transactions": [
      {
        "date": "08MAR",
        "description": "BBPS PMT BBPSPU016067DH0ZWTD37394",
        "merchantName": "BBPS",
        "amount": 4400.0,
        "type": "Credit",
        "category": "Other",
        "categoryConfidence": 90,
        "isRecurring": false,
        "isForex": false,
        "box": [348, 50, 357, 711],
        "page": 1
      },
      {
        "date": "22FEB",
        "description": "BUNDL TECHNOLOGIES BENGALURU IN",
        "merchantName": "Swiggy",
        "amount": 548.0,
        "type": "Debit",
        "category": "Food",
        "categoryConfidence": 95,
        "isRecurring": true,
        "isForex": false,
        "box": [400, 50, 410, 687],
        "page": 1
      },
      {
        "date": "25FEB",
        "description": "SHIROLE BROS PUNE IN",
        "merchantName": "SHIROLE BROS",
        "amount": 404.72,
        "type": "Debit",
        "category": "Other",
        "categoryConfidence": 50,
        "isRecurring": true,
        "isForex": false,
        "box": [425, 50, 435, 687],
        "page": 1
      },
      {
        "date": "28FEB",
        "description": "GOOGLE PLAY APP PURCHA MUMBAI IN",
        "merchantName": "GOOGLE PLAY",
        "amount": 99.0,
        "type": "Debit",
        "category": "Shopping",
        "categoryConfidence": 85,
        "isRecurring": false,
        "isForex": false,
        "box": [450, 50, 461, 687],
        "page": 1
      },
      {
        "date": "28FEB",
        "description": "AMAZONIN GURGAON IN",
        "merchantName": "AMAZON",
        "amount": 394.0,
        "type": "Debit",
        "category": "Shopping",
        "categoryConfidence": 95,
        "isRecurring": true,
        "isForex": false,
        "box": [476, 50, 486, 687],
        "page": 1
      },
      {
        "date": "01MAR",
        "description": "ZEPTO MARKETPLACE PRIV Bangalore IN",
        "merchantName": "ZEPTO",
        "amount": 696.0,
        "type": "Debit",
        "category": "Food",
        "categoryConfidence": 90,
        "isRecurring": true,
        "isForex": false,
        "box": [501, 50, 511, 687],
        "page": 1
      },
      {
        "date": "01MAR",
        "description": "IAP ZEPTO909NPLCYBS Bangalore",
        "merchantName": "ZEPTO",
        "amount": 696.0,
        "type": "Credit",
        "category": "Cashback",
        "categoryConfidence": 85,
        "isRecurring": false,
        "isForex": false,
        "box": [526, 50, 537, 711],
        "page": 1
      },
      {
        "date": "01MAR",
        "description": "ZEPTO MARKETPLACE PRIV Bangalore IN",
        "merchantName": "ZEPTO",
        "amount": 305.45,
        "type": "Debit",
        "category": "Food",
        "categoryConfidence": 90,
        "isRecurring": true,
        "isForex": false,
        "box": [551, 50, 561, 687],
        "page": 1
      },
      {
        "date": "03MAR",
        "description": "SHIROLE BROS PUNE IN",
        "merchantName": "SHIROLE BROS",
        "amount": 404.72,
        "type": "Debit",
        "category": "Other",
        "categoryConfidence": 50,
        "isRecurring": true,
        "isForex": false,
        "box": [576, 50, 587, 687],
        "page": 1
      },
      {
        "date": "03MAR",
        "description": "ZEPTO MARKETPLACE PRIV Bangalore IN",
        "merchantName": "ZEPTO",
        "amount": 235.0,
        "type": "Debit",
        "category": "Food",
        "categoryConfidence": 90,
        "isRecurring": true,
        "isForex": false,
        "box": [602, 50, 612, 687],
        "page": 1
      },
      {
        "date": "05MAR",
        "description": "Fuel Surcharge Refund 01-28 FEB'26",
        "merchantName": "FUEL REFUND",
        "amount": 4.0,
        "type": "Credit",
        "category": "Cashback",
        "categoryConfidence": 95,
        "isRecurring": false,
        "isForex": false,
        "box": [627, 50, 637, 708],
        "page": 1
      },
      {
        "date": "07MAR",
        "description": "BUNDL TECHNOLOGIES BENGALURU IN",
        "merchantName": "Swiggy",
        "amount": 789.0,
        "type": "Debit",
        "category": "Food",
        "categoryConfidence": 95,
        "isRecurring": true,
        "isForex": false,
        "box": [652, 50, 663, 687],
        "page": 1
      },
      {
        "date": "08MAR",
        "description": "ZEPTO MARKETPLACE PRIV Bangalore IN",
        "merchantName": "ZEPTO",
        "amount": 223.0,
        "type": "Debit",
        "category": "Food",
        "categoryConfidence": 90,
        "isRecurring": true,
        "isForex": false,
        "box": [677, 50, 688, 687],
        "page": 1
      },
      {
        "date": "10MAR",
        "description": "IAP Swiggy Limited Bangalore",
        "merchantName": "Swiggy",
        "amount": 295.0,
        "type": "Debit",
        "category": "Food",
        "categoryConfidence": 95,
        "isRecurring": true,
        "isForex": false,
        "box": [703, 50, 713, 687],
        "page": 1
      },
      {
        "date": "10MAR",
        "description": "AMAZON PAY INDIA PRIVA WWW.AMAZON.IN IN",
        "merchantName": "AMAZON",
        "amount": 354.0,
        "type": "Debit",
        "category": "Shopping",
        "categoryConfidence": 95,
        "isRecurring": true,
        "isForex": false,
        "box": [342, 50, 353, 687],
        "page": 2
      },
      {
        "date": "12MAR",
        "description": "SHIROLE BROS PUNE IN",
        "merchantName": "SHIROLE BROS",
        "amount": 809.44,
        "type": "Debit",
        "category": "Other",
        "categoryConfidence": 50,
        "isRecurring": true,
        "isForex": false,
        "box": [368, 50, 378, 687],
        "page": 2
      },
      {
        "date": "12MAR",
        "description": "IAP Swiggy Limited Bangalore",
        "merchantName": "Swiggy",
        "amount": 185.0,
        "type": "Debit",
        "category": "Food",
        "categoryConfidence": 95,
        "isRecurring": true,
        "isForex": false,
        "box": [393, 50, 403, 687],
        "page": 2
      },
      {
        "date": "15MAR",
        "description": "IAP Swiggy Limited Bangalore",
        "merchantName": "Swiggy",
        "amount": 169.0,
        "type": "Debit",
        "category": "Food",
        "categoryConfidence": 95,
        "isRecurring": true,
        "isForex": false,
        "box": [418, 50, 429, 687],
        "page": 2
      },
      {
        "date": "18MAR",
        "description": "IAP DISTRICT MOVIE TICKET GURUGRAM",
        "merchantName": "DISTRICT MOVIE TICKET",
        "amount": 806.2,
        "type": "Debit",
        "category": "Entertainment",
        "categoryConfidence": 95,
        "isRecurring": false,
        "isForex": false,
        "box": [443, 50, 454, 687],
        "page": 2
      },
      {
        "date": "18MAR",
        "description": "WWW SWIGGY IN BANGALORE IN",
        "merchantName": "Swiggy",
        "amount": 326.0,
        "type": "Debit",
        "category": "Food",
        "categoryConfidence": 95,
        "isRecurring": true,
        "isForex": false,
        "box": [469, 50, 479, 687],
        "page": 2
      },
      {
        "date": "19MAR",
        "description": "IAP Swiggy Limited Bangalore",
        "merchantName": "Swiggy",
        "amount": 176.0,
        "type": "Debit",
        "category": "Food",
        "categoryConfidence": 95,
        "isRecurring": true,
        "isForex": false,
        "box": [494, 50, 504, 687],
        "page": 2
      },
      {
        "date": "20MAR",
        "description": "SHREE MART 4809245 PUNE IN",
        "merchantName": "SHREE MART",
        "amount": 348.0,
        "type": "Debit",
        "category": "Food",
        "categoryConfidence": 80,
        "isRecurring": false,
        "isForex": false,
        "box": [519, 50, 529, 687],
        "page": 2
      },
      {
        "date": "22MAR",
        "description": "Makemytrip India Pvt Lt CC26081201838 4TH OF 6 INSTALLMENTS PRINCIPAL",
        "merchantName": "Makemytrip",
        "amount": 891.0,
        "type": "Credit",
        "category": "EMI",
        "categoryConfidence": 100,
        "isRecurring": true,
        "isForex": false,
        "box": [544, 50, 566, 711],
        "page": 2
      },
      {
        "date": "22MAR",
        "description": "Makemytrip India Pvt Lt CC26081201838 4TH OF 6 INSTALLMENTS PRINCIPAL",
        "merchantName": "Makemytrip",
        "amount": 891.0,
        "type": "Debit",
        "category": "EMI",
        "categoryConfidence": 100,
        "isRecurring": true,
        "isForex": false,
        "box": [570, 50, 591, 687],
        "page": 2
      },
      {
        "date": "22MAR",
        "description": "Makemytrip India Pvt Lt CC26081201838 4TH OF 6 INSTALLMENTS INTEREST",
        "merchantName": "Makemytrip",
        "amount": 33.83,
        "type": "Credit",
        "category": "EMI",
        "categoryConfidence": 100,
        "isRecurring": true,
        "isForex": false,
        "box": [595, 50, 617, 711],
        "page": 2
      },
      {
        "date": "22MAR",
        "description": "Makemytrip India Pvt Lt CC26081201838 4TH OF 6 INSTALLMENTS INTEREST",
        "merchantName": "Makemytrip",
        "amount": 33.83,
        "type": "Debit",
        "category": "EMI",
        "categoryConfidence": 100,
        "isRecurring": true,
        "isForex": false,
        "box": [620, 50, 642, 687],
        "page": 2
      },
      {
        "date": "22MAR",
        "description": "UTTARANCHAL UNIVERSIT CC26081201839 4TH OF 9 INSTALLMENTS PRINCIPAL",
        "merchantName": "UTTARANCHAL UNIVERSIT",
        "amount": 2282.99,
        "type": "Credit",
        "category": "EMI",
        "categoryConfidence": 100,
        "isRecurring": true,
        "isForex": false,
        "box": [646, 50, 667, 711],
        "page": 2
      },
      {
        "date": "22MAR",
        "description": "UTTARANCHAL UNIVERSIT CC26081201839 4TH OF 9 INSTALLMENTS PRINCIPAL",
        "merchantName": "UTTARANCHAL UNIVERSIT",
        "amount": 2282.99,
        "type": "Debit",
        "category": "EMI",
        "categoryConfidence": 100,
        "isRecurring": true,
        "isForex": false,
        "box": [671, 50, 693, 687],
        "page": 2
      },
      {
        "date": "22MAR",
        "description": "UTTARANCHAL UNIVERSIT CC26081201839 4TH OF 9 INSTALLMENTS INTEREST",
        "merchantName": "UTTARANCHAL UNIVERSIT",
        "amount": 176.67,
        "type": "Credit",
        "category": "EMI",
        "categoryConfidence": 100,
        "isRecurring": true,
        "isForex": false,
        "box": [696, 50, 718, 711],
        "page": 2
      },
      {
        "date": "22MAR",
        "description": "UTTARANCHAL UNIVERSIT CC26081201839 4TH OF 9 INSTALLMENTS INTEREST",
        "merchantName": "UTTARANCHAL UNIVERSIT",
        "amount": 176.67,
        "type": "Debit",
        "category": "EMI",
        "categoryConfidence": 100,
        "isRecurring": true,
        "isForex": false,
        "box": [238, 50, 260, 687],
        "page": 3
      },
      {
        "date": "22MAR",
        "description": "CGST ASSESSMENT @09.00% CC26081201838",
        "merchantName": "TAX",
        "amount": 3.04,
        "type": "Debit",
        "category": "Fee",
        "categoryConfidence": 100,
        "isRecurring": true,
        "isForex": false,
        "box": [264, 50, 274, 687],
        "page": 3
      },
      {
        "date": "22MAR",
        "description": "SGST ASSESSMENT @09.00% CC26081201838",
        "merchantName": "TAX",
        "amount": 3.04,
        "type": "Debit",
        "category": "Fee",
        "categoryConfidence": 100,
        "isRecurring": true,
        "isForex": false,
        "box": [289, 50, 299, 687],
        "page": 3
      },
      {
        "date": "22MAR",
        "description": "CGST ASSESSMENT @09.00% CC26081201839",
        "merchantName": "TAX",
        "amount": 15.9,
        "type": "Debit",
        "category": "Fee",
        "categoryConfidence": 100,
        "isRecurring": true,
        "isForex": false,
        "box": [314, 50, 324, 687],
        "page": 3
      },
      {
        "date": "22MAR",
        "description": "SGST ASSESSMENT @09.00% CC26081201839",
        "merchantName": "TAX",
        "amount": 15.9,
        "type": "Debit",
        "category": "Fee",
        "categoryConfidence": 100,
        "isRecurring": true,
        "isForex": false,
        "box": [339, 50, 349, 687],
        "page": 3
      },
      {
        "date": "22MAR",
        "description": "FIN CHGS FOR THIS STMT CC26081201840 - 20001 - 1",
        "merchantName": "Finance Charges",
        "amount": 809.0,
        "type": "Debit",
        "category": "Fee",
        "categoryConfidence": 100,
        "isRecurring": false,
        "isForex": false,
        "box": [465, 50, 475, 687],
        "page": 3
      },
      {
        "date": "22MAR",
        "description": "CGST ASSESSMENT @09.00% CC26081201840",
        "merchantName": "TAX",
        "amount": 72.81,
        "type": "Debit",
        "category": "Fee",
        "categoryConfidence": 100,
        "isRecurring": false,
        "isForex": false,
        "box": [477, 50, 487, 687],
        "page": 3
      },
      {
        "date": "22MAR",
        "description": "SGST ASSESSMENT @09.00% CC26081201840",
        "merchantName": "TAX",
        "amount": 72.81,
        "type": "Debit",
        "category": "Fee",
        "categoryConfidence": 100,
        "isRecurring": false,
        "isForex": false,
        "box": [502, 50, 513, 687],
        "page": 3
      }
    ],
    "emiList": [
      {
        "name": "Makemytrip India Pvt Ltd",
        "amount": 924.83,
        "box": [75, 71, 83, 957],
        "page": 4
      },
      {
        "name": "UTTARANCHAL UNIVERSIT",
        "amount": 2459.66,
        "box": [91, 71, 99, 957],
        "page": 4
      }
    ],
    "reconciliation": "Opening Balance (41,640.16) + Total Debits (11,944.52) - Total Credits (8,484.49) = 45,100.19. This matches the Net outstanding balance. Total payment due of 30,952.22 consists of the purchase outstanding, whereas the net balance includes loans/EMIs.",
    "summary": "Statement for Mr. Gaurav Sharma for the period Feb 23 to Mar 22, 2026. Total outstanding is ₹45,100.19 with a current payment due of ₹30,952.22. Major expenses were on food delivery (Swiggy, Zepto), shopping (Amazon), and regular EMI installments. Due to non-payment of the full previous balance, finance charges of ₹809 plus taxes were applied."
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

  const convertPdfToTextWithCoords = async (file: File, pdfPassword?: string) => {
    const arrayBuffer = await file.arrayBuffer()
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, password: pdfPassword })
    const pdf = await loadingTask.promise
    
    let fullTextContent = ""
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const textContent = await page.getTextContent()
        fullTextContent += `\n--- PAGE ${i} ---\n`
        
        // Group items by their Y coordinate (rounded to 3 units to handle slight misalignments)
        const lineGroups: Record<number, any[]> = {}
        const viewport = page.getViewport({ scale: 1.0 })
        const pageHeight = viewport.height;
        const pageWidth = viewport.width;

        for (const item of textContent.items as any[]) {
            if (!item.str || !item.str.trim()) continue;
            const x = Number(item.transform[4])
            const y = Number(item.transform[5])
            
            // Round y to nearest 3 to group text on the same line
            const roundedY = Math.round(y / 3) * 3
            if (!lineGroups[roundedY]) lineGroups[roundedY] = []
            lineGroups[roundedY].push({ x, y, str: item.str, width: item.width || 0, height: item.height || 0 })
        }
        
        // Sort Y from top to bottom (y is from bottom in PDF, so sort descending)
        const sortedY = Object.keys(lineGroups).map(Number).sort((a, b) => b - a)
        
        for (const ry of sortedY) {
            const lineItems = lineGroups[ry].sort((a, b) => a.x - b.x)
            let lineStr = ""
            let minX = Infinity, maxYBottom = Infinity, maxX = -Infinity, minYBottom = -Infinity;
            
            lineItems.forEach(item => {
                lineStr += item.str + "  "
                minX = Math.min(minX, item.x)
                maxX = Math.max(maxX, item.x + item.width)
                minYBottom = Math.min(minYBottom, item.y)
                maxYBottom = Math.max(maxYBottom, item.y + item.height)
            })

            // Normalize coordinates to [0-1000] scale, where Y=0 is top of page
            const normXmin = Math.round((minX / pageWidth) * 1000)
            const normXmax = Math.round((maxX / pageWidth) * 1000)
            const normYmin = Math.round(((pageHeight - maxYBottom) / pageHeight) * 1000)
            const normYmax = Math.round(((pageHeight - minYBottom) / pageHeight) * 1000)
            
            fullTextContent += `[box: ${normYmin}, ${normXmin}, ${normYmax}, ${normXmax}] ${lineStr.trim()}\n`
        }
    }
    return fullTextContent
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
        if (useGroqHybrid) {
          setCurrentStep(1)
          const textData = await convertPdfToTextWithCoords(selectedFile, pdfPassword)
          console.log("Extracted Text (Client-Side PDF.js):\\n", textData)

          const sysPrompt = `You are a financial statement parser. Use the spatial data provided (format [x_coord, y_coord] text) to extract the following information. ${promptText}`
          const groqApiKey = import.meta.env.VITE_GROQ_API_KEY
          const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqApiKey}` },
            body: JSON.stringify({
              model: "meta-llama/llama-4-scout-17b-16e-instruct",
              messages: [
                { role: "system", content: sysPrompt },
                { role: "user", content: textData }
              ],
              temperature: 0.1,
              max_tokens: 8192
            })
          })

          const groqData = await groqResp.json()
          const responseText = groqData.choices[0].message.content
          
          try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
              finalResponse = JSON.parse(jsonMatch[0])
              console.log("JSON Extracted by Groq:", finalResponse)
              setLastApiResult(finalResponse)
            }
          } catch (e) {
            console.error("JSON parse failed", responseText)
            throw new Error("Groq AI returned invalid JSON structure")
          }
        } else {
          setCurrentStep(1)
          // const model = ai.getGenerativeModel({ model: "gemini-3-flash-preview" })
          const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" })
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
        <div className="flex flex-col items-center mb-10 gap-3">
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
              <span className={cn("text-[11px] font-bold transition-colors", useLiveApi ? "text-primary" : "text-slate-400")}>LIVE ENGINE</span>
            </div>
            {lastApiResult && (
              <Button variant="ghost" size="sm" onClick={saveAsDummy} className="h-7 text-[10px] font-bold px-3 gap-1.5 rounded-lg hover:bg-white transition-all text-primary">
                <IconDeviceFloppy size={14} /> USE AS DUMMY
              </Button>
            )}
          </div>

          {useLiveApi && (
            <div className="bg-slate-100/50 backdrop-blur-sm p-1.5 rounded-2xl border flex items-center gap-4 px-5 animate-in fade-in zoom-in slide-in-from-top-2">
              <div className="flex items-center gap-2">
                <IconSparkles size={16} className="text-slate-400" />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Extraction Strategy</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={cn("text-[11px] font-bold transition-colors", !useGroqHybrid ? "text-primary" : "text-slate-400")}>Vision (Gemini)</span>
                <Switch
                  checked={useGroqHybrid}
                  onCheckedChange={setUseGroqHybrid}
                  className="data-[state=checked]:bg-primary"
                />
                <span className={cn("text-[11px] font-bold transition-colors", useGroqHybrid ? "text-primary" : "text-slate-400")}>PDF.js + Text Coords (Groq)</span>
              </div>
            </div>
          )}
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
