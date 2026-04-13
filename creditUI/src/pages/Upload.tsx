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

const Upload = () => {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setFile(e.target.files[0]);
    setPassword('');
    setErrorHeader('');
  };

  const startUpload = async () => {
    if (!file) return;
    if (!password.trim()) {
      toast.error('Please enter the PDF password');
      return;
    }

    setIsUploading(true);
    setErrorHeader('');

    const formData = new FormData();
    formData.append('pdf', file);
    formData.append('pdfPassword', password.trim());
    formData.append('statementType', statementType);

    try {
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
        .filter((c: any) => !c.isImported || !c.existsInDb)
        .map((c: any) => c.id);
      setSelectedIds(fresh);
      
      const passes: Record<string, string> = {};
      fetched.forEach((c: any) => {
        if (c.savedPassword) passes[c.id] = c.savedPassword;
      });
      setCandidatePasswords(passes);

      if (fetched.length === 0) {
        toast.message('No statement PDFs found in your recent emails.');
      } else {
        toast.success(`Found ${fetched.length} potential statement(s).`);
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to fetch email candidates.');
    } finally {
      setGmailBusy(false);
    }
  };

  const syncSelectedCandidates = async () => {
    if (selectedIds.length === 0) return;
    const missingPassword = candidates
      .filter(c => selectedIds.includes(c.id))
      .find(c => !String(candidatePasswords[c.id] || '').trim());
    if (missingPassword) {
      toast.error(`Password missing for ${missingPassword.filename}`);
      return;
    }

    setGmailBusy(true);
    try {
      const selections = candidates
        .filter(c => selectedIds.includes(c.id))
        .map(c => ({
          messageId: c.messageId,
          filename: c.filename,
          password: String(candidatePasswords[c.id] || '').trim(),
          statementType,
        }));

      const { data } = await api.post('/api/gmail/sync-selected', { selections });
      const n = data.created?.length || 0;
      if (n > 0) {
        toast.success(`Successfully processed ${n} statement(s).`);
        setCandidates([]);
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

      <Card className="rounded-2xl p-6 bg-muted/20 border border-primary/10 space-y-5">
        <h2 className="text-lg font-semibold">Manual Upload</h2>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] text-muted-foreground">Statement Type</span>
            <div className="flex gap-2">
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

      <Card className="rounded-2xl p-6 bg-muted/20 border border-primary/10 space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-background text-primary">
            <IconMail size={18} />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Gmail Sync</h2>
            <p className="text-xs text-muted-foreground">
              Fetch statement PDFs from Gmail, enter passwords, and process with the same backend pipeline.
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
          <div className="space-y-3 border-t border-primary/10 pt-4">
            {candidates.map((c) => {
              const isSelected = selectedIds.includes(c.id);
              return (
                <div key={c.id} className={cn('p-3 rounded-xl border bg-background', !isSelected && 'opacity-60')}>
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() =>
                          setSelectedIds((prev) => (isSelected ? prev.filter((id) => id !== c.id) : [...prev, c.id]))
                        }
                      />
                      <span>{c.filename}</span>
                    </label>
                    <span className="text-[11px] text-muted-foreground">{c.bank}</span>
                  </div>
                  {isSelected && (
                    <div className="mt-2">
                      <input
                        type="password"
                        placeholder="Enter PDF password"
                        className="flex h-9 w-full rounded-lg border border-primary/10 bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                        value={candidatePasswords[c.id] || ''}
                        onChange={(e) => setCandidatePasswords((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            <Button onClick={syncSelectedCandidates} disabled={gmailBusy || selectedIds.length === 0} className="w-full">
              {gmailBusy ? 'Processing...' : `Process Selected (${selectedIds.length})`}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
};

export default Upload;
