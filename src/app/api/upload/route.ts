import { NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!
})
import crypto from 'crypto'

const MAX_CHUNK_SIZE = 750 * 1024 // 750KB per chunk to stay safely under Upstash's 1MB limit
const MAX_TOTAL_SIZE = 100 * 1024 * 1024 // 100MB total limit
const EXPIRY_TIME = 120 // 2 minutes in seconds

export async function POST(req: Request) {
  try {
    const { file, fileName } = await req.json()

    // Extract the actual base64 data (remove data URL prefix if present)
    const base64Data = file.split(',')[1] || file
    const actualData = Buffer.from(base64Data, 'base64')
    
    // Only check raw size initially to prevent obvious oversized files
    if (actualData.length > MAX_TOTAL_SIZE * 2) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 100MB' },
        { status: 400 }
      )
    }

    // Generate a random 6-character code
    const code = crypto.randomBytes(3).toString('hex').toUpperCase()
    
    // Split file into smaller chunks
    const chunks = []
    let offset = 0
    while (offset < file.length) {
      chunks.push(file.slice(offset, offset + MAX_CHUNK_SIZE))
      offset += MAX_CHUNK_SIZE
    }

    // Check total size after chunking
    const totalSize = chunks.reduce((size, chunk) => size + chunk.length, 0)
    if (totalSize * 0.75 > MAX_TOTAL_SIZE) {
      return NextResponse.json(
        { error: `File too large after processing. Maximum size is ${formatFileSize(MAX_TOTAL_SIZE)}` },
        { status: 400 }
      )
    }

    // Store file metadata
    const metadata = {
      fileName,
      chunks: chunks.length,
      totalSize: totalSize * 0.75, // Approximate actual file size
      createdAt: Date.now(),
      expiresAt: Date.now() + (EXPIRY_TIME * 1000), // Expiration timestamp
      downloaded: false
    }

    // Add code to tracking set with expiration
    await redis.sadd('active_files', code)
    await redis.expire('active_files', EXPIRY_TIME)

    // Store metadata first
    await redis.set(`${code}:meta`, JSON.stringify(metadata), { ex: EXPIRY_TIME })
    
    // Store chunks in separate requests to avoid pipeline size limit
    for (let i = 0; i < chunks.length; i++) {
      await redis.set(`${code}:chunk:${i}`, chunks[i], { ex: EXPIRY_TIME })
    }
    
    // Schedule cleanup after expiration
    setTimeout(async () => {
      try {
        const metaStr = await redis.get(`${code}:meta`) as string
        if (metaStr) {
          const meta = JSON.parse(metaStr)
          if (!meta.downloaded) {
            await cleanupFile(code, chunks.length)
          }
        }
      } catch (error) {
        console.error('Cleanup error:', error)
      }
    }, EXPIRY_TIME * 1000)
    
    // Generate download URL
    const downloadUrl = `${req.headers.get('origin')}/api/download?code=${code}`
    
    return NextResponse.json({ 
      code, 
      downloadUrl,
      size: formatFileSize(metadata.totalSize),
      expiresIn: EXPIRY_TIME
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    )
  }
}

async function cleanupFile(code: string, numChunks: number) {
  try {
    // Remove metadata
    await redis.del(`${code}:meta`)
    
    // Remove all chunks
    for (let i = 0; i < numChunks; i++) {
      await redis.del(`${code}:chunk:${i}`)
    }
    
    // Remove from tracking set
    await redis.srem('active_files', code)
  } catch (error) {
    console.error(`Failed to cleanup file ${code}:`, error)
  }
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}