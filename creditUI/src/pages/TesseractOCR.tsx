import React, { useState, useRef } from "react"
import { createWorker } from "tesseract.js"
import { GoogleGenAI } from "@google/genai"
import * as pdfjsLib from "pdfjs-dist"
import { IconUpload, IconLoader2, IconFileTypePdf, IconTerminal, IconSparkles, IconDatabase } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { useNavigate } from "react-router-dom"

// Set up PDF.js worker
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url"
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

const PROMPT_TEXT = `Analyze this credit card statement text carefully. YOU MUST EXTRACT EVERY SINGLE TRANSACTION FROM EVERY SINGLE PAGE. DO NOT SKIP ANY DATA. 

CRITICAL INSTRUCTIONS:
1. You are a rigid JSON generation machine. 
2. Output ONLY the raw JSON object. Do NOT include any markdown formatting like \`\`\`json.
3. Do NOT include any conversational text, explanations, or analysis before or after the JSON.
4. Do NOT abbreviate, truncate, or skip any transactions. NEVER use "...". You must output the entire list.

Identify the primary currency used in the statement (e.g., INR, USD, GBP, EUR).
Return the currency as an ISO code.

Categorize each transaction into one of: 
Food, Travel, Shopping, Entertainment, Utilities, Healthcare, 
Fuel, EMI, Subscription, Forex, Fee, Cashback, Other.

Also provide a "categoryConfidence" score from 0 to 100 indicating how certain you are of the category choice.

Mark isRecurring: true if the merchant appears more than once OR if it looks 
like a subscription (Netflix, Spotify, insurance, etc).

Mark isForex: true if the transaction involves a foreign currency or 
international merchant.

Return ONLY valid JSON in this exact structure:
{
  "currency": string,
  "bankName": string,
  "creditLimit": { "val": number },
  "availableLimit": { "val": number },
  "outstandingTotal": { "val": number },
  "minPaymentDue": { "val": number },
  "paymentDueDate": { "val": string },
  "statementDate": { "val": string },
  "statementPeriod": { "from": string, "to": string },
  "previousBalance": { "val": number },
  "lastPaymentAmount": { "val": number },
  "lastPaymentDate": { "val": string },
  "totalDebits": { "val": number },
  "totalCredits": { "val": number },
  "transactions": [{
    "date": string,
    "description": "string (the FULL raw text of the transaction line)",
    "merchantName": "string (the cleaned-up, concise name of the merchant)",
    "amount": number,
    "type": "Debit" | "Credit",
    "category": string,
    "categoryConfidence": number,
    "isRecurring": boolean,
    "isForex": boolean
  }],
  "summary": string
}`;

