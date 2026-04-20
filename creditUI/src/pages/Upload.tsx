import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  IconUpload,
  IconMail,
  IconRefresh,
  IconUnlink,
  IconLock,
  IconBrain,
  IconCheck,
  IconX,
  IconLoader2,
  IconEye,
  IconEyeOff,
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Polyfill for environments where Map.prototype.getOrInsertComputed is unavailable.
if (!(Map.prototype as any).getOrInsertComputed) {
  (Map.prototype as any).getOrInsertComputed = function (key: unknown, compute: (k: unknown) => unknown) {
    if (!this.has(key)) this.set(key, compute(key));
    return this.get(key);
  };
}

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

/** Quick open test — same as first step of unlock, without re-rendering pages. */
async function canOpenPdfWithPassword(file: File, password: string, treatAsEncrypted: boolean): Promise<boolean> {
  try {
    const buf = await file.arrayBuffer();
    const p = password.trim();
    await pdfjsLib.getDocument({
      data: buf,
      password: treatAsEncrypted ? p : p || undefined,
    }).promise;
    return true;
  } catch {
    return false;
  }
}

const GMAIL_UPLOAD_CACHE_KEY = 'creditUI_gmail_upload_cache_v1';

type GmailCachePayload = {
  email: string;
  candidates: any[];
  selectedIds: string[];
  candidatePasswords: Record<string, string>;
  statementType: 'CREDIT_CARD' | 'BANK';
  scannedAt: string;
};

type PwGateStatus = 'idle' | 'empty' | 'checking' | 'ok' | 'bad';

