import { AppMode } from '../types'

interface Props {
  apiKey: string
  onApiKeyChange: (key: string) => void
  isRunning: boolean
  isConnecting: boolean
  onToggle: () => void
  error: string | null
  mode: AppMode
  onModeChange: (mode: AppMode) => void
  elapsed: number
  contextPct: number
  tokenUsage: number
  contextLimit: number
}

function formatElapsed(seconds: number): string {
  const min = String(Math.floor(seconds / 60)).padStart(2, '0')
  const sec = String(seconds % 60).padStart(2, '0')
  return `${min}:${sec}`
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

export function Header({
  apiKey,
  onApiKeyChange,
  isRunning,
  isConnecting,
  onToggle,
  error,
  mode,
  onModeChange,
  elapsed,
  contextPct,
  tokenUsage,
  contextLimit,
}: Props) {
  const canStart = apiKey.trim().length > 0 && !isConnecting

  const subtitle =
    mode === 'podcast'
      ? 'Um entrevistador e um especialista analisando seu documento ponto a ponto, ao vivo.'
      : 'Duas instâncias do Gemini Live conversando entre si em tempo real, exclusivamente por áudio.'

  const contextColor =
    contextPct > 85 ? 'bg-red-500' : contextPct > 60 ? 'bg-yellow-500' : 'bg-green-500'

  const timerColor =
    elapsed > 7 * 60 ? 'text-red-400' : elapsed > 6 * 60 ? 'text-yellow-400' : 'text-green-400'

  return (
    <header className="flex flex-col items-center gap-5 py-10">
      {/* Título */}
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-4xl font-black text-white tracking-tight">
          {mode === 'podcast' ? 'Podcast de IAs' : 'Duelo de IAs'}
        </h1>
        <p className="text-gray-400 text-center max-w-md text-sm leading-relaxed">
          {subtitle}
        </p>
      </div>

      {/* Seletor de modo */}
      <div className="flex items-center rounded-xl border border-gray-700 bg-gray-800/50 p-1 gap-1">
        <button
          onClick={() => onModeChange('duelo')}
          disabled={isRunning || isConnecting}
          className={`px-5 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            mode === 'duelo'
              ? 'bg-white text-gray-900'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          Duelo
        </button>
        <button
          onClick={() => onModeChange('podcast')}
          disabled={isRunning || isConnecting}
          className={`px-5 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            mode === 'podcast'
              ? 'bg-white text-gray-900'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          Podcast
        </button>
      </div>

      {/* API Key — só visível quando parado */}
      {!isRunning && !isConnecting && (
        <div className="flex flex-col items-center gap-1.5 w-full max-w-sm">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider self-start">
            Gemini API Key
          </label>
          <input
            type="password"
            placeholder="AIza..."
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 border border-gray-700 focus:border-gray-500 outline-none text-sm placeholder:text-gray-600"
          />
        </div>
      )}

      {/* Mensagem de erro */}
      {error && (
        <div className="text-red-300 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-5 py-3 max-w-lg text-center">
          {error}
        </div>
      )}

      {/* Botão de controle */}
      <button
        onClick={onToggle}
        disabled={!isRunning && !canStart}
        className={`
          px-10 py-3 rounded-xl font-semibold text-sm tracking-wide transition-all duration-150
          disabled:opacity-40 disabled:cursor-not-allowed
          ${
            isRunning
              ? 'bg-red-600 hover:bg-red-500 active:scale-95 text-white'
              : isConnecting
              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
              : 'bg-white hover:bg-gray-100 active:scale-95 text-gray-900'
          }
        `}
      >
        {isConnecting
          ? 'Conectando...'
          : isRunning
          ? mode === 'podcast' ? 'Parar Podcast' : 'Parar Conversa'
          : mode === 'podcast' ? 'Iniciar Podcast' : 'Iniciar Conversa'}
      </button>

      {/* Status quando rodando: timer + barra de contexto */}
      {isRunning && (
        <div className="flex flex-col items-center gap-3 w-full max-w-sm">
          {/* Timer + status */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-green-400 text-xs">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              {mode === 'podcast' ? 'Podcast em andamento' : 'Conversa em andamento'}
            </div>
            <span className={`font-mono text-sm font-semibold ${timerColor}`}>
              {formatElapsed(elapsed)}
            </span>
          </div>

          {/* Barra de janela de contexto */}
          {tokenUsage > 0 && (
            <div className="w-full flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${contextColor}`}
                    style={{ width: `${contextPct}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 flex-shrink-0">
                  {formatTokens(tokenUsage)} / {formatTokens(contextLimit)}
                </span>
              </div>
              {contextPct > 85 && (
                <p className="text-xs text-center text-yellow-400/80">
                  Contexto quase cheio — a conversa pode encerrar em breve
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </header>
  )
}
