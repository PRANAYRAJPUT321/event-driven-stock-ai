'use client'

import { useRouter } from 'next/navigation'

export default function Watchlist() {
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
          <h1 className="text-3xl font-bold text-gray-900 mb-2">My Watchlist</h1>
          <p className="text-gray-600 mb-8">Track your favorite stocks and their event-driven scores</p>

          <div className="text-center py-16 text-gray-500">
            <p className="text-lg">📝 Your watchlist is empty</p>
            <p className="text-sm mt-2">Add stocks from analysis results to monitor them here</p>
            <button
              onClick={() => router.push('/analyze')}
              className="mt-6 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg"
            >
              Analyze an Event
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
