import { useRef } from 'react'
import { AgentConfig, UploadedDocument, VoiceName } from '../types'
import {
  estimateTokens,
  formatTokenCount,
  readFileAsText,
  MAX_DOCUMENT_TOKENS,
} from '../utils/document'

const VOICES: VoiceName[] = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']

interface Props {
  config: AgentConfig
  onChange: (config: AgentConfig) => void
  isSpeaking: boolean
  accentColor: 'blue' | 'orange'
  disabled: boolean
}

export function AgentPanel({ config, onChange, isSpeaking, accentColor, disabled }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const borderColor = accentColor === 'blue' ? 'border-blue-500/30' : 'border-orange-500/30'
  const bgColor = accentColor === 'blue' ? 'bg-blue-500/5' : 'bg-orange-500/5'
  const ledActiveColor = accentColor === 'blue' ? '#60a5fa' : '#fb923c'
  const ledActiveBg = accentColor === 'blue' ? 'bg-blue-400' : 'bg-orange-400'
  const titleColor = accentColor === 'blue' ? 'text-blue-300' : 'text-orange-300'
  const focusBorder = accentColor === 'blue' ? 'focus:border-blue-500' : 'focus:border-orange-500'
  const accentBorder = accentColor === 'blue' ? 'border-blue-500/40 hover:border-blue-400/60' : 'border-orange-500/40 hover:border-orange-400/60'

  const freeTextTokens = estimateTokens(config.freeText)
  const totalDocTokens = config.documents.reduce((sum, d) => sum + d.estimatedTokens, 0) + freeTextTokens
  const budgetPct = Math.min(100, (totalDocTokens / MAX_DOCUMENT_TOKENS) * 100)
  const budgetColor = budgetPct > 85 ? 'bg-red-500' : budgetPct > 60 ? 'bg-yellow-500' : 'bg-green-500'

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const newDocs: UploadedDocument[] = []
    for (const file of Array.from(files)) {
      try {
        const content = await readFileAsText(file)
        if (!content.trim()) continue
        newDocs.push({
          fileName: file.name,
          content,
          charCount: content.length,
          estimatedTokens: estimateTokens(content),
        })
      } catch {
        // silently skip unreadable files
      }
    }
    if (newDocs.length > 0) {
      onChange({ ...config, documents: [...config.documents, ...newDocs] })
    }
  }

  function removeDoc(index: number) {
    onChange({ ...config, documents: config.documents.filter((_, i) => i !== index) })
  }

  return (
    <div className={`rounded-2xl border ${borderColor} ${bgColor} p-6 flex flex-col gap-5`}>
      {/* Cabeçalho: LED + Nome */}
      <div className="flex items-center gap-3">
        <div
          className={`relative flex-shrink-0 w-3.5 h-3.5 rounded-full transition-colors duration-200 ${
            isSpeaking ? `${ledActiveBg} animate-speaking` : 'bg-gray-600'
          }`}
          style={isSpeaking ? { boxShadow: `0 0 10px 2px ${ledActiveColor}` } : undefined}
        />
        <input
          type="text"
          value={config.name}
          onChange={(e) => onChange({ ...config, name: e.target.value })}
          disabled={disabled}
          placeholder="Nome do agente"
          className={`bg-transparent font-semibold text-xl ${titleColor} border-b border-gray-700 ${focusBorder} outline-none flex-1 pb-0.5 disabled:opacity-50 placeholder:text-gray-600`}
        />
      </div>

      {/* Voz */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Voz</label>
        <select
          value={config.voice}
          onChange={(e) => onChange({ ...config, voice: e.target.value as VoiceName })}
          disabled={disabled}
          className="bg-gray-800/80 text-gray-200 rounded-lg px-3 py-2.5 border border-gray-700 hover:border-gray-600 outline-none disabled:opacity-50 text-sm cursor-pointer"
        >
          {VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      {/* Personalidade */}
      <div className="flex flex-col gap-1.5 flex-1">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Personalidade</label>
        <textarea
          value={config.systemInstruction}
          onChange={(e) => onChange({ ...config, systemInstruction: e.target.value })}
          disabled={disabled}
          rows={5}
          placeholder="Descreva a personalidade, tom e comportamento deste agente..."
          className="bg-gray-800/80 text-gray-200 rounded-lg px-3 py-2.5 border border-gray-700 hover:border-gray-600 outline-none resize-none text-sm disabled:opacity-50 placeholder:text-gray-600 leading-relaxed"
        />
      </div>

      {/* Base de Conhecimento */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          Base de Conhecimento
        </label>

        {/* Chips de arquivos */}
        {config.documents.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {config.documents.map((doc, i) => (
              <div
                key={i}
                className="flex items-center gap-2 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-300 text-xs truncate flex-1 min-w-0">{doc.fileName}</span>
                <span className="text-gray-500 text-xs flex-shrink-0">{formatTokenCount(doc.estimatedTokens)}</span>
                {!disabled && (
                  <button
                    onClick={() => removeDoc(i)}
                    className="text-gray-600 hover:text-gray-400 flex-shrink-0 ml-1"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
              </div>
            ))}

            {/* Barra de budget */}
            <div className="flex items-center gap-2 mt-0.5">
              <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${budgetColor}`}
                  style={{ width: `${budgetPct}%` }}
                />
              </div>
              <span className="text-xs text-gray-500 flex-shrink-0">
                {formatTokenCount(totalDocTokens)} / ~80k
              </span>
            </div>

            {totalDocTokens > MAX_DOCUMENT_TOKENS && (
              <p className="text-xs text-yellow-500/80">
                Documentos serão truncados para caber no limite de contexto.
              </p>
            )}
          </div>
        )}

        {/* Texto livre */}
        <textarea
          value={config.freeText}
          onChange={(e) => onChange({ ...config, freeText: e.target.value })}
          disabled={disabled}
          rows={3}
          placeholder="Cole aqui qualquer texto de referência (trechos, anotações, resumos...)"
          className="bg-gray-800/80 text-gray-200 rounded-lg px-3 py-2.5 border border-gray-700 hover:border-gray-600 outline-none resize-none text-sm disabled:opacity-50 placeholder:text-gray-600 leading-relaxed"
        />

        {/* Botão de upload */}
        {!disabled && (
          <>
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-lg border border-dashed ${accentBorder} text-gray-500 hover:text-gray-400 text-xs transition-colors duration-150`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H7.707L9 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              Adicionar arquivo (.txt, .md, .csv)
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.csv"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </>
        )}
      </div>
    </div>
  )
}
