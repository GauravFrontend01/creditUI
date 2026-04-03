const { Mistral } = require('@mistralai/mistralai');
const { PDFDocument } = require('pdf-lib');

const apiKey = process.env.MISTRAL_API_KEY;
const client = new Mistral({ apiKey: apiKey });

exports.processMistralOCR = async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        console.log(`[Mistral OCR] Initializing process for ${file.originalname}...`);

        // 1. Extract 1st page
        const pdfDoc = await PDFDocument.load(file.buffer);
        const newPdf = await PDFDocument.create();
        const [firstPage] = await newPdf.copyPages(pdfDoc, [0]);
        newPdf.addPage(firstPage);
        const firstPageBuffer = await newPdf.save();
        const base64 = Buffer.from(firstPageBuffer).toString('base64');

        // 2. Call Mistral OCR (via Upload + Signed URL flow)
        console.log(`[Mistral OCR] Uploading 1st page as Blob to Mistral Storage...`);
        
        const blob = new Blob([firstPageBuffer], { type: 'application/pdf' });
        const uploadedFile = await client.files.upload({
            file: {
                fileName: file.originalname,
                content: blob
            },
            purpose: 'ocr'
        });

        console.log(`[Mistral OCR] Generating signed URL for file ID: ${uploadedFile.id}...`);
        const signedUrl = await client.files.getSignedUrl({ fileId: uploadedFile.id });

        console.log(`[Mistral OCR] Processing with Mistral OCR Latest...`);
        const ocrResponse = await client.ocr.process({
            model: "mistral-ocr-latest",
            document: {
                type: "document_url",
                documentUrl: signedUrl.url
            },
            includeImageBase64: true,
            table_format: 'html'
        });

        res.json({
            success: true,
            ocrData: ocrResponse,
            pdfBase64: `data:application/pdf;base64,${base64}`
        });

    } catch (error) {
        console.error('Mistral OCR error:', error);
        res.status(500).json({ 
            message: 'Mistral OCR processing failed', 
            error: error.message
        });
    }
};
