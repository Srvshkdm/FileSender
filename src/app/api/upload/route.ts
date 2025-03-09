import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import crypto from 'crypto';

const MAX_CHUNK_SIZE = 750 * 1024;
const MAX_TOTAL_SIZE = 100 * 1024 * 1024;
const EXPIRY_TIME = 600; // Increased to 10 minutes for testing

interface FileMetadata {
  fileName: string;
  chunks: number;
  totalSize: number;
  createdAt: number;
  expiresAt: number;
  downloaded: boolean;
}

export async function POST(req: Request) {
  try {
    console.log('Request headers:', Object.fromEntries(req.headers.entries()));
    const rawBody = await req.text();
    console.log('Raw request body:', rawBody);

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch (parseError) {
      console.error('JSON parsing error:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON format in request body' },
        { status: 400 }
      );
    }

    const { file, fileName } = body;
    if (!file || !fileName || typeof file !== 'string' || typeof fileName !== 'string') {
      return NextResponse.json(
        { error: 'Invalid request: file and fileName must be strings' },
        { status: 400 }
      );
    }

    const base64Data = file.split(',')[1] || file;
    const actualData = Buffer.from(base64Data, 'base64');

    if (actualData.length > MAX_TOTAL_SIZE * 2) {
      return NextResponse.json({ error: 'File too large. Maximum size is 100MB' }, { status: 400 });
    }

    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    const chunks = [];
    let offset = 0;
    while (offset < file.length) {
      chunks.push(file.slice(offset, offset + MAX_CHUNK_SIZE));
      offset += MAX_CHUNK_SIZE;
    }

    const totalSize = chunks.reduce((size, chunk) => size + chunk.length, 0);
    if (totalSize * 0.75 > MAX_TOTAL_SIZE) {
      return NextResponse.json(
        { error: `File too large after processing. Maximum size is ${formatFileSize(MAX_TOTAL_SIZE)}` },
        { status: 400 }
      );
    }

    const metadata: FileMetadata = {
      fileName,
      chunks: chunks.length,
      totalSize: totalSize * 0.75,
      createdAt: Date.now(),
      expiresAt: Date.now() + EXPIRY_TIME * 1000,
      downloaded: false,
    };

    await redis.sadd('active_files', code);
    await redis.expire('active_files', EXPIRY_TIME);
    await redis.set(`${code}:meta`, JSON.stringify(metadata), { ex: EXPIRY_TIME });
    console.log(`Metadata stored for code: ${code}`, metadata);

    for (let i = 0; i < chunks.length; i++) {
      const key = `${code}:chunk:${i}`;
      await redis.set(key, chunks[i], { ex: EXPIRY_TIME });
      console.log(`Chunk ${i} stored for code: ${code}, length: ${chunks[i].length}`);
    }

    setTimeout(async () => {
      try {
        const metaString = await redis.get(`${code}:meta`) as string | null;
        let meta: FileMetadata | null = null;
        if (metaString) {
          meta = JSON.parse(metaString) as FileMetadata;
        }
        if (meta && !meta.downloaded) {
          await cleanupFile(code, chunks.length);
          console.log(`Cleanup completed for code: ${code}`);
        }
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }, EXPIRY_TIME * 1000);

    const downloadUrl = `${req.headers.get('origin')}/api/download?code=${code}`;
    return NextResponse.json({
      code,
      downloadUrl,
      size: formatFileSize(metadata.totalSize),
      expiresIn: EXPIRY_TIME,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
  }
}

async function cleanupFile(code: string, numChunks: number) {
  try {
    await redis.del(`${code}:meta`);
    for (let i = 0; i < numChunks; i++) {
      await redis.del(`${code}:chunk:${i}`);
    }
    await redis.srem('active_files', code);
    console.log(`Cleanup executed for code: ${code}`);
  } catch (error) {
    console.error(`Failed to cleanup file ${code}:`, error);
  }
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}