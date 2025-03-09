import { NextResponse } from 'next/server'
import { redis } from '@/lib/redis'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const code = searchParams.get('code')

    if (!code) {
      return NextResponse.json(
        { error: 'No code provided' },
        { status: 400 }
      )
    }

    // Get file metadata from Redis
    const metadata = await redis.get(`${code}:meta`)
    
    if (!metadata) {
      return NextResponse.json(
        { error: 'File not found or link expired' },
        { status: 404 }
      )
    }

    const { fileName, chunks } = metadata

    // Get all chunks sequentially to avoid request size limits
    const fileChunks = []
    for (let i = 0; i < chunks; i++) {
      const chunk = await redis.get(`${code}:chunk:${i}`)
      if (!chunk) {
        throw new Error(`Missing chunk ${i}`)
      }
      fileChunks.push(chunk)
    }

    // Combine chunks
    const file = fileChunks.join('')

    // Mark as downloaded and clean up
    try {
      // Update metadata to mark as downloaded
      await redis.set(`${code}:meta`, { ...metadata, downloaded: true }, { 
        ex: Math.ceil((metadata.expiresAt - Date.now()) / 1000) 
      })

      // Clean up chunks immediately
      for (let i = 0; i < chunks; i++) {
        await redis.del(`${code}:chunk:${i}`)
      }

      // Remove from tracking set
      await redis.srem('active_files', code)
    } catch (error) {
      console.error('Cleanup error:', error)
      // Continue with the response even if cleanup fails
    }

    // Ensure we have a valid base64 string
    const base64Data = file.split(',')[1] || file

    // Create response with the file
    const response = new NextResponse(Buffer.from(base64Data, 'base64'), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    })

    return response
  } catch (error) {
    console.error('Download error:', error)
    return NextResponse.json(
      { error: 'Failed to download file' },
      { status: 500 }
    )
  }
} 