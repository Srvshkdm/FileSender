import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

interface FileMetadata {
  fileName: string;
  chunks: number;
  totalSize: number;
  createdAt: number;
  expiresAt: number;
  downloaded?: boolean;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    console.log('Download request for code:', code);

    const metadata = await redis.get<FileMetadata>(`${code}:meta`);
    console.log('Retrieved metadata:', metadata);

    if (!metadata) {
      console.log('Metadata not found for code:', code);
      return NextResponse.json(
        { error: 'File not found or link expired' },
        { status: 404 }
      );
    }

    const { fileName, chunks } = metadata;
    console.log(`Reassembling ${chunks} chunks for file: ${fileName}`);

    const fileChunks = [];
    for (let i = 0; i < chunks; i++) {
      const key = `${code}:chunk:${i}`;
      const chunk = await redis.get(key);
      console.log(`Chunk ${i} retrieved for key ${key}:`, chunk ? 'Success' : 'Failed');
      if (!chunk) {
        throw new Error(`Missing chunk ${i}`);
      }
      fileChunks.push(chunk);
    }

    const file = fileChunks.join('');
    console.log('Reassembled file length:', file.length);

    try {
      await redis.set(`${code}:meta`, JSON.stringify({ ...metadata, downloaded: true }), {
        ex: Math.ceil((metadata.expiresAt - Date.now()) / 1000)
      });
      for (let i = 0; i < chunks; i++) {
        await redis.del(`${code}:chunk:${i}`);
      }
      await redis.srem('active_files', code);
      console.log('Cleanup completed for code:', code);
    } catch (error) {
      console.error('Cleanup error:', error);
    }

    const base64Data = file.split(',')[1] || file;
    const buffer = Buffer.from(base64Data, 'base64');
    console.log('Decoded buffer length:', buffer.length);

    const response = new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': buffer.length.toString(),
      },
    });

    return response;
  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json(
      { error: 'Failed to download file' },
      { status: 500 }
    );
  }
}