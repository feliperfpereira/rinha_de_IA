interface Props {
  apiKey: string
  onApiKeyChange: (key: string) => void
  isRunning: boolean
  isConnecting: boolean
  onToggle: () => void
  error: string | null
}

export function Header({
  apiKey,
  onApiKeyChange,
  isRunning,
  isConnecting,
  onToggle,
  error,
}: Props) {
  const canStart = apiKey.trim().length > 0 && !isConnecting

  return (
    <header className="flex flex-col items-center gap-5 py-10">
      {/* Título */}
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-4xl font-black text-white tracking-tight">
          Duelo de IAs
        </h1>
        <p className="text-gray-400 text-center max-w-md text-sm leading-relaxed">
          Duas instâncias do Gemini Live conversando entre si em tempo real,
          exclusivamente por áudio.
        </p>
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
          ? 'Parar Conversa'
          : 'Iniciar Conversa'}
      </button>

      {/* Indicador de status quando rodando */}
      {isRunning && (
        <div className="flex items-center gap-2 text-green-400 text-xs">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          Conversa em andamento
        </div>
      )}
    </header>
  )
}
