export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="space-y-4 text-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  )
} 