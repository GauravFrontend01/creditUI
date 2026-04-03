import { useState, useEffect } from 'react';
import { 
  IconBrain, 
  IconFileUpload, 
  IconLoader2, 
  IconDeviceFloppy, 
  IconHistory, 
  IconBraces,
  IconPlayerPlay,
  IconX,
  IconFileOff
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import api from '@/lib/api';

const MistralOCR = () => {
    const [file, setFile] = useState<File | null>(null);
    const [ocrResult, setOcrResult] = useState<any>(null);
    const [pdfBase64, setPdfBase64] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [savedExtractions, setSavedExtractions] = useState<any[]>([]);
    const [showHistory, setShowHistory] = useState(false);

    useEffect(() => {
        const history = localStorage.getItem('mistral_ocr_history');
        if (history) setSavedExtractions(JSON.parse(history));
    }, []);

    const handleUpload = async () => {
        if (!file) return;
        setLoading(true);
        const formData = new FormData();
        formData.append('pdf', file);

        try {
            const { data } = await api.post('/api/mistral/ocr', formData);
            setOcrResult(data.ocrData);
            setPdfBase64(data.pdfBase64);
        } catch (error: any) {
            console.error('Mistral OCR Error', error);
            alert(error.response?.data?.message || 'OCR Failed');
        } finally {
            setLoading(false);
        }
    };

    const saveToLocal = () => {
        if (!ocrResult) return;
        const newEntry = {
            id: Date.now(),
            fileName: file?.name || 'unknown.pdf',
            data: ocrResult,
            // Store a subset of pdf if we want to preview it, but let's just store the result for now
            date: new Date().toLocaleString()
        };
        const updated = [newEntry, ...savedExtractions];
        setSavedExtractions(updated);
        localStorage.setItem('mistral_ocr_history', JSON.stringify(updated));
    };

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] bg-slate-50">
            {/* Header */}
            <header className="h-16 bg-white border-b flex items-center justify-between px-8 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
                        <IconBrain size={24} />
                    </div>
                    <div>
                        <h1 className="text-sm font-black uppercase tracking-widest text-slate-800 leading-none">Mistral Audit Intelligence</h1>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Multi-modal Document Understanding</p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <input 
                        type="file" 
                        accept="application/pdf" 
                        id="mistral-file" 
                        className="hidden" 
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                    <label htmlFor="mistral-file" className="cursor-pointer h-10 px-4 rounded-xl border border-dashed border-slate-200 hover:bg-slate-50 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest transition-all">
                        <IconFileUpload size={16} />
                        {file ? file.name : "Select 1st Page PDF"}
                    </label>

                    <Button 
                        disabled={!file || loading} 
                        onClick={handleUpload}
                        className="h-10 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-100 font-bold text-[10px] uppercase tracking-widest gap-2"
                    >
                        {loading ? <IconLoader2 size={16} className="animate-spin" /> : <IconPlayerPlay size={16} />}
                        Execute OCR
                    </Button>

                    <div className="w-px h-6 bg-slate-200 mx-2" />

                    <Button 
                        variant="ghost" 
                        onClick={() => setShowHistory(!showHistory)}
                        className={cn("h-10 w-10 p-0 rounded-xl transition-all", showHistory ? "bg-indigo-50 text-indigo-600" : "hover:bg-slate-100 text-slate-400")}
                    >
                        <IconHistory size={20} />
                    </Button>
                </div>
            </header>

            <div className="flex-1 flex overflow-hidden relative">
                {/* History Sidebar */}
                {showHistory && (
                    <div className="absolute inset-y-0 left-0 w-80 bg-white border-r shadow-2xl z-20 animate-in slide-in-from-left duration-300 flex flex-col">
                        <div className="p-6 border-b flex items-center justify-between">
                            <h2 className="text-sm font-black uppercase tracking-widest text-slate-800">Extraction History</h2>
                            <Button variant="ghost" size="sm" onClick={() => setShowHistory(false)}><IconX size={16}/></Button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {savedExtractions.map(ex => (
                                <Card key={ex.id} className="p-4 rounded-2xl hover:bg-slate-50 cursor-pointer transition-all border-slate-100 group" onClick={() => { setOcrResult(ex.data); setFile({name: ex.fileName} as File); setShowHistory(false); }}>
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="text-[10px] font-black uppercase text-indigo-600 truncate mr-2">{ex.fileName}</p>
                                        <button className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-opacity" onClick={(e) => {
                                            e.stopPropagation();
                                            const updated = savedExtractions.filter(item => item.id !== ex.id);
                                            setSavedExtractions(updated);
                                            localStorage.setItem('mistral_ocr_history', JSON.stringify(updated));
                                        }}>
                                            <IconX size={12} />
                                        </button>
                                    </div>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{ex.date}</p>
                                </Card>
                            ))}
                            {savedExtractions.length === 0 && (
                                <div className="py-20 text-center flex flex-col items-center gap-4 text-slate-300">
                                    <IconHistory size={40} strokeWidth={1} />
                                    <p className="text-[10px] font-bold uppercase tracking-widest">History Empty</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Left Panel: OCR Result */}
                <div className="flex-1 overflow-y-auto p-8 relative scrollbar-hide">
                    {ocrResult ? (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between sticky top-0 bg-slate-50/80 backdrop-blur pb-4 z-10">
                                <h2 className="text-sm font-black uppercase tracking-widest text-slate-800 flex items-center gap-2">
                                    <IconBraces size={18} className="text-indigo-600" />
                                    Forensic Markdown
                                </h2>
                                <Button size="sm" variant="outline" onClick={saveToLocal} className="h-9 px-4 rounded-xl font-bold text-[9px] uppercase tracking-widest gap-2 bg-white hover:bg-indigo-50 hover:text-indigo-600 transition-all">
                                    <IconDeviceFloppy size={14} />
                                    Save to Vault
                                </Button>
                            </div>
                            
                            <div className="bg-white rounded-3xl border shadow-sm p-8 space-y-8">
                                {ocrResult.pages?.map((page: any, i: number) => (
                                    <div key={i} className="space-y-4">
                                        <div className="flex items-center gap-3">
                                            <span className="text-[10px] font-black bg-slate-900 text-white px-3 py-1 rounded-full">PAGE {page.index + 1}</span>
                                            <div className="h-px flex-1 bg-slate-100" />
                                            <span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">{page.markdown?.length || 0} chars</span>
                                        </div>
                                        <div className="prose prose-slate max-w-none">
                                            <pre className="text-[12px] font-mono p-6 bg-slate-50/50 rounded-2xl border border-slate-100 overflow-x-auto whitespace-pre-wrap leading-relaxed text-slate-600">
                                                {page.markdown}
                                            </pre>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-6">
                            <div className="w-24 h-24 bg-indigo-50 rounded-[2.5rem] flex items-center justify-center text-indigo-400 animate-in zoom-in duration-700">
                                <IconBraces size={48} />
                            </div>
                            <div className="space-y-3">
                                <h3 className="text-2xl font-bold tracking-tight text-slate-800">Ready for Neural Sync</h3>
                                <p className="text-slate-500 font-medium text-sm leading-relaxed">
                                    Upload a single page PDF to execute the Mistral multi-modal OCR engine. 
                                    We'll extract layout-aware markdown and spatial data directly.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Right Panel: PDF Viewer */}
                <div className="w-1/2 border-l bg-slate-100/50 overflow-hidden flex flex-col relative">
                    {pdfBase64 ? (
                        <iframe 
                            src={pdfBase64} 
                            className="flex-1 w-full border-none" 
                            title="Mistral Source Document"
                        />
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-300 space-y-4">
                            <IconFileOff size={64} strokeWidth={1} className="opacity-50" />
                            <div className="text-center space-y-1">
                                <p className="text-[10px] font-black uppercase tracking-[0.2em]">Document Source Pending</p>
                                <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Awaiting PDF Ingestion</p>
                            </div>
                        </div>
                    )}
                    
                    {/* Floating Info */}
                    <div className="absolute bottom-6 right-6 p-4 bg-white/80 backdrop-blur border rounded-2xl shadow-xl max-w-xs space-y-2 pointer-events-none">
                        <div className="flex items-center gap-2 text-[9px] font-black uppercase text-indigo-600">
                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
                            Mistral-OCR-Latest
                        </div>
                        <p className="text-[9px] leading-relaxed text-slate-500 font-medium">Processing restricted to 1st page per forensic mandate.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MistralOCR;
