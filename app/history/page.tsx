'use client'

import { useRouter } from 'next/navigation'

export default function History() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      <header className="bg-white shadow sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <button onClick={() => router.push('/dashboard')} className="text-blue-600 hover:text-blue-700 text-sm">
            ← Dashboard
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-12">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Analysis History</h1>
          <p className="text-gray-600 mb-8">View all your past event analyses and recommendations</p>

          <div className="text-center py-16 text-gray-500">
            <p className="text-lg">📋 No analyses yet</p>
            <p className="text-sm mt-2">Your analysis history will appear here</p>
            <button
              onClick={() => router.push('/analyze')}
              className="mt-6 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg"
            >
              Analyze First Event
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
