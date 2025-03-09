'use client';

import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import JSZip from 'jszip';
import { ThemeToggle } from '@/components/theme-toggle';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 100MB in bytes
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 100MB total limit

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const fileListStyles = `
  max-height: ${32 * 4}px; // Show 4 files at a time
  overflow-y: auto;
  scrollbar-width: thin;
  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background-color: rgba(0, 0, 0, 0.2);
    border-radius: 3px;
  }
`;

export default function Home() {
  const [activeTab, setActiveTab] = useState<'send' | 'receive'>('send');
  const [files, setFiles] = useState<File[]>([]);
  const [code, setCode] = useState<string>('');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedCode, setUploadedCode] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadedFileInfo, setUploadedFileInfo] = useState<{ name: string; size: string } | null>(null);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (uploadedCode && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((time) => {
          if (time <= 1) {
            setUploadedCode(null);
            setDownloadUrl(null);
            setUploadedFileInfo(null);
            return 0;
          }
          return time - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [uploadedCode, timeLeft]);

  const getTotalSize = (fileList: File[]) => {
    return fileList.reduce((total, file) => total + file.size, 0);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    const totalSize = getTotalSize(selectedFiles);

    if (totalSize > MAX_TOTAL_SIZE) {
      setError(`Total file size exceeds 100MB limit (${formatFileSize(totalSize)})`);
      setFiles([]);
      e.target.value = '';
      return;
    }
    setFiles(selectedFiles);
    setError(null);
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    
    setLoading(true);
    setError(null);
    setUploadProgress(0);

    try {
      let base64Data: string;
      let fileName: string;

      const shouldZip = files.length > 1 || 
        (files[0].size > 1024 * 1024 && 
          (files[0].type.includes('text/') || 
           files[0].type.includes('image/svg') ||
           files[0].name.match(/\.(js|css|html|txt|md|json|xml|csv|yml|yaml)$/i)));

      if (shouldZip) {
        const zip = new JSZip();
        let processedFiles = 0;
        
        for (const file of files) {
          const arrayBuffer = await file.arrayBuffer();
          const isCompressible = file.type.includes('text/') || 
            file.type.includes('image/svg') ||
            file.name.match(/\.(js|css|html|txt|md|json|xml|csv|yml|yaml)$/i);
          
          zip.file(file.name, arrayBuffer, {
            compression: isCompressible ? 'DEFLATE' : 'STORE',
            compressionOptions: { level: isCompressible ? 6 : 0 }
          });

          processedFiles++;
          setUploadProgress(Math.round((processedFiles / files.length) * 50));
        }

        const zipBlob = await zip.generateAsync({ 
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 }
        }, (metadata) => {
          setUploadProgress(50 + Math.round(metadata.percent / 2));
        });

        if (zipBlob.size > getTotalSize(files) && files.length === 1) {
          const reader = new FileReader();
          base64Data = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(files[0]);
          });
          fileName = files[0].name;
        } else {
          const reader = new FileReader();
          base64Data = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(zipBlob);
          });
          fileName = files.length > 1 ? 'files.zip' : files[0].name + '.zip';
        }
      } else {
        const reader = new FileReader();
        base64Data = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(files[0]);
        });
        fileName = files[0].name;
      }

      setUploadProgress(75);

      // Strip data URL prefix
      const cleanBase64Data = base64Data.split(',')[1] || base64Data;

      const protocol = window.location.protocol;
      const domain = process.env.NODE_ENV === 'development' 
        ? window.location.hostname === 'localhost' 
          ? window.location.hostname + ':' + window.location.port
          : window.location.host
        : window.location.host;
      const baseUrl = `${protocol}//${domain}`;

      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: cleanBase64Data,
          fileName
        }),
      });

      setUploadProgress(100);

      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setUploadedFileInfo({
        name: fileName,
        size: data.size || formatFileSize(cleanBase64Data.length * 0.75) // Approximate
      });
      setUploadedCode(data.code);
      setDownloadUrl(`${baseUrl}/api/download?code=${data.code}`);
      setTimeLeft(data.expiresIn || 120);
      setFiles([]);

      if (data.size) {
        console.log(`File uploaded successfully. Final size: ${data.size}`);
      }
    } catch (err) {
      console.error('Upload error:', err);
      setError(err instanceof Error ? err.message : 'Failed to upload file');
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  const handleDownload = async () => {
    if (!code) {
      setError('Please enter a code');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/download?code=${code}`);
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to download file');
      }

      const contentDisposition = response.headers.get('Content-Disposition');
      const fileName = contentDisposition
        ? contentDisposition.split('filename=')[1].replace(/"/g, '')
        : 'downloaded-file';

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download file');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 dark:from-background dark:to-background/80">
      <ThemeToggle />
      <div className="container mx-auto px-4 py-16 flex flex-col min-h-screen">
        <main className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto w-full">
          <div className="text-center space-y-4 mb-12">
            <h1 className="text-5xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 dark:from-primary/80 dark:to-primary/40 bg-clip-text text-transparent">
              File Sender
            </h1>
            <p className="text-lg text-muted-foreground">
              Securely send files to anyone, anywhere
            </p>
          </div>

          <div className="w-full bg-card rounded-xl shadow-lg border overflow-hidden dark:border-muted">
            <div className="grid grid-cols-2 divide-x divide-border border-b dark:divide-muted dark:border-muted">
              <button
                onClick={() => setActiveTab('send')}
                className={`py-4 text-sm font-medium transition-colors ${
                  activeTab === 'send'
                    ? 'bg-background text-primary dark:bg-muted'
                    : 'text-muted-foreground hover:bg-muted/50'
                }`}
              >
                Send a File
              </button>
              <button
                onClick={() => setActiveTab('receive')}
                className={`py-4 text-sm font-medium transition-colors ${
                  activeTab === 'receive'
                    ? 'bg-background text-primary dark:bg-muted'
                    : 'text-muted-foreground hover:bg-muted/50'
                }`}
              >
                Receive a File
              </button>
            </div>

            <div className="p-8">
              {activeTab === 'send' ? (
                <div className="space-y-6">
                  <div className="relative group">
                    <input 
                      type="file"
                      multiple
                      onChange={handleFileChange}
                      className="hidden"
                      id="file-upload"
                    />
                    <label 
                      htmlFor="file-upload"
                      className="flex flex-col items-center justify-center w-full min-h-[8rem] rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/5 hover:bg-muted/10 transition-colors cursor-pointer p-4 dark:border-muted-foreground/20 dark:hover:bg-muted/5"
                    >
                      <div className="text-center w-full">
                        {files.length > 0 ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between px-2">
                              <span className="text-primary font-medium">
                                {files.length} {files.length === 1 ? 'file' : 'files'} selected
                              </span>
                              <span className="text-xs text-muted-foreground">
                                Total size: {formatFileSize(getTotalSize(files))}
                              </span>
                            </div>
                            <div className="border-t border-border/50 pt-2">
                              <div className="max-h-[128px] overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
                                {files.map((file, index) => (
                                  <div 
                                    key={index}
                                    className="flex items-center justify-between py-1 px-2 hover:bg-muted/5 rounded text-sm"
                                  >
                                    <span className="truncate flex-1 text-left text-muted-foreground">
                                      {file.name}
                                    </span>
                                    <span className="text-xs text-muted-foreground ml-2">
                                      {formatFileSize(file.size)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="text-muted-foreground">
                              <span className="font-medium">Click to upload</span> or drag and drop
                              <br />
                              <span className="text-xs">
                                Multiple files allowed (Total max: 100MB)
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </label>
                  </div>

                  {error && (
                    <div className="text-sm text-red-500 bg-red-500/10 dark:bg-red-500/5 p-3 rounded-lg">
                      {error}
                    </div>
                  )}

                  <button 
                    onClick={handleUpload} 
                    disabled={loading || files.length === 0}
                    className="w-full py-3 px-4 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 dark:disabled:opacity-30"
                  >
                    {loading ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Uploading... {uploadProgress}%</span>
                      </>
                    ) : (
                      <>
                        {files.length > 0 ? `Upload ${files.length} ${files.length === 1 ? 'file' : 'files'}` : 'Upload Files'}
                        {files.length > 1 && <span className="text-xs">(Will be zipped)</span>}
                      </>
                    )}
                  </button>

                  {uploadedCode && (
                    <div className="mt-8 space-y-6 p-6 bg-muted/10 dark:bg-muted/5 rounded-lg">
                      <div className="flex flex-col items-center text-center space-y-4">
                        {uploadedFileInfo && (
                          <div className="w-full p-3 bg-muted/20 dark:bg-muted/10 rounded-lg space-y-1">
                            <p className="text-sm font-medium text-primary">Uploaded Successfully</p>
                            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                              <span className="truncate max-w-[200px]">{uploadedFileInfo.name}</span>
                              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                                {uploadedFileInfo.size}
                              </span>
                            </div>
                          </div>
                        )}
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground">Share this code with the recipient</p>
                          <p className="text-4xl font-mono font-bold tracking-wider text-primary">
                            {uploadedCode}
                          </p>
                        </div>
                        <div className="bg-white p-4 rounded-lg border border-gray-200 dark:border-gray-600">
                          <QRCodeSVG value={downloadUrl || ''} size={180} bgColor="#FFFFFF" fgColor="#000000" />
                        </div>
                      </div>
                      <div className="flex flex-col items-center space-y-2">
                        <div className="text-3xl font-mono font-bold">
                          {timeLeft > 0 ? (
                            <span className={`${timeLeft <= 30 ? 'text-red-500 animate-pulse' : 'text-primary'}`}>
                              {formatTime(timeLeft)}
                            </span>
                          ) : (
                            <span className="text-red-500">Expired</span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {timeLeft > 0 ? (
                            timeLeft <= 30 ? 
                              "Hurry! Link expires soon" :
                              "Time remaining"
                          ) : (
                            "This link has expired"
                          )}
                        </p>
                        <div className="w-full h-2 bg-muted/20 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary transition-all duration-1000 ease-linear"
                            style={{ 
                              width: `${(timeLeft / 120) * 100}%`,
                              backgroundColor: timeLeft <= 30 ? 'rgb(239, 68, 68)' : undefined
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label htmlFor="code" className="text-sm font-medium text-muted-foreground">
                      Enter your download code
                    </label>
                    <input
                      id="code"
                      type="text"
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      placeholder="Enter 6-digit code"
                      className="w-full px-4 py-3 rounded-lg border bg-muted/5 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-muted-foreground/50 dark:bg-muted/10 dark:border-muted"
                    />
                  </div>

                  {error && (
                    <div className="text-sm text-red-500 bg-red-500/10 dark:bg-red-500/5 p-3 rounded-lg">
                      {error}
                    </div>
                  )}

                  <button
                    onClick={handleDownload}
                    disabled={loading || !code}
                    className="w-full py-3 px-4 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {loading ? 'Downloading...' : 'Download File'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </main>

        <footer className="text-center py-8 text-sm text-muted-foreground">
          © {new Date().getFullYear()} File Sender. All rights reserved.
        </footer>
      </div>
    </div>
  );
}