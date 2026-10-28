import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { extractTextFromImage } from './geminiService';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Setup pdf.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export const parsePdf = async (file: File): Promise<string> => {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        let fullText = '';

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
                .map((item: any) => item.str)
                .join(' ');
            fullText += pageText + '\n\n';
        }

        return fullText.trim();
    } catch (error: any) {
        console.error("Error parsing PDF:", error);
        throw new Error(`Failed to parse PDF file: ${error.message || error}`);
    }
};

export const parseDocx = async (file: File): Promise<string> => {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        return result.value.trim();
    } catch (error: any) {
        console.error("Error parsing DOCX:", error);
        throw new Error(`Failed to parse Word document: ${error.message || error}`);
    }
};

export const parsePptx = async (file: File): Promise<string> => {
    try {
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(file);
        
        let fullText = '';
        
        const slideFiles = Object.keys(loadedZip.files).filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'));
        
        slideFiles.sort((a, b) => {
            const numA = parseInt(a.replace(/[^0-9]/g, '')) || 0;
            const numB = parseInt(b.replace(/[^0-9]/g, '')) || 0;
            return numA - numB;
        });

        for (const slideName of slideFiles) {
            const slideFile = loadedZip.files[slideName];
            const xmlContent = await slideFile.async('string');
            
            const regex = /<a:t[^>]*>([^<]*)<\/a:t>/g;
            let match;
            let slideText = '';
            while ((match = regex.exec(xmlContent)) !== null) {
                slideText += match[1] + ' ';
            }
            if (slideText.trim()) {
                fullText += `[Slide ${slideName.replace(/[^0-9]/g, '')}]\n${slideText.trim()}\n\n`;
            }
        }
        
        return fullText.trim();
    } catch (error: any) {
        console.error("Error parsing PPTX:", error);
        throw new Error(`Failed to parse PowerPoint file: ${error.message || error}`);
    }
};

export const parseTxt = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve((e.target?.result as string) || '');
        reader.onerror = () => reject(new Error("Failed to read text file."));
        reader.readAsText(file);
    });
};

export const parseFile = async (file: File): Promise<string> => {
    const fileType = file.type;
    const fileName = file.name.toLowerCase();

    let text = '';

    if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
        text = await parsePdf(file);
    } else if (
        fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        fileType === 'application/msword' ||
        fileName.endsWith('.docx') ||
        fileName.endsWith('.doc')
    ) {
        text = await parseDocx(file);
    } else if (
        fileType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
        fileType === 'application/vnd.ms-powerpoint' ||
        fileName.endsWith('.pptx') ||
        fileName.endsWith('.ppt')
    ) {
        if (fileName.endsWith('.ppt')) {
             throw new Error("Older .ppt format is not supported. Please convert to .pptx.");
        }
        text = await parsePptx(file);
    } else if (fileType.startsWith('text/') || fileName.endsWith('.txt') || fileName.endsWith('.md')) {
        text = await parseTxt(file);
    } else if (fileType.startsWith('image/')) {
        text = await extractTextFromImage(file);
    } else {
        throw new Error(`Unsupported file type: ${fileType || fileName}`);
    }

    return `\n--- SOURCE: ${file.name} ---\n${text}\n`;
};
