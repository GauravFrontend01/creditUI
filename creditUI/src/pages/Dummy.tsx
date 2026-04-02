import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { IconTerminal2, IconFileUpload, IconPlayerPlay, IconBraces, IconCheck, IconX, IconMathFunction } from '@tabler/icons-react';

export default function Dummy() {
  const [json, setJson] = useState('');
  const [pdfB64, setPdfB64] = useState('');
  const [fileName, setFileName] = useState('');
  const [reconResult, setReconResult] = useState<any>(null);
  const navigate = useNavigate();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      setPdfB64(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const calculateReconciliation = (data: any) => {
    try {
      const txs = data.transactions || [];
      const extractedDebits = txs
        .filter((t: any) => t.type === 'Debit' && !t.description?.toUpperCase().includes('FP EMI'))
        .reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
      const extractedCredits = txs.filter((t: any) => t.type === 'Credit').reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
      
      const summary = data.reconciliationSummary || {};
      const totalDebits = summary.totalDebits || extractedDebits;
      const totalCredits = summary.totalCredits || extractedCredits;
      const opening = summary.openingBalance || 0;
      const closing = summary.closingBalance || 0;

      const calcClosing = opening + totalDebits - totalCredits;
      const balanceDelta = Math.abs(calcClosing - closing);
      const debitDelta = Math.abs(extractedDebits - totalDebits);
      const creditDelta = Math.abs(extractedCredits - totalCredits);

      const matched = balanceDelta < 0.01 && debitDelta < 0.01 && creditDelta < 0.01;
      const reasons = [];
      if (balanceDelta >= 0.01) reasons.push(`Formula mismatch: Opening (${opening.toFixed(2)}) + Debits (${totalDebits.toFixed(2)}) - Credits (${totalCredits.toFixed(2)}) = ${calcClosing.toFixed(2)}, which differs from Printed Closing (${closing.toFixed(2)})`);
      if (debitDelta >= 0.01) reasons.push(`Extracted Debits (₹${extractedDebits.toFixed(2)}) ≠ Printed Debits (₹${totalDebits.toFixed(2)})`);
      if (creditDelta >= 0.01) reasons.push(`Extracted Credits (₹${extractedCredits.toFixed(2)}) ≠ Printed Credits (₹${totalCredits.toFixed(2)})`);

      return {
        matched,
        reasons,
        extractedDebits,
        extractedCredits,
        totalDebits,
        totalCredits,
        opening,
        closing,
        calcClosing,
        debitDelta,
        creditDelta,
        balanceDelta
      };
    } catch (e) {
      return null;
    }
  }

  const handleJsonChange = (val: string) => {
    setJson(val);
    try {
      const parsed = JSON.parse(val);
      setReconResult(calculateReconciliation(parsed));
    } catch (e) {
      setReconResult(null);
    }
  }

  const handleRender = () => {
    try {
      const parsed = JSON.parse(json);
      const recon = calculateReconciliation(parsed);
      const finalData = { ...parsed, reconciliation: recon };
      
      sessionStorage.setItem('extraction_result', JSON.stringify(finalData));
      sessionStorage.setItem('pdf_base64', pdfB64);
      sessionStorage.setItem('pdf_raw_name', fileName);
      navigate('/statement');
    } catch (err) {
      alert('Invalid JSON');
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-primary/60 uppercase tracking-[0.2em] text-xs font-semibold">
          <IconTerminal2 size={16} />
          <span>Developer Tools</span>
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 leading-[1.1]">Neural Injection Vault</h1>
        <p className="text-slate-500 font-medium">Bypass AI inference and manually inject spatial data for UI verification. Now with real-time math validation.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-8 flex flex-col gap-6">
            <Card className="rounded-[2rem] p-8 border-slate-200 shadow-xl space-y-6 shadow-slate-100/50">
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                        <IconBraces size={18} className="text-primary" />
                        Extraction JSON Payload
                    </label>
                    <div className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-bold text-slate-400 font-mono tracking-widest uppercase">application/json</div>
                </div>
                <textarea 
                placeholder='{ "bankName": "Test Bank", "transactions": [...] }'
                className="w-full flex min-h-[500px] font-mono text-[11px] bg-slate-50 border border-slate-100 rounded-2xl p-4 resize-none focus-visible:outline-none focus:ring-1 focus:ring-primary/20 leading-relaxed"
                value={json}
                onChange={(e) => handleJsonChange(e.target.value)}
                />
            </div>
            </Card>
        </div>

        <div className="lg:col-span-4 space-y-6">
            <Card className="rounded-[2.5rem] p-8 border-slate-200 shadow-xl shadow-slate-100/50 space-y-6">
                <div className="space-y-4">
                    <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                        <IconFileUpload size={18} className="text-primary" />
                        Source PDF File
                    </label>
                    <Input 
                        type="file" 
                        accept="application/pdf"
                        className="rounded-xl border-slate-200 text-xs h-12 bg-slate-50"
                        onChange={handleFileChange}
                    />
                    {fileName && <p className="text-[10px] text-slate-400 font-mono italic">Ready: {fileName}</p>}
                </div>

                <div className="pt-6 border-t border-slate-100 space-y-4">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <IconMathFunction size={14} />
                        Live Reconciliation
                    </label>
                    
                    {!reconResult ? (
                        <div className="p-4 bg-slate-50 rounded-2xl text-[10px] text-slate-400 font-mono italic">
                            Waiting for valid JSON input...
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className={cn(
                                "p-4 rounded-2xl flex items-center gap-3",
                                reconResult.matched ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-red-50 text-red-700 border border-red-100"
                            )}>
                                {reconResult.matched ? <IconCheck size={20} /> : <IconX size={20} />}
                                <div className="flex flex-col">
                                    <span className="text-sm font-black uppercase tracking-tight">{reconResult.matched ? "Math Verified" : "Extraction Error"}</span>
                                    <span className="text-[10px] font-medium opacity-70">{reconResult.reasons.length || "All systems nominal"}</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                                    <p className="text-[9px] uppercase font-bold text-slate-400 mb-1">Extracted Debits</p>
                                    <p className="text-xs font-black font-mono">₹{reconResult.extractedDebits.toFixed(2)}</p>
                                </div>
                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                                    <p className="text-[9px] uppercase font-bold text-slate-400 mb-1">Extracted Credits</p>
                                    <p className="text-xs font-black font-mono">₹{reconResult.extractedCredits.toFixed(2)}</p>
                                </div>
                            </div>

                            <div className="p-5 bg-slate-900 rounded-[1.5rem] text-white space-y-4 shadow-xl shadow-slate-200">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-white/10 pb-2">Audit Trail (Math)</p>
                                
                                <div className="space-y-2 font-mono text-[11px]">
                                    <div className="flex justify-between items-center opacity-60">
                                        <span>Opening Balance</span>
                                        <span>{reconResult.opening.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-emerald-400">
                                        <span>+ Total Debits</span>
                                        <span>{reconResult.totalDebits.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-rose-400">
                                        <span>- Total Credits</span>
                                        <span>{reconResult.totalCredits.toFixed(2)}</span>
                                    </div>
                                    <div className="pt-2 border-t border-white/10 flex justify-between items-center font-bold text-sm">
                                        <span className="text-slate-400 font-sans uppercase text-[10px] tracking-tight">Calc Closing</span>
                                        <span>{reconResult.calcClosing.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between items-center font-bold text-sm border-b border-white/10 pb-2">
                                        <span className="text-slate-400 font-sans uppercase text-[10px] tracking-tight">Printed Closing</span>
                                        <span>{reconResult.closing.toFixed(2)}</span>
                                    </div>

                                    {reconResult.balanceDelta >= 0.01 && (
                                        <div className="pt-1 text-rose-400 flex justify-between items-center font-black">
                                            <span className="uppercase text-[9px]">Unreconciled Delta</span>
                                            <span>₹{reconResult.balanceDelta.toFixed(2)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {reconResult.reasons.length > 0 && (
                                <div className="p-4 bg-rose-50/50 border border-rose-100 rounded-2xl space-y-2">
                                    <p className="text-[10px] font-bold text-rose-600 uppercase tracking-widest">Discrepancy Log</p>
                                    <ul className="space-y-1.5">
                                        {reconResult.reasons.map((r: string, i: number) => (
                                            <li key={i} className="text-[10px] text-rose-800 flex items-start gap-2 leading-relaxed">
                                                <div className="w-1.5 h-1.5 rounded-full bg-rose-400 mt-1 shrink-0" />
                                                {r}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <Button 
                    onClick={handleRender}
                    disabled={!json || !pdfB64}
                    className="w-full h-16 rounded-3xl text-sm font-black bg-slate-900 hover:bg-slate-800 gap-2 shadow-lg tracking-widest uppercase transition-all active:scale-[0.98] mt-4"
                >
                    <IconPlayerPlay size={18} strokeWidth={2.5}/> Execute Render
                </Button>
            </Card>
        </div>
      </div>
    </div>
  );
}