const DUMMY_OCR_TEXT = `--- Page 1 ---
BE ws CREDIT CARD STATEMENT
PAYMENT SUMMARY
Payment due date Minimum payment due (3)
09 APR 2026 4,642.74
MR GAURAV SHARMA Statement period Total payment due ()
XXXXXXXXXXX 23 FEB 2026 To 22 MAR 2026 30,952.22
XXXXXXXXXXX
XXXXXXXXXXX HSBC PLATINUM
XXXXXXXXXXX
XXXXXXXXXXX Please make all cheques/demand drafts duly crossed, payable to "HSBC
XXXXXXXXXXX Alc - your 16 digit credit card number" and write your NAME and CONTACT
- TELEPHONE NUMBER on the reverse of the instrument. -
_— INTRA AR ll Primary card number Account number -_—
M 2205022424_0326
State: 27 - MAHARASHTRA 48xx XXXX XXxXX 5732 48xx XXXX Xxxx 9523
- Credit limit (3) Cash limit (3)* -
_— 85,000.00 17,000.00 Contact details update: Tel. No. _
STD Codo
*Cash limit availability is subject to the availability of the total credit limit. E-mail:
Ctr ts hao St wl Si pa lt Eo So ¥ (PAYMENT SLIP 10 bo detached and returned with Gash payments)
please refer important notes overleaf. "
DATE TRANSACTION DETAILS AMOUNT (3) \
» 35)
Available Credit Limit 39,899.81 »-
OPENING BALANCE 41,640.16 Shop at your conv ce.
08MAR BBPS PMT BBPSPU016067DHOZWTD37394 4,400.00 CR Pay back in convenient EMIs.
PURCHASES & INSTALLMENTS India, beyond boundaries. |
Interest Rate applicable : 3.75% p.m. (45.00% p.a.) /]
48xx xxxx xxxx 5732 GAURAV SHARMA : i
22FEB BUNDL TECHNOLOGIES BENGALURU IN 548.00 Avail our Instant EMI* feature:
+ Processing fee of 99+GST
25FEB SHIROLE BROS PUNE IN 404.72 «+ Rate of Int is 15% across all tenures
+ 100% interest refund EMI options
28FEB GOOGLE PLAY APP PURCHA MUMBAI IN 99.00 also available on select brands/mer
chants. Refer respective merchant
App/website for more details
28FEB AMAZONIN GURGAON IN 394.00 « Visit https://www.hsbc.co.in/iemi
for T&Cs
01MAR ZEPTO MARKETPLACE PRIV Bangalore IN 696.00
01MAR IAP ZEPTO909NPLCYBS Bangalore 696.00 CR ™
|
01MAR ZEPTO MARKETPLACE PRIV Bangalore IN 305.45
Get cash right when you need it.
03MAR SHIROLEBROS ~~ PUNE IN 404.72 Ray ‘rroasiinstalm Big
India, beyond boundaries
03MAR ZEPTO MARKETPLACE PRIV Bangalore IN 235.00
ER ree
05MAR Fuel Surcharge Refund 01-28 FEB'26 4.00 CR | Use our Cash-on-EMI* feature to
avail cash:
N . o .
07MAR BUNDL TECHNOLOGIES BENGALURU IN 789.00 iccesshdjivesiZ SAICLLIRCRIOE)
minimum of 3250)
* Rate of interest 10.99% to 21.99% p.a.
08MAR ZEPTO MARKETPLACE PRIV Bangalore IN 223.00 A 2 ep
+ To receive a callback
— 10MAR APS Li a B | 205.00 SMS COE to 575750 —
i imit of X
- wiggy Limite angalore + Visit https:/Avww.hsbc.co.in/coe —
for more details
— *Terms and conditions apply. —
-_— ACCOUNT SUMMARY —
— Opening balance (3) Purchase & other charges () Payment & other credits (3) Net outstanding balance (3) —
41,640.16 11,944.52 8,484.49 45,100.19
REWARD POINT SUMMARY
(Summary provided here is as on statement request date. Log onto HSBC India Mobile App to view the latest summary)
Opening Balance Earned Redeemed Closing balance
The Hongkong and Shanghai Banking Corporation Limited. Incorporated in Hong Kong SAR with limited liability. Visit us at www.hsbc.co.in
10f6


--- Page 2 ---
BE ws CREDIT CARD STATEMENT
PAYMENT SUMMARY
MR GAURAV SHARMA Statement period Total payment due ()
HSBC PLATINUM
— Primary card number Account number —
Credit limit (3) Cash limit (3)*
STD Codo
“Cash limit availability is subject to the availability of the total credit limit. E-mail:
Be Pe ¥ (PAYMENT SLIP to be detached and retuned with cash payments]
please refer important notes overleaf. we
DATE TRANSACTION DETAILS AMOUNT (3) \
» 35)
$- 4
10MAR AMAZON PAY INDIA PRIVA WWW.AMAZON.IN IN 354.00 Shop atyourcenveiiignce.
Pay back in convenient EMIs.
i
12MAR SHIROLEBROS ~~ PUNE IN 809.44 India. beyond bonis J 5
12MAR IAP Swiggy Limited Bangalore 185.00 ’
Avail our Instant EMI* feature:
15MAR IAP Swiggy Limited Bangalore 169.00 * Processing fee of ¥99+GST
+ Rate of Int is 15% across all tenures
+ 100% interest refund EMI options
18MAR ;
IAP DISTRICT MOVIE TICKET GURUGRAM 806.20 Pa raul
chants. Refer respective merchant
18MAR WWW SWIGGY IN BANGALORE IN 326.00 App/website for more details
+ Visit https://www.hsbc.co.in/iemi
19MAR IAP Swiggy Limited Bangalore 176.00 forT&Cs
20MAR SHREE MART 4809245 PUNE IN 348.00 a
22MAR Makemytrip India Pvt Lt CC26081201838 891.00 CR YA yr
4TH OF 6 INSTALLMENTS PRINCIPAL - wh 3
et cash right when you need it.
22MAR Makemytrip India Pvt Lt CC26081201838 891.00 ee indi a mS :
4TH OF 6INSTALLMENTS PRINCIPAL BY y 5
India, be d kb daries
22MAR Makemytrip India Pvt Lt CC26081201838 33.83 CR TR ee Tespens 20%
4TH OF 6 INSTALLMENTS INTEREST =
22MAR Makemytrip India Pvt Lt CC26081201838 33.83 .
4TH OF 6INSTALLMENTS INTEREST YB Our {aE or EVI fest
22MAR UTTARANCHAL UNIVERSIT ~ CC26081201839 2.28299 CR | . processing fees 2.5% (subject to a
4TH OF 9 INSTALLMENTS PRINCIPAL minimum of 2250)
22MAR UTTARANCHAL UNIVERSIT ~ CC26081201839 2,282.99 + Rate of interest 10.99% to 21.99% p.a.
4TH OF 9 INSTALLMENTS PRINCIPAL :
« To receive a callback
— | 22MAR UTTARANCHAL UNIVERSIT ~ CC26081201839 176.67 CR SMS COE to 575750 _
4TH OF 9 INSTALLMENTS INTEREST + Visit https:/Avww.hsbc.co.in/coe
for more details
— *Terms and conditions apply. —
_— ACCOUNT SUMMARY —_—
— Opening balance (3) Purchase & other charges (3) Payment & other credits (3) Net outstanding balance (3) —
41,640.16 11,944.52 8,484.49 45,100.19
REWARD POINT SUMMARY
- (Summary provided here is as on statement request date. Log onto HSBC India Mobile App to view the latest summary) -
The Hongkong and Shanghai Banking Corporation Limited. Incorporated in Hong Kong SAR with limited liability. Visit us at www.hsbc.co.in
20f6


--- Page 3 ---
BE ws CREDIT CARD STATEMENT
PAYMENT SUMMARY
MR GAURAV SHARMA Statement period Total payment due ()
HSBC PLATINUM
— Primary card number Account number —
Credit limit (3) Cash limit (3)*
STD Codo
*Cash limit availability is subject to the availability of the total credit limit. E-mail:
Be Pe ¥ (PAYMENT SLIP to be detached and retuned with cash payments]
please refer important notes overleat. -
DATE TRANSACTION DETAILS AMOUNT (3) \
» 35)
P- 4
22MAR UTTARANCHAL UNIVERSIT = CC26081201839 176.67 Shop at your conven! £8
4TH OF 9 INSTALLMENTS INTEREST Pay back in convenient EMIS: !
22MAR CGST ASSESSMENT @09.00% CC26081201838 3.04 India, beyond bounti gy 5
22MAR SGST ASSESSMENT @09.00% CC26081201838 3.04 ’
Avail our Instant EMI* feature:
22MAR CGST ASSESSMENT @09.00% CC26081201839 15.90 + Processing fee of 299+GST
+ Rate of Int is 15% across all tenures
+ 100% interest refund EMI options
22MAR p
SGST ASSESSMENT @09.00% CC26081201839 15.90 also available on select brands/mer
chants. Refer respective merchant
22MAR FIN CHGS FOR THIS STMT CC26081201840 - 20001 - 1 809.00 App/website for more details
22MAR CGST ASSESSMENT @09.00% CC26081201840 72.81 * Visit https:/www.hsbc.co.in/iemi
for T&Cs
22MAR SGST ASSESSMENT @09.00% CC26081201840 72.81
TOTAL PURCHASE OUTSTANDING 30,952.22 : PY
TOTAL CASH OUTSTANDING 0.00 »3 yr
TOTAL BALANCE TRANSFER OUTSTANDING 0.00 Get hight wh dit
TOTAL LOAN OUTSTANDING 14,147.97 Ean vnen you SESE
Repay in easy instalments.
22MAR NET OUTSTANDING BALANCE 45,100.19
India, beyond boundaries
ER ree
Use our Cash-on-EMI* feature to
avail cash:
+ Processing fees 2.5% (subject to a
minimum of 3250)
+ Rate of interest 10.99% to 21.99% p.a.
« To receive a callback
— SMS COE to 575750 —
* Visit https://www.hsbc.co.in/coe
for more details
— *Terms and conditions apply. —
-— ACCOUNT SUMMARY —
— Opening balance (3) Purchase & other charges (3) Payment & other credits (3) | Net outstanding balance (3) —
41,640.16 11,944.52 8,484.49 45,100.19
REWARD POINT SUMMARY
- (Summary provided here is as on statement request date. Log onto HSBC India Mobile App to view the latest summary) -
The Hongkong and Shanghai Banking Corporation Limited. Incorporated in Hong Kong SAR with limited liability. Visit us at www.hsbc.co.in
3 of 6


--- Page 4 ---
40f6


--- Page 5 ---
TARIFF SHEET b. The Cardholder will not be held liable for any transaction made on the credit card after reporting the
ee ett a;
c. Although loss or theft may be reported as mentioned in (a) above, the Cardholder must confirm to
HSBC in writing. A copy of the acknowledged FIR must accompany the written confirmation.
Annual fees second. ear onwards en i 10.99% 15.99% d. Should the Cardholder subsequently recover the card, the recovered credit card must not be used.
alance Transfer Charges Please destroy the card by cutting it into several pieces through the magnetic stripe.
tenors. — — — If a 100% interest refund EMI plan is communicated by the merchant, the interest component pertaining
1 the Ew will be Charged by nese as applicable. However, the interest wil be refunded as an upfront
iscount/cashback by the merchant to the card/wallet as communicated at the time of the purchase.
Applicable taxes on terest charged by HSBC will be borne by the cardholder. P
To block your credit card SMS BLOCK <last 4-digits of Credit Card> to 575750 from your registered
card
Free credit period Up to 48 days (w.e.f. 1 July 2021).
Please note that the free credit period is not valid if any PAYMENT BY CHEQUE/DRAFT
balance of the previous month's bill is outstanding Draw a cheque/draft payable to HSBC Credit Card no. (Mention your 16-digit credit card no.). To ensure
Finance charges on extended credit and cash [3.75% per month (45% per annum) computed from the quick and error free credits to your account, please mention your name and contact details on the
advances (w.e.f. 1 December 2020) date of transaction reverse of the cheque for payments. Kindly do not use post-dated cheaues for payments. Drop your
cheque/draft at Drop boxes at HSBC ATMs and branches - MINC drop boxes BILL BOX) at railway
— stations in Mumbai and New Delhi Mail your cheque/draft to the HSBC branch (kindly log on to
Finance charges on cash advance and 3.75% per month (41.88% per annum) computed from www.hsbe.co.in to view a list of our branches) To facilitate timely credit of funds in your card account
transactions in categories such as money the date of transaction deposit your cheque at least 3 working days in advance and in case of outstation cheque at least 7
oe ey er ones working days in advance of the payment due date. HSBC reserves the right to levy late payment fee.
debt repayments, etc. PAYMENT BY CASH . . .
Minimum Payment Due (MPD) on credit Higher of 100 OR Sum of: Pay by cash, quoting your 16-digit credit card number, at any HSBC branch in India. This may incur
usage 1. 100% of all Interest, Fees and Taxes billed in the additional charges payable to the Bank.
current statement VISA BILL DESK
2. 100% of Equated Monthly Instalment (EMI) amounts Pay HSBC Bank Credit Card bills online from any bank account through Bill Payment Service. Transfer
billed in the current statement (if any) money from your bank account to your HSBC Credit Card online using the BillDesk facility, a third party
3. Higher of (Past due*; Over limit amount if any) website with URL http://billdesk.com/hsbccard/. Visit www.hsbc.co.in for the terms and conditions of the
4. 1% of the billed statement balance (excluding any payment service through BillDesk. This facility is for HSBC VISA Credit Cardholders only.
EMI balance, fees, interest and taxes billed) NATIONAL AUTOMATED CLEARING HOUSE
Past due rafers to unpaid Minimum Payment Due from | yaijjable to customers in Mumbai and New Delhi.
the previous cycle NATIONAL ELECTRONIC FUNDS TRANSFER
Charge in case of cheque bounc, standing 500 Make a payment towards your account via National Electronic Funds Transfer (NEFT), mentioning the
instruction dishonored of unsuccessful complete 16-digit credit card number. The IFSC code for HSBC is HSBC-0400002.
against credit card account statement Pay HSBC Bank Credit Card bills online from any bank account through PayU Payment Service.
Transaction fee for cash advance 2.5% of transaction amount (subject to a minimum of Transfer money from your bank account to your HSBC Credit Card online using the PayU facility, a third
[Transaction foe for cash advance 12.8% of ransaciion amount subject {0 a minimum of | party website with the URL https:/securepayments.payu.in/hsbc-credit-card-payment. Visit
Transaction fee for cash withdrawal against 2100 www.hsbc.co.in for the terms and conditions of the payment service through PayU.
Transaction fee for cash withdrawal against NIL Issue standing instructions to debit your savings/current account. PhoneBanking. Internet Banking.
[ansacton fee fo cash withdrawal against NL] Pay online by logging onto HSBC Personal Internet Banking. Visit www.hsbc.co.in to refer the demo on
how to register for Internet Banking.
Late payment fee (Charged if the minimum 100% of the Minimum Payment Due (MPD) subject to
amount is not credited in the card within 3 minimum fees of ¥250 and maximum fees of 1200 per | TRANSACTION DETAILS ON YOUR CREDIT CARD
days of Payment Due Date) month) The Cardholder is deemed to have received each statement of account for the preceding month, either
on actual receipt of the statement of account or 10 days after the dispatch of the statement of account
2023 by the Bank, whichever is earlier (prescribed period). Upon receipt of each statement of account and in
any event no more than 30 (thirty) days from the period mentioned above, the cardholder agrees to
immediately notify the Bank in writing of any errors, omissions, irregularities, including any fraudulent or
Bank and other Bank ATMs unauthorised transactions or any other objections the Cardholder has to that statement of account. If the
Cash Payment Charge (HSBC Credit Cards bill [100 Cardholder fails to notify the Bank within 30 (thirty) days, the statement of account and all entries
payments made in cash at HSBC ranches & (w.e.f. 15 September 2009) therein, will be conclusive evidence of the correctness of the contents and binding upon the Cardholder
Drop Boxes) and/or any person claiming under or through such Cardholder without the requirement for any further
Fuel Surcharge 1% of fuel transaction value proof and the Bank will be released from all liability for any transaction (including all charges, damages
and losses of any kind whatsoever, taxes, levies, fines, fees or penalties suffered and/or incurred)
EE ee occurring up to the date of the most recent statement of account except for transactions the Cardholder
Fuel Surcharge Waiver Waiver is applicable if transaction is made using HSBC | 9ave notice of in accordance with this section.
Credit card and if transaction amount is between INR FINANCE CHARGES
400 and INR 4000(inclusive of both amounts and If Cardholders avail of the extended credit facilty by paying an amount less than the statement closing
excluding the Surcharge amount] balance, the entire outstanding amount will attract a financial charge from the respective date of
transactionat the prevailing rate. Even where the minimum amount indicated to keep the card valid has
Payment Hierarchy been paid, the interest will be charged on the amount remaining unpaid after the due date of payment.
Effective 5 August 2013, there is a change in the ‘Payment Hierarchy’ - Payment made to Cardholder's All new transactions will also attract a finance charge from the respective date of transaction.
account will first be settled in the order of Minimum Payment Due, first by the following ‘plans’ i.e. EMI, Let's say you purchase a watch for%1,200 on 01 March and a necklace for 3800 on 10 March.
Cash advances. Purchase outstanding and Balance Transfer in descending order of interest rates, and The following interest will be charged on your purchases:
within a given ‘plan’, the payment will be allocated in a predefined order of: 1. Service charges®, 2. [Outstanding due in the 20 March statement | 2,000.00 |
Interesi/finance charges, 3. Late payment fee, 4. Annual fee, 5. Overlimit fee, 6. Instalment handling fee, Outstanding due in the 20 March statement ¥2,000.00
7. Instalment processing fee, 8. Return cheque charges, 9. Insurance premium, 10. Principal**.
The excess payment (if any) over and above Minimum Payment Due will be allocated in same hierarchy
as defined above. In addition, the allocation of payment wit be such that the ransaction/fecs billed after | Interest calculations:3.75% p.m)
Lomement dato and are ye 10'be reflected on your statement. 1 Cc oesees meurred afler your las
*Service Charges include the following: Cash Advance Fee, GST, Card Replacement Fee, Statement
Reprint Fee, Balance Transfer Processing Fee and Standing Instruction (SI) Failed Fee.
**Principal - Includes Purchase amount, Balance Transfer principal amount and Cash withdrawn on the - -
credit card
#Or at such modified rates as decided by the Bank from time to time.
Fnac charge par month at th recall rs wll ao bo plc
Note: The Bank shall provide a prior notice of one month in case of any changes to the above credit card — — " — - -
tariff. Tariff structure subject to change from time to time at the sole discreion of HSBC. The bank will provide seven days notice period to such cardholder about the intention to report
Please be advised that applicable Indirect Taxes including Goods and Services Tax (GST) would be him/her as defaulter to the Credit Information Company. The bank will send SMS and e-mail at T-7
recovered on all our fees and charges and any other amount liable to tax under prevailing Indirect Tax and T+4 days, in this regard T being payment date.
Laws. The credit limit and cash withdrawal limit (40% of credit limit or as decided by the Bank from time Making only the minimum payment every month would result in the repayment stretching over
to time) are communicated to you in your monthly card statement. If a 100% interest refund EMI plan is months / years with consequential compounded interest payment on your outstanding balance.
communicated.
Fuel Surcharge Waiver: Eligible surcharge value on Fuel transaction will be refunded in the subsequent "
month. For ransactions pr for Fuel Surcharge Waiver, reward points will not be awarded, GST Please note that bank shall send at least a seven day notice to the customer through SMS, tele-calling,
levied on fuel transactions is beyond HSBC's jurisdiction and cannot be reversed by HSBC. Other terms etc. prior to reporting the customer as a defaulter to Credit Information Companies.
and conditions related to Fuel Surcharge Waiver eligibility remains unchanged. To know more details Interest free (grace) period: The Interest free credit period would be 48 days. This means that a customer
please visit www.hsbe.co.in who has a billing date of sth of the month can spend on his Card from 6 May to 5 June, his bill will be
GST: Please note that basis Goods and Services Tax (GST) regulations and notified GST rates, Central generated on 5 June and his Payment Due Date will be 24 June. This is applicable provided the credit
GST and State/Union Territory GST or Inter-State GST, as applicable, would apply on our fees and card outstanding, as shown on monthly credit card statement, is settled fully within 3 days (Grace
charges with effect from 1 July 2017. Period) of payment due date. However, the free credit period will not be applicable for cash advance
HSBC Maharashtra GST No. is 27AAACT2786P3ZL. Address: 9th Floor, NESCO IT Park - Building 3, transactions. Please note that the interest-free credit period is suspended if any balance of the previous
NESCO Complex, Off Western Express Highway, Goregaon (East), Mumbai, Mumbai Suburban, Months bill is outstanding.
Maharashtra - 400 063. HSN (Harmonized System Nomenclature) Code: 997113 - Credit Card services. BILLING DISPUTES RESOLUTION
I/We hereby declare that though our aggregate turnover in any preceding financial year from 2017-18 onwards is more than the aggregate turnover notified under sub-rule (4) of rule 48, we are not required to prepare an invoice in terms of the provisions of the said sub-rule. For any further details, please visit www.hsbc.co.in or call us at: HSBC PhoneBanking Numbers in India: 1800 267 3456 or 1800 121 2208. For calls to India from overseas: 91-40-61268002/91-80-71898002. LOSS/THEFT/MISUSE OF THE CARD ] oo N Banking Corporation Limited, Rajalakshmi, No. 5&7, Cathedral Road, Chennai - 600 086, India. a. If he credit card . lostistoler, the Cardnoldar should report it to Hesse immediately in ving or by E-mail: nodalofficerinm@hsbc.co.in through Visa pris conearming ant fore acting os ot pind ooking up. ane. pao ‘You may also contact the Nodal Officer Team at the following contact number between 09:30 AM and 06:00 PM, Monday to Friday. Ph.: 040-65118015/022-71728015 Fax: +91-022-66476011 and investigation. +91-022-49146011 --- Page 6 --- The Reserve Bank of India has appointed an Ombudsman who can be approched for redressing case of any update in the documents submitted by the customer at the time of establishment of customer grievances if they have not already been redressed by HSBC. The customer can approach the pusiness relationship/account-based relationship and thereafter, as necessary, customers shall submit Ombudsman if he does not receive a response within 60 days or if he is not satisfied with the response. to the HSBC the update of such documents. This shall be done within 30 days of the update to the REWARDS REDEMPTION documents for the purpose of updating the records at HSBCs end. W.E.F. - 1st April 2025, you can redeem reward points through the HSBC India Mobile Banking App only. CONTACTLESS FEATURE Grievance Redressel Officer Handling Credit Card Complaints This card is enabled with VISA payWave technology that allows contactless payments on your credit Mr Sudeep Behari card. Under contactless payments, you are not required to input your PIN at the Point of Sale (POS) The Hongkong and Shanghai Banking Corporation Limited NESCO - IT Park Bldg. 3, 9th Floor, Nesco terminals that supports contactless payments up to the pre-defined limits set on your card. Please note Complex, Western Express Highway, Goregaon (E), Mumbai - 63. Contact number: that domestic payments through contactless mode is allowed for a maximum of ‘5,000 for a single ~040-5118015/022-71728015 (Monday to Friday between 9:30 a.m. and 6:00 p.m.) transaction and for international payments, the same is allowed for a maximum amount equivalent to E-mail ID: complaints.india@hsbc.co.in ‘5,000 for a single transaction. (Any change to these limit caps will be intimated to the customers in No Cenvat credit should be taken if the taxable charges are refunded/reserved by the Bank for any accordance with the local regulatory requirements) reason. CKYCR DECLARATION As per the RBI Master Direction DBR. AML. BC. No. 81/14.01.001/2015-16, updated on 28 April 23, in Please visit www.hsbc.co.in for recent & detailed tariff and associated terms and conditions line with the requirements of Prevention of Money Laundering Rules, HSBC would like to inform that in related to your HSBC Credit Card. Important Information for IVR Transactions What do | need to do to continue carrying out IVR transactions on my credit card? Additional authentication will be required for Credit Card IVR transactions from 1 January 2011 All you would need to do is to set up this password via your HSBC Internet Banking account. Details onwards. We answer below few queries pertinent to the use of your HSBC Credit Card for IVR on how to set up this IVR Password will be communicated separately. transactions. Kindly note that this will not, in any way, affect the usage of your MSBC Credit Card except for IVR What is an IVR transaction? transactions. Interactive Voice Response i.e. IVR transactions are transactions effected over the telephone where a Credit Card number is to be entered on an automated system for the purpose of making a In case of any queries kindly call our PhoneBanking service or visit www.hsbc.co.in payment to a vendor for purchase of goods, services, etc. In what way will this affect the way | carry out an IVR transaction on my credit card? ‘You would be required to enter an IVR Password to effect transactions on IVR w.e.f. 1 January 2011.`;