function readGmailCache(): GmailCachePayload | null {
  try {
    const raw = localStorage.getItem(GMAIL_UPLOAD_CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as GmailCachePayload;
    if (!p?.email || !Array.isArray(p.candidates)) return null;
    return p;
  } catch {
    return null;
  }
}

function writeGmailCache(payload: GmailCachePayload) {
  localStorage.setItem(GMAIL_UPLOAD_CACHE_KEY, JSON.stringify(payload));
}

function clearGmailCache() {
  localStorage.removeItem(GMAIL_UPLOAD_CACHE_KEY);
}

const Upload = () => {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('gaur2607');
  const [isUploading, setIsUploading] = useState(false);
  const [errorHeader, setErrorHeader] = useState('');
  const [statementType, setStatementType] = useState<'CREDIT_CARD' | 'BANK'>('CREDIT_CARD');
  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email: string; lastError?: string } | null>(null);
  const [gmailBusy, setGmailBusy] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [candidatePasswords, setCandidatePasswords] = useState<Record<string, string>>({});
  /** Per-row password validation before Gmail upload (green tick / red when wrong). */
  const [passwordGateStatus, setPasswordGateStatus] = useState<Record<string, PwGateStatus>>({});
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null);
  const [gmailPipelineStep, setGmailPipelineStep] = useState<'idle' | 'checking_pw' | 'uploading'>('idle');
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const gmailOAuthToastDone = useRef(false);
  const gmailRestoreDone = useRef(false);

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
    gmailRestoreDone.current = false;
  }, [gmailStatus?.email]);

  /** Restore last Gmail scan (same browser) until Reset or Disconnect clears it. */
  useEffect(() => {
    if (!gmailStatus?.connected || !gmailStatus.email) return;
    if (gmailRestoreDone.current) return;
    const cached = readGmailCache();
    if (!cached || cached.email !== gmailStatus.email) return;
    if (cached.candidates.length === 0) return;
    gmailRestoreDone.current = true;

    console.log('[Gmail Cache] Restoring from localStorage', { count: cached.candidates.length, at: cached.scannedAt });
    
    setCandidates(cached.candidates);
    setSelectedIds(cached.selectedIds?.length ? cached.selectedIds : cached.candidates.map((c: any) => c.id));
    setCandidatePasswords(cached.candidatePasswords || {});
    setLastScannedAt(cached.scannedAt || null);
    if (cached.statementType === 'CREDIT_CARD' || cached.statementType === 'BANK') {
      setStatementType(cached.statementType);
    }
  }, [gmailStatus?.connected, gmailStatus?.email]);

  useEffect(() => {
    if (!gmailStatus?.connected || !gmailStatus.email) return;
    if (candidates.length === 0) return;
    writeGmailCache({
      email: gmailStatus.email,
      candidates,
      selectedIds,
      candidatePasswords,
      statementType,
      scannedAt: lastScannedAt || new Date().toISOString(),
    });
  }, [gmailStatus?.connected, gmailStatus?.email, candidates, selectedIds, candidatePasswords, statementType, lastScannedAt]);

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setFile(e.target.files[0]);
    setPassword('');
    setErrorHeader('');
  };

  const startUpload = async () => {
    if (!file) return;

    setIsUploading(true);
    setErrorHeader('');

    try {
      const effectivePassword = password.trim() || 'gaur2607';
      console.log(`[Frontend Unlock] Using password "${effectivePassword}" for ${file.name}`);

      const unlockedFile = await unlockPdfInBrowser(file, effectivePassword);
      const formData = new FormData();
      formData.append('pdf', unlockedFile);
      formData.append('statementType', statementType);
      formData.append('isUnlocked', 'true');

      const { data } = await api.post('/api/statements', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      toast.success('Statement processed successfully');
      navigate(`/statements/${data._id}`);
    } catch (err: any) {
      console.error('Manual upload failed', err);
      setErrorHeader(err.response?.data?.message || err.message || "Auditing failed to initialize.");
    } finally {
      setIsUploading(false);
    }
  };

  const unlockPdfInBrowser = async (sourceFile: File, sourcePassword: string) => {
    const buffer = await sourceFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({
      data: buffer,
      password: sourcePassword || undefined,
    }).promise;

    const rebuilt = await PDFDocument.create();
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to create canvas context for PDF unlock');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport } as any).promise;

      const imgDataUrl = canvas.toDataURL('image/jpeg', 0.92);
      const imgBytes = await fetch(imgDataUrl).then((r) => r.arrayBuffer());
      const jpg = await rebuilt.embedJpg(imgBytes);
      const newPage = rebuilt.addPage([jpg.width, jpg.height]);
      newPage.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
    }

    const unlockedBytes = await rebuilt.save();
    const unlockedArrayBuffer = unlockedBytes.buffer.slice(
      unlockedBytes.byteOffset,
      unlockedBytes.byteOffset + unlockedBytes.byteLength
    ) as ArrayBuffer;
    return new File([unlockedArrayBuffer], sourceFile.name, { type: 'application/pdf' });
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

  const pollTimerRef = useRef<any>(null);

  const checkScanStatus = useCallback(async (isManualTrigger = false) => {
    try {
      const { data } = await api.get('/api/gmail/candidates');
      if (data.status === 'scanning') {
         setGmailBusy(true);
         pollTimerRef.current = setTimeout(() => checkScanStatus(isManualTrigger), 3000);
      } else {
         setGmailBusy(false);
         if (data.status === 'error') {
            toast.error(data.error || 'Scan failed.');
         } else if (data.status === 'completed' && data.candidates) {
            const fetched = data.candidates || [];
            
             setCandidates((prev) => {
               if (!isManualTrigger && prev.length > 0) return prev; // Do not clobber user's restored cache on load

               const fresh = fetched
                 .filter((c: any) => c.shouldProcess && !c.alreadyProcessed && (!c.isImported || !c.existsInDb))
                 .map((c: any) => c.id);
               setSelectedIds(fresh);
               
               const passes: Record<string, string> = {};
               fetched.forEach((c: any) => {
                 passes[c.id] = c.savedPassword || 'gaur2607';
               });
               setCandidatePasswords(passes);
               
               if (isManualTrigger) {
                 const now = new Date().toISOString();
                 setLastScannedAt(now);
                 if (fetched.length === 0) {
                   toast.message('No statement PDFs found in your recent emails.');
                   clearGmailCache();
                 } else {
                   toast.success(`Found ${fetched.length} potential statement(s).`);
                 }
               }
               setPasswordGateStatus({});
               return fetched;
            });
         }
      }
    } catch {
      setGmailBusy(false);
    }
  }, []);

  useEffect(() => {
    if (gmailStatus?.connected && !gmailBusy) {
       // Only trigger an auto-check if we have NO candidates (even from cache) and not busy.
       if (candidates.length === 0) {
         checkScanStatus(false);
       }
    }
    return () => {
       if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    }
  }, [gmailStatus?.connected, candidates.length, checkScanStatus, gmailBusy]);

  const fetchGmailCandidates = async () => {
    setGmailBusy(true);
    setCandidates([]);
    setSelectedIds([]);
    try {
      await api.post('/api/gmail/candidates');
      toast.info('Started scanning inbox...');
      checkScanStatus(true);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to start scan.');
      setGmailBusy(false);
    }
  };

  const parseAxiosErrorMessage = async (e: unknown): Promise<string> => {
    const err = e as { message?: string; response?: { data?: unknown; status?: number } };
    const d = err.response?.data;
    if (d instanceof Blob) {
      try {
        const t = await d.text();
        const j = JSON.parse(t) as { message?: string };
        return j.message || t || 'Request failed';
      } catch {
        try {
          return await d.text();
        } catch {
          return err.message || 'Request failed';
        }
      }
    }
    if (d && typeof d === 'object' && 'message' in d && typeof (d as { message: string }).message === 'string') {
      return (d as { message: string }).message;
    }
    return err.message || 'Request failed';
  };

  const downloadGmailPdfAsFile = async (c: { messageId: string; filename: string }) => {
    const { data: blob, headers } = await api.get<Blob>('/api/gmail/attachment', {
      params: { messageId: c.messageId, filename: c.filename },
      responseType: 'blob',
    });
    const ct = (headers['content-type'] || headers['Content-Type'] || '') as string;
    if (ct.includes('application/json')) {
      const text = await (blob as Blob).text();
      const j = JSON.parse(text) as { message?: string };
      throw new Error(j.message || 'Download failed');
    }
    return new File([blob as Blob], c.filename, { type: 'application/pdf' });
  };

  /** Same path as manual upload: validate passwords → fetch PDF → unlock in browser → POST with isUnlocked. */
  const syncSelectedCandidates = async () => {
    if (selectedIds.length === 0) return;

    const rows = candidates.filter(
      (c) => selectedIds.includes(c.id) && !c.alreadyProcessed && c.shouldProcess !== false
    );
    if (rows.length === 0) {
      toast.message('No statements selected for processing.');
      return;
    }

    setGmailBusy(true);
    setGmailPipelineStep('checking_pw');

    const treatEncrypted = (c: { encrypted?: boolean }) => c.encrypted !== false;
    const gate: Record<string, PwGateStatus> = {};

    try {
      let missing = false;
      for (const c of rows) {
        const enc = treatEncrypted(c);
        const pwd = String(candidatePasswords[c.id] ?? '').trim();
        if (enc && !pwd) {
          gate[c.id] = 'empty';
          missing = true;
        }
      }
      if (missing) {
        setPasswordGateStatus((prev) => ({ ...prev, ...gate }));
        toast.error('Enter a PDF password for every selected encrypted statement.');
        return;
      }

      const gatePairs = await Promise.all(
        rows.map(async (c) => {
          const enc = treatEncrypted(c);
          const pwd = String(candidatePasswords[c.id] ?? '').trim();
          setPasswordGateStatus((prev) => ({ ...prev, [c.id]: 'checking' }));
          try {
            const file = await downloadGmailPdfAsFile(c);
            const opens = await canOpenPdfWithPassword(file, pwd, enc);
            const st: PwGateStatus = opens ? 'ok' : 'bad';
            return [c.id, st] as const;
          } catch {
            return [c.id, 'bad' as PwGateStatus] as const;
          }
        })
      );
      const gateFromCheck = Object.fromEntries(gatePairs) as Record<string, PwGateStatus>;
      setPasswordGateStatus((prev) => ({ ...prev, ...gateFromCheck }));

      const allOk = rows.every((c) => gateFromCheck[c.id] === 'ok');
      if (!allOk) {
        toast.error('Some passwords are wrong or the PDF could not be opened. Fix the rows in red, then try again.');
        return;
      }

      setGmailPipelineStep('uploading');

      const uploadResults = await Promise.all(
        rows.map(async (c) => {
          const enc = treatEncrypted(c);
          const pwd = String(candidatePasswords[c.id] ?? '').trim();
          const effectivePassword = enc ? pwd : pwd || 'gaur2607';
          try {
            const file = await downloadGmailPdfAsFile(c);
            const unlockedFile = await unlockPdfInBrowser(file, effectivePassword);

            const formData = new FormData();
            formData.append('pdf', unlockedFile);
            formData.append('statementType', statementType);
            formData.append('isUnlocked', 'true');
            formData.append('gmailMessageId', c.messageId);
            if (c.parsedPeriod?.from) formData.append('emailPeriodFrom', String(c.parsedPeriod.from));
            if (c.parsedPeriod?.to) formData.append('emailPeriodTo', String(c.parsedPeriod.to));
            if (c.accountHint) formData.append('emailAccountHint', String(c.accountHint));

            const { data: created } = await api.post('/api/statements', formData, {
              headers: { 'Content-Type': 'multipart/form-data' },
            });
            if (created?.alreadyProcessed) {
              return {
                kind: 'dup' as const,
                c,
                existingId: String(created.existingStatementId || 'existing record'),
              };
            }
            return { kind: 'ok' as const, c };
          } catch (inner: unknown) {
            const msg = await parseAxiosErrorMessage(inner);
            return { kind: 'err' as const, c, msg };
          }
        })
      );

      let ok = 0;
      const failures: string[] = [];
      for (const r of uploadResults) {
        if (r.kind === 'ok') ok += 1;
        else if (r.kind === 'dup') {
          failures.push(`${r.c.filename}: already processed (${r.existingId})`);
        } else failures.push(`${r.c.filename}: ${r.msg}`);
      }

      if (ok > 0) {
        toast.success(
          ok === rows.length
            ? `Processed ${ok} statement(s). Open Statements to review.`
            : `Processed ${ok} of ${rows.length}. Check errors for the rest.`
        );
        await fetchGmailCandidates();
      }
      if (failures.length > 0) {
        toast.error(failures[0]);
        if (failures.length > 1) console.warn('[Gmail sync] Other failures:', failures.slice(1));
      }
      await refreshGmailStatus();
    } catch (e: unknown) {
      toast.error(await parseAxiosErrorMessage(e));
    } finally {
      setGmailBusy(false);
      setGmailPipelineStep('idle');
    }
  };

  const disconnectGmail = async () => {
    setGmailBusy(true);
    try {
      await api.post('/api/gmail/disconnect');
      clearGmailCache();
      gmailRestoreDone.current = false;
      setCandidates([]);
      setSelectedIds([]);
      setCandidatePasswords({});
      setPasswordGateStatus({});
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
      clearGmailCache();
      gmailRestoreDone.current = false;
      setCandidates([]);
      setSelectedIds([]);
      setCandidatePasswords({});
      setPasswordGateStatus({});
      toast.success('Sync history cleared.');
      await refreshGmailStatus();
    } catch {
      toast.error('Could not reset sync history.');
    } finally {
      setGmailBusy(false);
    }
  };

  return (
    <div className="h-[calc(100vh-4rem)] p-6 overflow-hidden animate-in fade-in duration-500 flex flex-col gap-6 max-w-[1600px] mx-auto w-full">
      <div className="space-y-1 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight text-primary">
          Statement Upload
        </h1>
        <p className="text-muted-foreground text-sm">
          Single pipeline: unlock PDF on backend, store unlocked file, process with Vertex Gemini 2.5 Flash, and save to your statement history.
        </p>
      </div>

      <div className="flex flex-1 gap-6 min-h-0">
        {/* LEFT COLUMN: Controls */}
        <div className="w-1/3 min-w-[360px] max-w-[420px] flex flex-col gap-6 overflow-y-auto pr-2 pb-4 style-scroll">
          <Card className="rounded-2xl p-5 bg-muted/20 border border-primary/10 space-y-4 shadow-sm">
             {/* Statement type */}
             <div className="flex flex-col gap-2">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Statement type
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={statementType === 'CREDIT_CARD' ? 'default' : 'outline'}
                    onClick={() => setStatementType('CREDIT_CARD')}
                  >
                    Credit Card
                  </Button>
                  <Button
                    type="button"
                    variant={statementType === 'BANK' ? 'default' : 'outline'}
                    onClick={() => setStatementType('BANK')}
                  >
                    Bank
                  </Button>
                </div>
             </div>
          </Card>

          <Card className="rounded-2xl p-5 bg-muted/20 border border-primary/10 space-y-4 shadow-sm">
             <h2 className="text-lg font-semibold">Manual Upload</h2>
             <div className="flex flex-col gap-4">
                <label className="relative border border-dashed border-primary/20 rounded-xl p-6 text-center bg-background cursor-pointer hover:bg-muted/10 transition-colors">
                  <input type="file" className="hidden" onChange={handleFileChange} accept=".pdf" />
                  <div className="flex flex-col items-center gap-2">
                    <IconUpload size={24} className="text-primary/70" />
                    <p className="font-medium text-sm">{file ? file.name : 'Select PDF statement'}</p>
                  </div>
                </label>

                {file && (
                  <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                    <div className="relative">
                      <input
                        type="password"
                        placeholder="Enter PDF password"
                        className="flex h-10 w-full rounded-xl border border-primary/10 bg-background px-3 py-2 pl-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <IconLock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    </div>
                    <Button onClick={startUpload} disabled={isUploading} className="h-10 rounded-xl gap-2 w-full">
                      <IconBrain size={16} />
                      {isUploading ? 'Processing...' : 'Upload & Process'}
                    </Button>
                  </div>
                )}
                {errorHeader && <p className="text-xs text-red-500 font-semibold">{errorHeader}</p>}
             </div>
          </Card>

          <Card className="rounded-2xl p-5 bg-muted/20 border border-primary/10 space-y-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-background border border-primary/5 text-primary shrink-0">
                <IconMail size={18} />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">Gmail Sync</h2>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  PDFs are downloaded here, unlocked locally, then sent to the Vertex pipeline.
                </p>
                {gmailStatus?.connected && gmailStatus.email && (
                  <p className="text-[11px] text-emerald-700 font-semibold mt-1 bg-emerald-50 inline-block px-1.5 py-0.5 rounded">
                    Connected: {gmailStatus.email}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {!gmailStatus?.connected ? (
                <Button type="button" onClick={connectGmail} disabled={gmailBusy} className="h-9 text-xs">
                  {gmailBusy ? 'Opening...' : 'Connect Gmail'}
                </Button>
              ) : (
                <>
                  <Button type="button" onClick={fetchGmailCandidates} disabled={gmailBusy} className="gap-2 h-9 text-xs">
                    <IconRefresh size={14} className={cn(gmailBusy && 'animate-spin')} />
                    {gmailBusy ? 'Scanning...' : 'Scan Inbox'}
                  </Button>
                  <Button type="button" variant="outline" onClick={resetGmailSync} disabled={gmailBusy} className="h-9 text-xs bg-background">
                    Reset
                  </Button>
                  <Button type="button" variant="outline" onClick={disconnectGmail} disabled={gmailBusy} className="gap-1.5 h-9 text-xs bg-background">
                    <IconUnlink size={13} />
                    Disconnect
                  </Button>
                </>
              )}
            </div>
          </Card>
        </div>

        {/* RIGHT COLUMN: Table View */}
        <div className="flex-1 flex flex-col min-h-0 border border-primary/10 rounded-2xl bg-muted/10 overflow-hidden shadow-sm">
           <div className="flex items-center justify-between p-4 border-b border-primary/10 bg-background/50 shrink-0">
             <div>
               <div className="flex items-center gap-2">
                 <h2 className="text-base font-semibold">Gmail Sync Candidates</h2>
                 {lastScannedAt && (
                   <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-primary/5 uppercase tracking-tighter font-medium">
                     Last scanned: {new Date(lastScannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                   </span>
                 )}
               </div>
               <p className="text-xs text-muted-foreground">Select PDFs and enter passwords to process</p>
             </div>
             {candidates.length > 0 && (
               <div className="flex items-center gap-3 shrink-0">
                 <div className="text-xs bg-primary/5 text-primary px-2.5 py-1 rounded-full font-medium">
                   {selectedIds.length} Selected
                 </div>
                 <Button
                   type="button"
                   onClick={syncSelectedCandidates}
                   disabled={gmailBusy || selectedIds.length === 0}
                   className="h-9 rounded-xl gap-2 font-medium"
                 >
                   <IconBrain size={16} />
                   {gmailBusy && gmailPipelineStep === 'checking_pw'
                     ? 'Checking pw...'
                     : gmailBusy && gmailPipelineStep === 'uploading'
                       ? 'Processing...'
                       : `Process Selected`}
                 </Button>
               </div>
             )}
           </div>

           <div className="flex-1 overflow-y-auto min-h-0 p-4 relative">
              {candidates.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground border-2 border-dashed border-primary/10 rounded-xl p-8 bg-background/50">
                  <div className="w-16 h-16 rounded-full bg-primary/5 flex items-center justify-center mb-4">
                    <IconMail size={28} className="text-primary/40" />
                  </div>
                  <p className="font-semibold text-foreground/80 text-lg">No candidates loaded</p>
                  <p className="text-sm mt-1 max-w-sm">Connect Gmail and click Scan Inbox to securely find and parse bank statements from your emails.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-primary/10 bg-background overflow-hidden relative shadow-sm">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-muted/50 text-[11px] text-muted-foreground uppercase tracking-wide sticky top-0 z-10 box-border border-b border-primary/10">
                      <tr>
                        <th className="p-3 w-10"></th>
                        <th className="p-3 font-semibold">Document</th>
                        <th className="p-3 font-semibold">Bank</th>
                        <th className="p-3 font-semibold">Password & Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-primary/5">
                      {candidates.map((c) => {
                        const isSelected = selectedIds.includes(c.id);
                        const lockedAsDone = Boolean(c.alreadyProcessed);
                        const classifierSkipped = c.shouldProcess === false;
                        
                        return (
                          <tr 
                            key={c.id} 
                            className={cn(
                              "hover:bg-muted/30 transition-colors group",
                              (!isSelected || lockedAsDone || classifierSkipped) && 'opacity-60 bg-muted/10'
                            )}
                          >
                            <td className="p-3 align-top">
                               <input
                                 type="checkbox"
                                 className="rounded border-primary/30 mt-1 cursor-pointer w-4 h-4 text-primary"
                                 checked={isSelected}
                                 disabled={lockedAsDone || classifierSkipped}
                                 onChange={() =>
                                   setSelectedIds((prev) => (isSelected ? prev.filter((id) => id !== c.id) : [...prev, c.id]))
                                 }
                               />
                            </td>
                            <td className="p-3 align-top max-w-[280px] whitespace-normal">
                               <p className="font-medium break-words leading-tight">{c.filename}</p>
                               {c.parsedPeriod?.from && c.parsedPeriod?.to && (
                                  <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1.5 font-medium">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
                                    {c.parsedPeriod.from} <span className="opacity-40 font-normal">to</span> {c.parsedPeriod.to}
                                  </p>
                               )}
                            </td>
                            <td className="p-3 align-top whitespace-normal min-w-[140px]">
                               <div className="flex flex-col items-start gap-1.5">
                                 <span className="text-[11px] bg-primary/5 px-2 py-0.5 rounded border border-primary/10 font-bold tracking-wide">{c.bank}</span>
                                 {lockedAsDone && (
                                    <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 font-semibold tracking-wider uppercase">
                                      Processed
                                    </span>
                                 )}
                                 {classifierSkipped && !lockedAsDone && (
                                    <span className="text-[10px] text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200 font-semibold tracking-wider uppercase">
                                      Skipped
                                    </span>
                                 )}
                                 {c.classificationReason && (
                                   <p className="text-[10px] text-muted-foreground leading-tight max-w-[150px] mt-0.5">{c.classificationReason}</p>
                                 )}
                               </div>
                            </td>
                            <td className="p-3 align-top w-[360px] whitespace-normal">
                               {isSelected && !lockedAsDone && !classifierSkipped && (
                                 <div className="flex flex-col gap-2.5 animate-in fade-in zoom-in-95 duration-200">
                                   {c.encrypted !== false && (
                                     <>
                                       {c.passwordHint?.hasPasswordHint ? (
                                         <div className="rounded border border-amber-200 bg-amber-50/90 py-1.5 px-2.5 text-[11px] text-amber-950 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]">
                                            {c.passwordHint.userMessage ? (
                                              <p className="font-medium leading-snug">{c.passwordHint.userMessage}</p>
                                            ) : (
                                              <p><span className="font-bold">Hint:</span> {c.passwordHint.passwordRule}</p>
                                            )}
                                         </div>
                                       ) : (
                                         <p className="text-[10px] text-muted-foreground flex items-start gap-1.5 leading-tight">
                                           <IconLock size={12} className="shrink-0 mt-0.5" />
                                           <span>Password protected. No hint found. Enter your standard bank password.</span>
                                         </p>
                                       )}
                                     </>
                                   )}
                                   <div className="flex items-center gap-2">
                                      <div className="relative flex-1 group/input">
                                        <input
                                          type={showPasswords[c.id] ? 'text' : 'password'}
                                          placeholder={c.encrypted === false ? 'Optional password' : 'PDF Password'}
                                          className={cn(
                                            'flex h-9 w-full rounded-lg border bg-background px-3 py-1 pr-9 text-xs focus-visible:outline-none focus-visible:ring-2 transition-all',
                                            passwordGateStatus[c.id] === 'empty' || passwordGateStatus[c.id] === 'bad'
                                              ? 'border-red-400 focus-visible:ring-red-200 ring-2 ring-red-100'
                                              : passwordGateStatus[c.id] === 'ok'
                                                ? 'border-emerald-400 focus-visible:ring-emerald-200 ring-2 ring-emerald-50'
                                                : 'border-primary/20 focus-visible:ring-primary/20 hover:border-primary/40'
                                          )}
                                          value={candidatePasswords[c.id] || ''}
                                          onChange={(e) => {
                                            setCandidatePasswords((prev) => ({ ...prev, [c.id]: e.target.value }));
                                            setPasswordGateStatus((prev) => ({ ...prev, [c.id]: 'idle' }));
                                          }}
                                        />
                                        <button
                                          type="button"
                                          onClick={() => setShowPasswords((prev) => ({ ...prev, [c.id]: !prev[c.id] }))}
                                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors duration-200"
                                        >
                                          {showPasswords[c.id] ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                                        </button>
                                      </div>
                                      <div
                                        className={cn(
                                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/20 transition-all duration-300',
                                          passwordGateStatus[c.id] === 'empty' || passwordGateStatus[c.id] === 'bad'
                                            ? 'border-red-300 bg-red-50 text-red-500 scale-105'
                                            : passwordGateStatus[c.id] === 'ok'
                                              ? 'border-emerald-200 bg-emerald-50 text-emerald-600 shadow-sm scale-105'
                                              : 'border-transparent text-muted-foreground scale-100'
                                        )}
                                      >
                                        {passwordGateStatus[c.id] === 'checking' && (
                                          <IconLoader2 size={16} className="animate-spin text-primary" />
                                        )}
                                        {passwordGateStatus[c.id] === 'ok' && <IconCheck size={18} strokeWidth={3} />}
                                        {(passwordGateStatus[c.id] === 'bad' || passwordGateStatus[c.id] === 'empty') && (
                                          <IconX size={16} strokeWidth={2.5} />
                                        )}
                                      </div>
                                   </div>
                                 </div>
                               )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
           </div>
        </div>
      </div>
    </div>
  );
};

export default Upload;
