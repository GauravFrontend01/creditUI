import sys
import types

# ── Stub optional 'verovio' dependency ────────────────────────────────────────
# GOT-OCR2_0 optionally imports verovio for music-score rendering.
# We don't need that feature, so we inject a dummy module to prevent ImportError.
_verovio_stub = types.ModuleType("verovio")
sys.modules["verovio"] = _verovio_stub
# ──────────────────────────────────────────────────────────────────────────────

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from transformers import AutoModel, AutoTokenizer
import torch
from PIL import Image
import io
import os
import uvicorn

app = FastAPI()

# Allow the Vite frontend (any localhost port) to call this server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

# ── Load GOT-OCR2_0 model ─────────────────────────────────────────────────────
model_name = 'ucaslcl/GOT-OCR2_0'
print(f"Loading {model_name}...")

tokenizer = None
model = None

try:
    tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    model = AutoModel.from_pretrained(
        model_name,
        trust_remote_code=True,
        low_cpu_mem_usage=True,
        device_map='auto',       # uses MPS on Apple Silicon, CPU otherwise
        use_safetensors=True,
        pad_token_id=tokenizer.eos_token_id
    ).eval()
    print(f"✅ Model loaded successfully on device: {next(model.parameters()).device}")
except Exception as e:
    print(f"❌ Error loading model: {e}")
    model = None


@app.post("/ocr")
async def perform_ocr(file: UploadFile = File(...)):
    if model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="OCR model not loaded. Check server logs.")

    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert("RGB")

        # model.chat() expects a file path, so save temp image
        temp_path = "/tmp/got_ocr_input.png"
        image.save(temp_path)

        with torch.no_grad():
            res = model.chat(tokenizer, temp_path, ocr_type='ocr')

        print(f"\n[OCR Result for {file.filename}]\n{res}\n{'─'*60}")
        return {"text": res, "filename": file.filename}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Clean up temp file
        if os.path.exists("/tmp/got_ocr_input.png"):
            os.remove("/tmp/got_ocr_input.png")


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": model is not None}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=5002)