export default function TesseractOCR() {
  const [file, setFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState("")
  const [fullExtractedText, setFullExtractedText] = useState("")
  const [logContent, setLogContent] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
      setLogContent([])
      setStatus("")
      setProgress(0)
      setFullExtractedText("")
    }
  }

  const addToLog = (msg: string) => {
    setLogContent(prev => [...prev, msg])
  }

  const loadDummyData = () => {
    setFullExtractedText(DUMMY_OCR_TEXT)
    setLogContent(["[System] Loaded pre-extracted dummy OCR data.", "[System] Ready for AI analysis."])
    setStatus("Dummy data loaded successfully!")
    setProgress(100)
    console.group("%c DUMMY DATA LOADED ", "background: #f59e0b; color: #fff; font-weight: bold; padding: 4px 8px; border-radius: 4px;")
    console.log(DUMMY_OCR_TEXT)
    console.groupEnd()
  }

  const performOCR = async () => {
    if (!file) return
    setIsProcessing(true)
    setProgress(0)
    setStatus("Initializing Tesseract engine...")
    setLogContent(["[System] Starting OCR Pipeline..."])

    try {
      addToLog("[PDF] Loading document...")
      const arrayBuffer = await file.arrayBuffer()
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
      const pdf = await loadingTask.promise
      const numPages = pdf.numPages
      const canvases: HTMLCanvasElement[] = []

      for (let i = 1; i <= numPages; i++) {
        setStatus(`Rendering page ${i}/${numPages}...`)
        const page = await pdf.getPage(i)
        const viewport = page.getViewport({ scale: 3.0 })
        const canvas = document.createElement("canvas")
        const context = canvas.getContext("2d")!
        canvas.height = viewport.height
        canvas.width = viewport.width

        await page.render({
          canvasContext: context,
          viewport: viewport
        } as any).promise

        canvases.push(canvas)
        setProgress((i / numPages) * 20)
      }
      addToLog("[PDF] All pages rendered to high-res.")

      addToLog("[OCR] Creating worker...")
      const worker = await createWorker('eng', 1, {
        logger: m => {
          if (m.status === 'recognizing text') {
            const currentProgress = 20 + (m.progress * 80)
            setProgress(currentProgress)
          }
        }
      });

      let fullText = ""
      for (let i = 0; i < canvases.length; i++) {
        setStatus(`OCR on page ${i + 1}/${canvases.length}...`)
        addToLog(`[OCR] Extracting text from Page ${i + 1} canvas...`)
        const { data: { text } } = await worker.recognize(canvases[i])
        fullText += `\n--- Page ${i + 1} ---\n${text}\n`
      }

      await worker.terminate()
      setFullExtractedText(fullText)

      console.group("%c EXTRACTION RELEVANT DATA ", "background: #3b82f6; color: #fff; font-weight: bold; padding: 4px 8px; border-radius: 4px;")
      console.log(fullText)
      console.groupEnd()

      addToLog("[OCR] Extraction complete. Ready for AI mapping.")
      setStatus("OCR Complete! Check console for full text.")
      setProgress(100)
    } catch (error: any) {
      console.error("OCR Error:", error)
      addToLog(`[Error] ${error.message || "An error occurred during OCR process."}`)
      setStatus("Error during OCR processing.")
    } finally {
      setIsProcessing(false)
    }
  }

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleAnalyzeWithAI = async () => {
    if (!fullExtractedText) return
    setIsAnalyzing(true)
    addToLog("[AI] Connecting to Groq Forensic Engine (Llama-70B)...")

    try {
      // 1. Prepare PDF base64 if a file exists (for the results page)
      let pdfBase64 = ""
      if (file) {
        pdfBase64 = await readFileAsBase64(file)
      }

      const apiKey = import.meta.env.VITE_GOOGLE_API_KEY
      if (!apiKey) throw new Error("Google AI API key missing.")
      
      const ai = new GoogleGenAI({ apiKey })
      const finalPrompt = `${PROMPT_TEXT}\n\nEXTRACT DATA FROM THIS TEXT:\n\n${fullExtractedText}`
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: finalPrompt,
        config: {
          responseMimeType: "application/json"
        }
      })

      const responseText = response.text || ""
      if (!responseText) throw new Error("AI returned an empty response.")
      const finalResponse = JSON.parse(responseText)

      // Save everything required for the result page (/statement)
      sessionStorage.setItem("extraction_result", JSON.stringify(finalResponse))
      sessionStorage.setItem("pdf_raw_name", file?.name || "OCR_Extraction.pdf")
      if (pdfBase64) {
        sessionStorage.setItem("pdf_base64", pdfBase64)
      }

      addToLog("[AI] Data mapping successful! Redirecting to Audit Dashboard...")
      setTimeout(() => navigate("/statement"), 800)

    } catch (error: any) {
      console.error("AI Error:", error)
      addToLog(`[AI Error] ${error.message || "An unexpected error occurred during mapping."}`)
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)] p-6 gap-8">
      <Card className="w-full max-w-2xl border-none shadow-2xl bg-white/5 backdrop-blur-xl border border-white/10 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-transparent to-indigo-500/10 pointer-events-none" />

        <CardHeader className="text-center relative">
          <div className="flex justify-center gap-2 mb-4">
            <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Frontend OCR</Badge>
            <Badge onClick={loadDummyData} className="bg-amber-500/20 text-amber-400 border-amber-500/30 cursor-pointer hover:bg-amber-500/30">Load Dummy</Badge>
          </div>
          <CardTitle className="text-4xl font-black bg-gradient-to-r from-blue-400 via-indigo-400 to-emerald-400 bg-clip-text text-transparent">
            Tesseract OCR
          </CardTitle>
          <CardDescription className="text-slate-400 text-base">
            Client-side extraction with AI mapping.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-8 relative">
          {!fullExtractedText ? (
            <div
              onClick={() => !isProcessing && fileInputRef.current?.click()}
              className={cn(
                "group relative flex flex-col items-center justify-center border-2 border-dashed rounded-3xl p-16 transition-all duration-500",
                file ? "border-emerald-500/40 bg-emerald-500/5" : "border-white/10 hover:border-blue-500/40 hover:bg-blue-500/5 cursor-pointer",
                isProcessing && "opacity-50 cursor-not-allowed"
              )}
            >
              <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="application/pdf" className="hidden" />
              {file ? (
                <div className="flex flex-col items-center animate-in fade-in zoom-in duration-500">
                  <div className="p-6 rounded-3xl bg-emerald-500/20 text-emerald-400 mb-6 font-bold flex items-center justify-center">
                    <IconFileTypePdf size={64} stroke={1.5} />
                  </div>
                  <p className="text-xl font-bold text-white mb-1">{file.name}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center text-center">
                  <div className="p-6 rounded-3xl bg-blue-500/20 text-blue-400 mb-6 group-hover:scale-110 transition-transform duration-500">
                    <IconUpload size={64} stroke={1.5} />
                  </div>
                  <p className="text-xl font-bold text-white mb-2">Upload Statement</p>
                  <p className="text-sm text-slate-400 max-w-xs">PDF statement for local extraction</p>
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 rounded-3xl bg-emerald-500/5 border border-emerald-500/20 flex flex-col items-center gap-4 animate-in zoom-in duration-500">
              <div className="p-4 rounded-full bg-emerald-500/20 text-emerald-400">
                <IconDatabase size={48} />
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-white">OCR Extraction Ready</p>
                <p className="text-sm text-slate-400">{fullExtractedText.length} characters captured</p>
              </div>
              <Button
                variant="outline"
                onClick={() => setFullExtractedText("")}
                className="h-8 text-[10px] uppercase font-bold border-white/10 hover:bg-white/5"
              >
                Clear & Re-scan
              </Button>
            </div>
          )}

          <div className="space-y-6">
            {isProcessing && (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
                <div className="flex justify-between items-end">
                  <div className="space-y-1">
                    <span className="text-xs font-bold uppercase tracking-widest text-blue-400 flex items-center gap-2">
                      <IconLoader2 className="animate-spin" size={14} />
                      Current Operation
                    </span>
                    <p className="text-sm font-semibold text-slate-200">{status}</p>
                  </div>
                  <span className="text-2xl font-black text-white">{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} className="h-2.5 bg-white/5 overflow-hidden ring-1 ring-white/10" />
              </div>
            )}

            {!fullExtractedText ? (
              <Button
                onClick={performOCR}
                disabled={!file || isProcessing}
                className={cn(
                  "w-full h-14 text-lg font-bold transition-all duration-500 rounded-2xl",
                  !file ? "bg-white/5 border border-white/10 text-slate-500" : "bg-gradient-to-r from-blue-600 to-indigo-600 shadow-xl shadow-blue-500/20 border-none text-white"
                )}
              >
                {isProcessing ? (
                  <div className="flex items-center gap-2">
                    <IconLoader2 className="animate-spin" size={20} />
                    Processing Statement...
                  </div>
                ) : "Run OCR Extraction"}
              </Button>
            ) : (
              <Button
                onClick={handleAnalyzeWithAI}
                disabled={isAnalyzing}
                className="w-full h-16 text-xl font-black bg-gradient-to-r from-emerald-500 via-teal-500 to-blue-500 hover:scale-[1.02] active:scale-95 transition-all shadow-2xl shadow-emerald-500/20 gap-3 border-none text-white rounded-2xl"
              >
                {isAnalyzing ? (
                  <>
                    <IconLoader2 className="animate-spin" size={24} />
                    MAPPING DATA...
                  </>
                ) : (
                  <>
                    <IconSparkles size={24} />
                    GENERATE AUDIT REPORT
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>

        {logContent.length > 0 && (
          <div className="border-t border-white/10 bg-black/40 p-6 font-mono">
            <div className="flex items-center gap-2 mb-3 text-slate-400">
              <IconTerminal size={14} />
              <span className="text-[10px] uppercase tracking-widest font-bold">Extraction Log</span>
            </div>
            <div className="h-32 overflow-y-auto space-y-1 custom-scrollbar">
              {logContent.map((log, i) => (
                <p key={i} className={cn(
                  "text-xs",
                  log.includes("[Error]") ? "text-red-400" :
                    log.includes("[AI]") ? "text-emerald-400" :
                      log.includes("[OCR]") ? "text-blue-400" : "text-slate-500"
                )}>
                  {log}
                </p>
              ))}
              {(isProcessing || isAnalyzing) && <div className="w-1.5 h-3 bg-blue-500 animate-pulse inline-block" />}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
