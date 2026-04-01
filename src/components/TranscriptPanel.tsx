import { useEffect, useRef } from 'react'
import { TranscriptEntry } from '../types'

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

interface Props {
  entries: TranscriptEntry[]
  agent1Name: string
  agent2Name: string
}

export function TranscriptPanel({ entries, agent1Name, agent2Name }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length])

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 text-center">
        <p className="text-gray-600 text-sm">A transcrição aparecerá aqui conforme os agentes falam...</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/50 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          Transcrição
        </span>
        <span className="text-xs text-gray-600">{entries.length} falas</span>
      </div>
      <div className="max-h-80 overflow-y-auto p-4 flex flex-col gap-3">
        {entries.map((entry, i) => {
          const isAgent1 = entry.agent === 1
          const name = isAgent1 ? agent1Name : agent2Name
          const nameColor = isAgent1 ? 'text-blue-400' : 'text-orange-400'
          return (
            <div key={i} className="flex gap-2 text-sm">
              <span className="text-gray-600 flex-shrink-0 font-mono text-xs leading-6">
                {formatTime(entry.timestamp)}
              </span>
              <div className="min-w-0">
                <span className={`font-semibold ${nameColor}`}>{name}:</span>{' '}
                <span className="text-gray-300">{entry.text}</span>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
