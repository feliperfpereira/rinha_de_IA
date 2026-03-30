import { AgentConfig, VoiceName } from '../types'

const VOICES: VoiceName[] = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']

interface Props {
  config: AgentConfig
  onChange: (config: AgentConfig) => void
  isSpeaking: boolean
  accentColor: 'blue' | 'orange'
  disabled: boolean
}

export function AgentPanel({ config, onChange, isSpeaking, accentColor, disabled }: Props) {
  const borderColor = accentColor === 'blue'
    ? 'border-blue-500/30'
    : 'border-orange-500/30'

  const bgColor = accentColor === 'blue'
    ? 'bg-blue-500/5'
    : 'bg-orange-500/5'

  const ledActiveColor = accentColor === 'blue' ? '#60a5fa' : '#fb923c'
  const ledActiveBg = accentColor === 'blue' ? 'bg-blue-400' : 'bg-orange-400'
  const titleColor = accentColor === 'blue' ? 'text-blue-300' : 'text-orange-300'
  const focusBorder = accentColor === 'blue' ? 'focus:border-blue-500' : 'focus:border-orange-500'

  return (
    <div className={`rounded-2xl border ${borderColor} ${bgColor} p-6 flex flex-col gap-5`}>
      {/* Cabeçalho do agente: LED + Nome */}
      <div className="flex items-center gap-3">
        <div
          className={`relative flex-shrink-0 w-3.5 h-3.5 rounded-full transition-colors duration-200 ${
            isSpeaking ? `${ledActiveBg} animate-speaking` : 'bg-gray-600'
          }`}
          style={
            isSpeaking
              ? { boxShadow: `0 0 10px 2px ${ledActiveColor}` }
              : undefined
          }
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

      {/* Seletor de Voz */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          Voz
        </label>
        <select
          value={config.voice}
          onChange={(e) => onChange({ ...config, voice: e.target.value as VoiceName })}
          disabled={disabled}
          className="bg-gray-800/80 text-gray-200 rounded-lg px-3 py-2.5 border border-gray-700 hover:border-gray-600 outline-none disabled:opacity-50 text-sm cursor-pointer"
        >
          {VOICES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {/* Instrução de sistema (Personalidade) */}
      <div className="flex flex-col gap-1.5 flex-1">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          Personalidade
        </label>
        <textarea
          value={config.systemInstruction}
          onChange={(e) => onChange({ ...config, systemInstruction: e.target.value })}
          disabled={disabled}
          rows={7}
          placeholder="Descreva a personalidade, tom e comportamento deste agente..."
          className="bg-gray-800/80 text-gray-200 rounded-lg px-3 py-2.5 border border-gray-700 hover:border-gray-600 outline-none resize-none text-sm disabled:opacity-50 placeholder:text-gray-600 leading-relaxed"
        />
      </div>
    </div>
  )
}
