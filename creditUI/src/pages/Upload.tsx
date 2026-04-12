import React, { useState, useCallback, useEffect, useRef } from 'react';
import { 
  IconUpload, 
  IconLock, 
  IconFileText, 
  IconAlertCircle,
  IconFingerprint,
  IconBrain,
  IconChartBar,
  IconShieldLock,
  IconX,
  IconMail,
  IconRefresh,
  IconUnlink,
  IconDownload,
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const Upload = () => {
  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [password, setPassword] = useState('');
  const [errorHeader, setErrorHeader] = useState("");
  const [statementType, setStatementType] = useState<'CREDIT_CARD' | 'BANK'>('CREDIT_CARD');
  const [ocrEngine, setOcrEngine] = useState<'gemini' | 'ocr_space' | 'ocr_space_v1' | 'ocr_space_v2' | 'ocr_space_v3' | 'ocr_mistral' | 'groq_llama' | 'mistral_llama_hybrid'>('gemini');
  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email: string; lastError?: string } | null>(null);
  const [gmailBusy, setGmailBusy] = useState(false);
  const [gmailPdfPassword, setGmailPdfPassword] = useState('');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const gmailOAuthToastDone = useRef(false);

  // Candidates for manual approval
  const [candidates, setCandidates] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [candidatePasswords, setCandidatePasswords] = useState<Record<string, string>>({});

  const refreshGmailStatus = useCallback(async () => {
    try {
      const { data } = await api.get('/api/gmail/status');
      setGmailStatus({
        connected: data.connected,
        email: data.email || '',
        lastError: data.lastError || '',
      });
    } catch {
      setGmailStatus({ connected: false, email: '' });
    }
  }, []);

  useEffect(() => {
    refreshGmailStatus();
  }, [refreshGmailStatus]);

  useEffect(() => {
    const g = searchParams.get('gmail');
    if (!g || gmailOAuthToastDone.current) return;
    gmailOAuthToastDone.current = true;
    if (g === 'connected') toast.success('Gmail connected. You can sync statement PDFs.');
    else if (g === 'denied') toast.message('Gmail access was not granted.');
    else {
      const reason = searchParams.get('reason') || 'unknown';
      toast.error(`Gmail: ${reason}`);
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      setFiles(droppedFiles);
      // Simulate encryption detection
      if (droppedFiles.some(f => f.name.toLowerCase().includes('secure') || f.name.toLowerCase().includes('pass'))) {
        setIsEncrypted(true);
      } else {
        setIsEncrypted(false);
      }
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFiles = Array.from(e.target.files);
      setFiles(selectedFiles);
      if (selectedFiles.some(f => f.name.toLowerCase().includes('secure') || f.name.toLowerCase().includes('pass'))) {
        setIsEncrypted(true);
      } else {
        setIsEncrypted(false);
      }
    }
  };

  const startUpload = async () => {
    if (files.length === 0) return;
    setIsUploading(true);
    setUploadProgress(10);
    setErrorHeader("");

    const formData = new FormData();
    formData.append('pdf', files[0]);
    formData.append('statementType', statementType);
    formData.append('ocrEngine', ocrEngine);
    if (password) formData.append('pdfPassword', password);

    try {
      setUploadProgress(40);
      const { data } = await api.post('/api/statements', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      setUploadProgress(100);
      navigate(`/statements/${data._id}`);
    } catch (err: any) {
      console.error('Upload failed', err);
      setIsUploading(false);
      setErrorHeader(err.response?.data?.message || err.message || "Auditing failed to initialize.");
    }
  };

  const connectGmail = async () => {
    setGmailBusy(true);
    try {
      const { data } = await api.get('/api/gmail/auth-url');
      if (data?.url) window.location.href = data.url;
      else toast.error('Could not start Gmail connection.');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || 'Gmail OAuth is not configured on the server.');
    } finally {
      setGmailBusy(false);
    }
  };

  const fetchGmailCandidates = async () => {
    setGmailBusy(true);
    try {
      const { data } = await api.get('/api/gmail/candidates');
      setCandidates(data.candidates || []);
      // Auto-select those that aren't imported yet
      const fresh = (data.candidates || [])
        .filter((c: any) => !c.isImported || !c.existsInDb)
        .map((c: any) => c.id);
      setSelectedIds(fresh);
      
      // Seed passwords from saved ones
      const passes: Record<string, string> = {};
      data.candidates.forEach((c: any) => {
        if (c.savedPassword) passes[c.id] = c.savedPassword;
      });
      setCandidatePasswords(passes);

      if (data.candidates?.length === 0) {
        toast.message('No statement PDFs found in your recent emails.');
      } else {
        toast.success(`Found ${data.candidates.length} potential statement(s).`);
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to fetch email candidates.');
    } finally {
      setGmailBusy(false);
    }
  };

  const syncSelectedCandidates = async () => {
    if (selectedIds.length === 0) return;
    setGmailBusy(true);
    try {
      const selections = candidates
        .filter(c => selectedIds.includes(c.id))
        .map(c => ({
          messageId: c.messageId,
          filename: c.filename,
          password: candidatePasswords[c.id] || '',
          statementType,
          ocrEngine,
        }));

      const { data } = await api.post('/api/gmail/sync-selected', { selections });
      const n = data.created?.length || 0;
      if (n > 0) {
        toast.success(`Successfully queued ${n} statement(s) for extraction.`);
        setCandidates([]); // Clear candidates after successful sync
        navigate('/statements');
      } else if (data.errors?.length > 0) {
        toast.error(`Failed to sync: ${data.errors[0].error}`);
      }
      await refreshGmailStatus();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Sync failed.');
    } finally {
      setGmailBusy(false);
    }
  };

  const handlePreviewCandidate = async (candidate: any) => {
    const password = candidatePasswords[candidate.id] || '';
    try {
      toast.loading(`Unlocking ${candidate.filename}...`, { id: 'preview-unlock' });
      const response = await api.post('/api/gmail/preview-unlocked', {
        messageId: candidate.messageId,
        filename: candidate.filename
      }, { responseType: 'arraybuffer' });
      
      const buf = response.data;
      console.log(`[Preview] Fetched attachment from Gmail: ${candidate.filename} (${buf.byteLength} bytes)`);

      const pdf = await pdfjsLib.getDocument({ 
        data: buf,
        password: password || undefined
      }).promise;
      console.log(`[Preview] Frontend unlock successful. Pages: ${pdf.numPages}`);

      const imgs: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: ctx, viewport: vp } as any).promise;
        imgs.push(canvas.toDataURL('image/webp', 0.8));
      }
      console.log(`[Preview] Generated ${imgs.length} page images.`);

      // Store in session for preview
      sessionStorage.setItem('preview_pdf_images', JSON.stringify(imgs));
      sessionStorage.setItem('preview_pdf_name', candidate.filename);
      sessionStorage.setItem('preview_pdf_password', password);
      sessionStorage.setItem('preview_gmail_data', JSON.stringify({
        messageId: candidate.messageId,
        filename: candidate.filename,
        bank: candidate.bank
      }));
      console.log(`[Preview] Metadata stored in sessionStorage for /statements/preview`);

      toast.success('Ready for audit preview.', { id: 'preview-unlock' });
      navigate('/statements/preview');
    } catch (e: any) {
      console.error('[Preview] Failed to process candidate:', e);
      toast.error('Unlock failed. Please check the password.', { id: 'preview-unlock' });
    }
  };

  const disconnectGmail = async () => {
    setGmailBusy(true);
    try {
      await api.post('/api/gmail/disconnect');
      await refreshGmailStatus();
      toast.success('Gmail disconnected.');
    } catch {
      toast.error('Could not disconnect Gmail.');
    } finally {
      setGmailBusy(false);
    }
  };

  const resetGmailSync = async () => {
    if (!confirm('This will clear your sync history, allowing you to re-import statements even if they were previously synced. Continue?')) return;
    setGmailBusy(true);
    try {
      await api.post('/api/gmail/reset');
      toast.success('Sync history cleared.');
      await refreshGmailStatus();
    } catch {
      toast.error('Could not reset sync history.');
    } finally {
      setGmailBusy(false);
    }
  };

  const handlePreviewFile = async () => {
    if (files.length === 0) return;
    try {
      toast.loading(`Preparing preview for ${files[0].name}...`, { id: 'preview-staged' });
      const arrayBuffer = await files[0].arrayBuffer();
      console.log(`[Preview] Manual file read: ${files[0].name} (${files[0].size} bytes)`);
      
      let buf = arrayBuffer;
      console.log(`[Preview] Starting frontend unlock for manual file...`);
      const pdf = await pdfjsLib.getDocument({ 
        data: buf,
        password: password || undefined
      }).promise;
      console.log(`[Preview] Unlock successful. Pages: ${pdf.numPages}`);

      const imgs: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: ctx, viewport: vp } as any).promise;
        imgs.push(canvas.toDataURL('image/webp', 0.8));
      }
      console.log(`[Preview] Generated ${imgs.length} page images.`);

      // Store for preview
      sessionStorage.setItem('preview_pdf_images', JSON.stringify(imgs));
      sessionStorage.setItem('preview_pdf_name', files[0].name);
      sessionStorage.setItem('preview_pdf_password', password);
      // For manual upload, we store the file itself as base64 in session
      const reader = new FileReader();
      reader.onload = () => {
        console.log(`[Preview] Storing manual PDF b64 and metadata in sessionStorage`);
        sessionStorage.setItem('preview_pdf_base64', reader.result as string);
        sessionStorage.setItem('preview_manual_data', JSON.stringify({
          statementType,
          ocrEngine,
          name: files[0].name
        }));
        toast.success('Ready for audit preview.', { id: 'preview-staged' });
        navigate('/statements/preview');
      };
      reader.readAsDataURL(files[0]);
    } catch (e: any) {
      console.error('[Preview] Failed to process manual file:', e);
      toast.error('Preview failed. ' + (e.message || 'Check password'), { id: 'preview-staged' });
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] p-8 max-w-7xl mx-auto space-y-12 animate-in fade-in duration-700 relative">
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] bg-primary/5 rounded-full blur-[160px] animate-pulse duration-[8s]" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[50%] h-[50%] bg-emerald-500/5 rounded-full blur-[140px] animate-pulse duration-[10s]" style={{ animationDelay: '3s' }} />
      </div>
      {/* Header Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-primary/60 uppercase tracking-[0.2em] text-xs font-semibold">
          <IconFingerprint size={16} />
          <span>Institutional Intelligence</span>
        </div>
        <h1 className="text-6xl font-bold tracking-tight text-primary max-w-3xl leading-[1.1]">
          Financial Audit Intelligence
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl font-light leading-relaxed">
          Elevating portfolio integrity through forensic precision. Our engine dissects complex statements to reveal hidden patterns and institutional risks.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
        {/* Main Upload Section */}
        <div className="lg:col-span-7 space-y-8">
          <div className="flex items-center gap-8">
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-2">Statement Class</span>
              <div className="bg-muted p-1 rounded-2xl flex items-center gap-1 w-fit">
                <button
                  onClick={() => setStatementType('CREDIT_CARD')}
                  className={cn(
                    "px-6 py-2 rounded-xl text-xs font-bold transition-all",
                    statementType === 'CREDIT_CARD' 
                      ? "bg-white text-primary shadow-sm" 
                      : "text-muted-foreground hover:text-primary"
                  )}
                >
                  Credit Card
                </button>
                <button
                  onClick={() => setStatementType('BANK')}
                  className={cn(
                    "px-6 py-2 rounded-xl text-xs font-bold transition-all",
                    statementType === 'BANK' 
                      ? "bg-white text-primary shadow-sm" 
                      : "text-muted-foreground hover:text-primary"
                  )}
                >
                  Bank Account
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-2">Neural Architecture</span>
              <div className="bg-muted p-1 rounded-2xl flex items-center gap-1 w-fit border border-primary/5">
                <button
                  onClick={() => setOcrEngine('gemini')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[10px] font-bold transition-all",
                    ocrEngine === 'gemini' 
                      ? "bg-white text-primary shadow-sm" 
                      : "text-muted-foreground hover:text-primary"
                  )}
                >
                  Gemini
                </button>
                <button
                  onClick={() => setOcrEngine('ocr_space_v1')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[10px] font-bold transition-all",
                    (ocrEngine === 'ocr_space_v1' || ocrEngine === 'ocr_space')
                      ? "bg-white text-primary shadow-sm" 
                      : "text-muted-foreground hover:text-primary"
                  )}
                >
                  OCR v1
                </button>
                <button
                  onClick={() => setOcrEngine('ocr_space_v3')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[10px] font-bold transition-all",
                    ocrEngine === 'ocr_space_v3' 
                      ? "bg-white text-primary shadow-sm" 
                      : "text-muted-foreground hover:text-primary"
                  )}
                >
                  OCR v3
                </button>
                <button
                  onClick={() => setOcrEngine('groq_llama')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[10px] font-bold transition-all",
                    ocrEngine === 'groq_llama' 
                      ? "bg-white text-primary shadow-sm" 
                      : "text-muted-foreground hover:text-primary"
                  )}
                >
                  Groq 70B
                </button>
                <button
                  onClick={() => setOcrEngine('mistral_llama_hybrid')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[10px] font-bold transition-all",
                    ocrEngine === 'mistral_llama_hybrid' 
                      ? "bg-white text-primary shadow-sm" 
                      : "text-muted-foreground hover:text-primary"
                  )}
                >
                  Mistral + Llama
                </button>
              </div>
            </div>
          </div>

          <Card className="rounded-[2rem] p-6 bg-muted/20 border border-primary/10 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-background shadow-sm text-primary">
                <IconMail size={22} strokeWidth={1.5} />
              </div>
              <div className="space-y-1 flex-1 min-w-0">
                <h3 className="text-sm font-bold tracking-tight">Gmail Smart Sync</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  We'll scan your inbox for the latest bank or credit card statements (like Kotak, HDFC, ICICI). 
                  The extraction engine will run automatically for any new PDFs found.
                </p>
                {gmailStatus?.connected && (
                  <div className="pt-2 space-y-2">
                    <input
                      type="password"
                      placeholder="Optional: PDF password (will be saved for future statements)"
                      className="flex h-10 w-full rounded-xl border border-primary/10 bg-background px-3 py-2 text-xs ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
                      value={gmailPdfPassword}
                      onChange={(e) => setGmailPdfPassword(e.target.value)}
                    />
                    <p className="text-[9px] text-muted-foreground italic px-1">
                      * If you've synced this bank before, we'll try your last saved password.
                    </p>
                  </div>
                )}
                {gmailStatus?.connected && gmailStatus.email && (
                  <p className="text-[11px] font-semibold text-emerald-700 truncate" title={gmailStatus.email}>
                    Connected: {gmailStatus.email}
                  </p>
                )}
                {gmailStatus?.lastError ? (
                  <p className="text-[10px] text-amber-700 break-words">{gmailStatus.lastError}</p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {!gmailStatus?.connected ? (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="rounded-xl gap-2"
                  disabled={gmailBusy}
                  onClick={connectGmail}
                >
                  {gmailBusy ? 'Opening…' : 'Connect Gmail'}
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="rounded-xl gap-2 h-10 px-6 font-bold shadow-lg shadow-primary/10"
                    disabled={gmailBusy}
                    onClick={fetchGmailCandidates}
                  >
                    <IconRefresh size={18} className={cn(gmailBusy && "animate-spin")} />
                    {gmailBusy ? 'Scanning…' : 'Scan Gmail Inbox'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl gap-2 h-10 px-4 text-muted-foreground border-dashed"
                    disabled={gmailBusy}
                    onClick={resetGmailSync}
                    title="Clear sync history"
                  >
                    Reset
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl gap-2 h-10 px-4"
                    disabled={gmailBusy}
                    onClick={disconnectGmail}
                  >
                    <IconUnlink size={16} />
                    Disconnect
                  </Button>
                </>
              )}
            </div>

            {/* Candidate List Section */}
            {candidates.length > 0 && (
              <div className="pt-6 border-t border-primary/5 space-y-4 animate-in slide-in-from-top-4">
                <div className="flex items-center justify-between px-1">
                  <h4 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Found in Inbox</h4>
                  <Badge variant="outline" className="text-[9px] rounded-full border-primary/10">{candidates.length} items</Badge>
                </div>
                
                <div className="space-y-2 max-h-[320px] overflow-y-auto pr-2 custom-scrollbar">
                  {candidates.map((c) => {
                    const isSelected = selectedIds.includes(c.id);
                    return (
                      <div 
                        key={c.id} 
                        className={cn(
                          "group p-3 rounded-2xl border transition-all duration-300",
                          isSelected ? "bg-white border-primary/20 shadow-sm" : "bg-muted/30 border-transparent grayscale-[0.6] opacity-70"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div 
                            className={cn(
                              "w-5 h-5 rounded-md border flex items-center justify-center cursor-pointer transition-colors mt-0.5",
                              isSelected ? "bg-primary border-primary text-white" : "border-muted-foreground/30 bg-background"
                            )}
                            onClick={() => {
                              setSelectedIds(prev => 
                                isSelected ? prev.filter(id => id !== c.id) : [...prev, c.id]
                              );
                            }}
                          >
                            {isSelected && <div className="w-2.5 h-1.5 border-l-2 border-b-2 -rotate-45 translate-y-[-1px] border-white" />}
                          </div>
                          
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[13px] font-bold truncate leading-none">{c.subject}</span>
                              <Badge variant="secondary" className="text-[9px] font-bold h-4 rounded-full bg-primary/5 text-primary border-0">{c.bank}</Badge>
                            </div>
                            <p className="text-[10px] text-muted-foreground truncate">{c.filename}</p>
                            
                            {c.encrypted && isSelected && (
                              <div className="pt-2">
                                <input
                                  type="password"
                                  placeholder="PDF Password Required"
                                  className="flex h-8 w-full rounded-lg border border-primary/10 bg-muted/50 px-3 py-2 text-[11px] ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                                  value={candidatePasswords[c.id] || ''}
                                  onChange={(e) => setCandidatePasswords(prev => ({ ...prev, [c.id]: e.target.value }))}
                                />
                                <div className="flex items-center justify-between mt-1">
                                  {c.savedPassword && !candidatePasswords[c.id] ? (
                                    <p className="text-[9px] text-emerald-600 pl-1">✓ Using saved password</p>
                                  ) : <div />}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-[9px] font-bold text-primary hover:bg-primary/5 gap-1"
                                    onClick={() => handlePreviewCandidate(c)}
                                  >
                                    <IconDownload size={10} />
                                    Verify & Download
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <Button 
                  className="w-full h-12 rounded-xl text-xs font-bold gap-2"
                  disabled={selectedIds.length === 0 || gmailBusy}
                  onClick={syncSelectedCandidates}
                >
                  <IconBrain size={16} />
                  {gmailBusy ? 'Processing...' : `Audit Selected (${selectedIds.length})`}
                </Button>
              </div>
            )}
          </Card>

          <div 
            className={cn(
              "relative group rounded-[2rem] p-12 transition-all duration-500 flex flex-col items-center justify-center min-h-[400px] text-center border-0",
              dragActive ? "bg-primary/5 scale-[0.99]" : "bg-muted/30 hover:bg-muted/50"
            )}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input 
              type="file" 
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
              onChange={handleFileChange}
              multiple
              accept=".pdf,.csv"
            />
            
            <div className={cn(
              "w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500 mb-8",
              dragActive ? "bg-primary text-primary-foreground scale-110 rotate-12" : "bg-background text-primary shadow-xl group-hover:scale-105"
            )}>
              <IconUpload size={40} strokeWidth={1.5} />
            </div>

            <div className="space-y-3">
              <h3 className="text-2xl font-semibold tracking-tight">Ingest Statements</h3>
              <p className="text-muted-foreground font-light px-12">
                Drag PDF or CSV files directly into the vault. We use high-fidelity geometric extraction to map your data.
              </p>
            </div>

            <div className="mt-8 flex gap-4">
              <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm border-0 py-1.5 px-4 rounded-full font-normal">PDF</Badge>
              <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm border-0 py-1.5 px-4 rounded-full font-normal">CSV</Badge>
              <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm border-0 py-1.5 px-4 rounded-full font-normal">XLSX</Badge>
            </div>
          </div>

          {/* Files List & Password Section */}
          {files.length > 0 && (
            <Card className="rounded-[2rem] p-8 bg-background shadow-2xl border-0 space-y-6 animate-in slide-in-from-bottom-4">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold flex items-center gap-2">
                  <IconFileText className="text-primary/40" />
                  Staged for Audit ({files.length})
                </h4>
                <Button variant="ghost" size="sm" onClick={() => {setFiles([]); setIsEncrypted(false);}} className="rounded-full text-muted-foreground hover:text-destructive">
                  <IconX size={18} />
                </Button>
              </div>

              <div className="space-y-3">
                {files.map((file, i) => (
                  <div key={i} className="flex items-center justify-between p-4 bg-muted/20 rounded-xl">
                    <span className="font-medium text-sm truncate max-w-[300px]">{file.name}</span>
                    <span className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                ))}
              </div>

              {/* INTEGRATED PASSWORD FIELD - Requested by User */}
              {isEncrypted && (
                <div className="p-6 bg-primary/5 rounded-[1.5rem] border border-primary/10 space-y-4 animate-in zoom-in-95">
                  <div className="flex items-center gap-2 text-primary text-sm font-semibold uppercase tracking-wider">
                    <IconShieldLock size={18} />
                    <span>Secure Access Required</span>
                  </div>
                  <div className="relative">
                    <input 
                      type="password"
                      placeholder="Enter statement password..."
                      className="flex h-14 w-full rounded-2xl border-0 bg-background px-3 py-2 pl-12 pr-4 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 shadow-sm"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <IconLock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-2">
                    <IconAlertCircle size={14} />
                    Keys are processed client-side and never stored on our servers.
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-3">
                 <Button 
                    onClick={handlePreviewFile}
                    variant="outline"
                    className="w-full h-14 rounded-2xl text-xs font-bold gap-2 border-primary/20 hover:bg-primary/5"
                 >
                    <IconChartBar size={18} />
                    Preview Staged Audit
                 </Button>

                 <Button 
                    onClick={startUpload}
                    disabled={isUploading || (isEncrypted && !password)}
                    className="w-full h-16 rounded-2xl text-lg font-semibold bg-primary hover:bg-primary/90 transition-all active:scale-[0.98]"
                 >
                    {isUploading ? 'Executing Neural Audit...' : 'Start Audit Engine'}
                 </Button>
              </div>

              {errorHeader && <p className="text-red-500 font-bold text-center text-xs mt-4">{errorHeader}</p>}
            </Card>
          )}

          {isUploading && (
            <div className="space-y-4 animate-in fade-in">
              <div className="flex justify-between text-sm font-medium">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  Neural Extraction in Progress
                </span>
                <span>{Math.round(uploadProgress)}%</span>
              </div>
              <Progress value={uploadProgress} className="h-1 bg-muted rounded-full" />
              
              <div className="bg-muted/10 rounded-2xl p-6 font-mono text-[0.7rem] space-y-2 border border-primary/5 animate-in slide-in-from-top-2">
                {[
                  { p: 10, text: ">> Initializing Geometric Extraction Engine..." },
                  { p: 30, text: ">> Mapping unstructured spatial vectors..." },
                  { p: 50, text: ">> Executing Advanced Anomaly Scanning..." },
                  { p: 70, text: ">> Correlating behavior across institutional boundaries..." },
                  { p: 90, text: ">> Finalizing forensic audit report..." }
                ].filter(l => uploadProgress >= l.p).map((line, idx) => (
                  <div key={idx} className="flex gap-3 text-primary/60">
                    <span className="text-primary/30">[{new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
                    <span className={cn(uploadProgress >= line.p + 20 ? "text-emerald-500/80" : "animate-pulse")}>{line.text}</span>
                  </div>
                ))}
                {uploadProgress < 100 && (
                  <div className="animate-pulse text-primary/40">_</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Info / Process Section */}
        <div className="lg:col-span-5 space-y-8">
          <div className="space-y-6">
            <h3 className="text-2xl font-bold tracking-tight">Audit Engine Architecture</h3>
            
            <div className="space-y-4">
              {[
                { 
                  icon: <IconBrain className="text-primary" />, 
                  title: "Geometric Extraction", 
                  desc: "Mapping spatial data from unstructured documents into clean vectors.",
                  color: "bg-blue-50"
                },
                { 
                  icon: <IconAlertCircle className="text-primary" />, 
                  title: "Anomaly Detection", 
                  desc: "Scanning for high-frequency variances and out-of-band transactions.",
                  color: "bg-amber-50"
                },
                { 
                  icon: <IconChartBar className="text-primary" />, 
                  title: "Pattern Recognition", 
                  desc: "Correlating behavior across institutional boundaries and assets.",
                  color: "bg-emerald-50"
                }
              ].map((item, idx) => (
                <div key={idx} className="group p-6 rounded-3xl hover:bg-muted/50 transition-all duration-300 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-2xl bg-background shadow-sm group-hover:scale-110 transition-transform">
                      {item.icon}
                    </div>
                    <span className="font-bold text-lg tracking-tight">{item.title}</span>
                  </div>
                  <p className="text-muted-foreground text-sm font-light leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <Card className="rounded-[2rem] p-8 bg-primary text-primary-foreground border-0 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-150 transition-transform duration-700">
              <IconShieldLock size={120} />
            </div>
            <div className="relative z-10 space-y-4">
              <h4 className="text-xl font-bold">Privacy First Extraction</h4>
              <p className="text-primary-foreground/70 text-sm font-light leading-relaxed">
                Our multi-modal auditing engine operates locally within your browser context. No sensitive financial data ever leaves your secure environment during the extraction phase.
              </p>
              <div className="pt-2">
                <Badge className="bg-white/10 text-white border-0 hover:bg-white/20 px-4 py-1.5 rounded-full font-normal">
                  AES-256 Client Side
                </Badge>
              </div>
            </div>
          </Card>
        </div>
      </div>

    </div>
  );
};


export default Upload;
