'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function DownloadPage() {
  const searchParams = useSearchParams();
  const [code, setCode] = useState(searchParams.get('code') || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    if (!code) {
      setError('Please enter a code');
      return;
    }

    try {
      setLoading(true);
      setError('');
      
      const response = await fetch(`/api/download?code=${code}`);
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to download file');
      }

      // Get filename from the Content-Disposition header
      const contentDisposition = response.headers.get('Content-Disposition');
      const fileName = contentDisposition
        ? contentDisposition.split('filename=')[1].replace(/"/g, '')
        : 'downloaded-file';

      // Create blob and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download file');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-between p-8">
      <main className="flex flex-col items-center justify-center flex-1 max-w-4xl mx-auto w-full space-y-8">
        <div className="space-y-4 text-center">
          <h1 className="text-4xl font-bold tracking-tight">Download File</h1>
          <p className="text-lg text-muted-foreground">
            Enter your code to download the file
          </p>
        </div>
        
        <div className="w-full max-w-md p-8 border rounded-lg bg-card text-card-foreground shadow-sm">
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="code" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Download Code
              </label>
              <input
                id="code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Enter your code here"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
            <button
              onClick={handleDownload}
              disabled={loading || !code}
              className="w-full inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? 'Downloading...' : 'Download File'}
            </button>
          </div>
        </div>
      </main>

      <footer className="w-full text-center py-4 text-sm text-muted-foreground">
        © {new Date().getFullYear()} File Sender. All rights reserved.
      </footer>
    </div>
  );
} 