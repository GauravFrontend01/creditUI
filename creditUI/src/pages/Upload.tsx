import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  IconUpload,
  IconMail,
  IconRefresh,
  IconUnlink,
  IconLock,
  IconBrain,
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

const GMAIL_UPLOAD_CACHE_KEY = 'creditUI_gmail_upload_cache_v1';

type GmailCachePayload = {
  email: string;
  candidates: any[];
  selectedIds: string[];
  candidatePasswords: Record<string, string>;
  statementType: 'CREDIT_CARD' | 'BANK';
};

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
    setCandidates(cached.candidates);
    setSelectedIds(cached.selectedIds?.length ? cached.selectedIds : cached.candidates.map((c: any) => c.id));
    setCandidatePasswords(cached.candidatePasswords || {});
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
    });
  }, [gmailStatus?.connected, gmailStatus?.email, candidates, selectedIds, candidatePasswords, statementType]);

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

  const fetchGmailCandidates = async () => {
    setGmailBusy(true);
    try {
      const { data } = await api.get('/api/gmail/candidates');
      const fetched = data.candidates || [];
      setCandidates(fetched);

      const fresh = fetched
        .filter((c: any) => !c.alreadyProcessed && (!c.isImported || !c.existsInDb))
        .map((c: any) => c.id);
      setSelectedIds(fresh);
      
      const passes: Record<string, string> = {};
      fetched.forEach((c: any) => {
        passes[c.id] = c.savedPassword || 'gaur2607';
      });
      setCandidatePasswords(passes);

      if (fetched.length === 0) {
        toast.message('No statement PDFs found in your recent emails.');
        clearGmailCache();
        setCandidates([]);
        setSelectedIds([]);
        setCandidatePasswords({});
      } else {
        toast.success(`Found ${fetched.length} potential statement(s).`);
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to fetch email candidates.');
    } finally {
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

  /** Same path as manual upload: fetch PDF → unlock in browser → POST with isUnlocked (no server-side decrypt). */
  const syncSelectedCandidates = async () => {
    if (selectedIds.length === 0) return;

    const rows = candidates.filter((c) => selectedIds.includes(c.id));
    setGmailBusy(true);
    let ok = 0;
    const failures: string[] = [];

    try {
      for (const c of rows) {
        if (c.alreadyProcessed) continue;
        const effectivePassword = String(candidatePasswords[c.id] || '').trim() || 'gaur2607';
        try {
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

          const file = new File([blob as Blob], c.filename, { type: 'application/pdf' });
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
            failures.push(`${c.filename}: already processed (${created.existingStatementId || 'existing record'})`);
          } else {
            ok += 1;
          }
        } catch (inner: unknown) {
          const msg = await parseAxiosErrorMessage(inner);
          failures.push(`${c.filename}: ${msg}`);
        }
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
      toast.success('Sync history cleared.');
      await refreshGmailStatus();
    } catch {
      toast.error('Could not reset sync history.');
    } finally {
      setGmailBusy(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight text-primary">
          Statement Upload
        </h1>
        <p className="text-muted-foreground">
          Single pipeline: unlock PDF on backend, store unlocked file, process with Vertex Gemini 2.5 Flash, and save to your statement history.
        </p>
      </div>

      <Card className="rounded-2xl p-6 bg-muted/20 border border-primary/10 space-y-4">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Statement type (manual upload &amp; Gmail sync)
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

      <Card className="rounded-2xl p-6 bg-muted/20 border border-primary/10 space-y-5">
        <h2 className="text-lg font-semibold">Manual Upload</h2>

        <div className="flex flex-col gap-4">
          <label className="relative border border-dashed border-primary/20 rounded-xl p-8 text-center bg-background cursor-pointer">
            <input type="file" className="hidden" onChange={handleFileChange} accept=".pdf" />
            <div className="flex flex-col items-center gap-2">
              <IconUpload size={28} className="text-primary/70" />
              <p className="font-medium">{file ? file.name : 'Select PDF statement'}</p>
              <p className="text-xs text-muted-foreground">Only PDF files are supported</p>
            </div>
          </label>

          {file && (
            <>
              <div className="relative">
                <input
                  type="password"
                  placeholder="Enter PDF password"
                  className="flex h-11 w-full rounded-xl border border-primary/10 bg-background px-3 py-2 pl-10 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <IconLock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </div>
              <Button onClick={startUpload} disabled={isUploading} className="h-11 rounded-xl gap-2">
                <IconBrain size={16} />
                {isUploading ? 'Processing...' : 'Upload & Process'}
              </Button>
            </>
          )}
          {errorHeader && <p className="text-xs text-red-500 font-semibold">{errorHeader}</p>}
        </div>
      </Card>

      <Card className="rounded-2xl p-6 bg-muted/20 border border-primary/10 space-y-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-background text-primary">
            <IconMail size={18} />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Gmail Sync</h2>
            <p className="text-xs text-muted-foreground">
              PDFs are downloaded here, unlocked in the browser (same as manual upload), then sent with <span className="font-semibold text-foreground">isUnlocked</span> so the server skips decrypt and runs the same Vertex pipeline.
              Your last inbox scan list and passwords stay on this page until you <span className="font-semibold text-foreground">Reset</span> or{' '}
              <span className="font-semibold text-foreground">Disconnect</span> (or until a new scan returns no PDFs).
            </p>
            {gmailStatus?.connected && gmailStatus.email && (
              <p className="text-xs text-emerald-700 font-semibold">Connected: {gmailStatus.email}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {!gmailStatus?.connected ? (
            <Button type="button" onClick={connectGmail} disabled={gmailBusy}>
              {gmailBusy ? 'Opening...' : 'Connect Gmail'}
            </Button>
          ) : (
            <>
              <Button type="button" onClick={fetchGmailCandidates} disabled={gmailBusy} className="gap-2">
                <IconRefresh size={16} className={cn(gmailBusy && 'animate-spin')} />
                {gmailBusy ? 'Scanning...' : 'Scan Inbox'}
              </Button>
              <Button type="button" variant="outline" onClick={resetGmailSync} disabled={gmailBusy}>
                Reset
              </Button>
              <Button type="button" variant="outline" onClick={disconnectGmail} disabled={gmailBusy} className="gap-2">
                <IconUnlink size={14} />
                Disconnect
              </Button>
            </>
          )}
        </div>

        {candidates.length > 0 && (
          <div className="space-y-4 border-t border-primary/10 pt-4">
            <p className="text-[11px] text-muted-foreground font-medium">
              Select PDFs (same layout as manual: file name → password), then process.
            </p>
            {candidates.map((c) => {
              const isSelected = selectedIds.includes(c.id);
              const lockedAsDone = Boolean(c.alreadyProcessed);
              return (
                <div
                  key={c.id}
                  className={cn(
                    'rounded-xl border border-primary/10 bg-background p-4 space-y-3 transition-opacity',
                    (!isSelected || lockedAsDone) && 'opacity-60'
                  )}
                >
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1 rounded border-primary/30"
                      checked={isSelected}
                      disabled={lockedAsDone}
                      onChange={() =>
                        setSelectedIds((prev) => (isSelected ? prev.filter((id) => id !== c.id) : [...prev, c.id]))
                      }
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium break-all">{c.filename}</p>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{c.bank}</span>
                        {c.parsedPeriod?.from && c.parsedPeriod?.to && (
                          <span>· {c.parsedPeriod.from} to {c.parsedPeriod.to}</span>
                        )}
                        {lockedAsDone && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100 font-semibold">
                            already_processed
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                  {isSelected && !lockedAsDone && (
                    <div className="pl-7">
                      <div className="relative">
                        <input
                          type="password"
                          placeholder="Enter PDF password"
                          className="flex h-11 w-full rounded-xl border border-primary/10 bg-background px-3 py-2 pl-10 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                          value={candidatePasswords[c.id] || ''}
                          onChange={(e) => setCandidatePasswords((prev) => ({ ...prev, [c.id]: e.target.value }))}
                        />
                        <IconLock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <Button
              type="button"
              onClick={syncSelectedCandidates}
              disabled={gmailBusy || selectedIds.length === 0}
              className="w-full h-11 rounded-xl gap-2"
            >
              <IconBrain size={16} />
              {gmailBusy ? 'Processing...' : `Process selected (${selectedIds.length})`}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
};

export default Upload;
