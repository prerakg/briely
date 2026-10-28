import React, { useState, useRef } from 'react';
import { DocumentTextIcon, XMarkIcon, ArrowUpTrayIcon, DocumentIcon, PhotoIcon } from './icons';
import { parseFile } from '../services/fileParserService';

interface FileUploaderProps {
    onUploadComplete: (combinedText: string, titles: string[]) => void;
    onCancel: () => void;
}

const FileUploader: React.FC<FileUploaderProps> = ({ onUploadComplete, onCancel }) => {
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [progressStr, setProgressStr] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const newFiles = Array.from(e.target.files);
            setSelectedFiles((prev) => [...prev, ...newFiles]);
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = ''; // reset
        }
    };

    const removeFile = (index: number) => {
        setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    };

    const getFileIcon = (type: string, name: string) => {
        if (type.startsWith('image/')) return <PhotoIcon className="w-6 h-6 text-indigo-500" />;
        if (type === 'application/pdf' || name.endsWith('.pdf')) return <DocumentTextIcon className="w-6 h-6 text-red-500" />;
        return <DocumentIcon className="w-6 h-6 text-blue-500" />;
    };

    const handleProcessFiles = async () => {
        if (selectedFiles.length === 0) return;
        setIsProcessing(true);
        let combinedText = '';
        const titles = [];

        try {
            for (let i = 0; i < selectedFiles.length; i++) {
                const file = selectedFiles[i];
                setProgressStr(`Parsing ${file.name} (${i + 1}/${selectedFiles.length})...`);
                const parsedText = await parseFile(file);
                combinedText += parsedText + '\n\n';
                titles.push(file.name);
            }
            onUploadComplete(combinedText, titles);
        } catch (error: any) {
            console.error("Error processing files", error);
            alert(`Failed to process files: ${error.message}`);
        } finally {
            setIsProcessing(false);
            setProgressStr('');
        }
    };

    return (
        <div className="flex flex-col h-full bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
                <div>
                    <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Combine Learning Resources</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Upload PDFs, DOCX, Images, or Text files to combine them into one unified study set.</p>
                </div>
                <button onClick={onCancel} className="p-2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:text-slate-300 rounded-full hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
                    <XMarkIcon className="w-6 h-6" />
                </button>
            </div>

            <div className="flex-1 p-6 overflow-y-auto">
                <div 
                    className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-10 text-center hover:bg-slate-50 dark:hover:bg-slate-700 dark:bg-slate-800 transition-colors cursor-pointer"
                    role="button"
                    tabIndex={0}
                    aria-label="Choose or drop study files"
                    onKeyDown={e => {if(e.key === 'Enter' || e.key === ' ') {e.preventDefault();fileInputRef.current?.click();}}}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {e.preventDefault();if(!isProcessing)setSelectedFiles(prev => [...prev,...Array.from(e.dataTransfer.files)]);}}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <ArrowUpTrayIcon className="w-12 h-12 text-indigo-400 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200 mb-1">Click or drag files here</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Supports .pdf, .docx, .pptx, .txt, .png, .jpg</p>
                    <input 
                        type="file" 
                        multiple 
                        ref={fileInputRef} 
                        onChange={handleFileSelect} 
                        className="hidden"
                        accept=".pdf,.docx,.doc,.pptx,.txt,.md,image/*"
                    />
                </div>

                {selectedFiles.length > 0 && (
                    <div className="mt-8">
                        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 uppercase tracking-wider">Selected Files ({selectedFiles.length})</h4>
                        <div className="space-y-3">
                            {selectedFiles.map((file, idx) => (
                                <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-800">
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        {getFileIcon(file.type, file.name)}
                                        <div className="truncate">
                                            <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{file.name}</p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => removeFile(idx)}
                                        className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-red-500 rounded-md hover:bg-red-50 dark:bg-red-900/30 transition-colors"
                                        disabled={isProcessing}
                                    >
                                        <XMarkIcon className="w-5 h-5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between">
                <div className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
                    {isProcessing ? (
                        <div className="flex items-center gap-2">
                            <div className="animate-spin h-4 w-4 border-2 border-indigo-600 border-t-transparent rounded-full"></div>
                            {progressStr}
                        </div>
                    ) : (
                        selectedFiles.length > 0 ? `${selectedFiles.length} file(s) ready` : ''
                    )}
                </div>
                <div className="flex gap-3">
                    <button 
                        onClick={onCancel}
                        disabled={isProcessing}
                        className="px-4 py-2 text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleProcessFiles}
                        disabled={selectedFiles.length === 0 || isProcessing}
                        className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                        {isProcessing ? 'Processing...' : 'Combine & Generate'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FileUploader;
