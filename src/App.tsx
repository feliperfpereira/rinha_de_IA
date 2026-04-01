import { useRef, useState } from 'react'
import { GoogleGenAI } from '@google/genai'
import { AgentConfig } from './types'
import { Header } from './components/Header'
import { AgentPanel } from './components/AgentPanel'
import {
  base64PCMToInt16,
  int16ToBase64,
  resamplePCM,
  combineInt16Arrays,
  scheduleAudioChunk,
  encodeWAV,
} from './utils/audio'
import { buildSystemPrompt } from './utils/document'

// ---------------------------------------------------------------------------
// Configurações padrão dos agentes
// ---------------------------------------------------------------------------

const DEFAULT_AGENT1: AgentConfig = {
  name: 'Agente Filósofo',
  voice: 'Puck',
  thinkingLevel: 'minimal',
  systemInstruction:
    'Você é um filósofo apaixonado e curioso. Está em uma conversa de áudio com outro agente de IA. ' +
    'Responda de forma concisa (2 a 3 frases no máximo), faça perguntas instigantes e mantenha a conversa ' +
    'fluindo com ideias profundas e provocativas. Fale sempre em português brasileiro.',
  documents: [],
  freeText: '',
}

const DEFAULT_AGENT2: AgentConfig = {
  name: 'Agente Coach',
  voice: 'Zephyr',
  thinkingLevel: 'minimal',
  systemInstruction:
    'Você é um coach motivacional entusiasmado e prático. Está em uma conversa de áudio com outro agente de IA. ' +
    'Responda de forma concisa (2 a 3 frases no máximo), seja otimista e inspirador, conecte as ideias do outro ' +
    'agente com ações práticas do dia a dia. Fale sempre em português brasileiro.',
  documents: [],
  freeText: '',
}

// Tamanho do bloco ao enviar áudio para o próximo agente (em amostras a 16kHz)
const SEND_CHUNK_SAMPLES = 4800 // ~300ms a 16kHz

// Threshold de acumulação antes de enviar progressivamente (em amostras a 16kHz)
const STREAM_THRESHOLD_SAMPLES = 3200 // ~200ms — começa a enviar antes do turn terminar

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export default function App() {
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('gemini_api_key') ?? '')

  function handleApiKeyChange(key: string) {
    setApiKey(key)
    if (key) sessionStorage.setItem('gemini_api_key', key)
    else sessionStorage.removeItem('gemini_api_key')
  }
  const [isRunning, setIsRunning] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [agent1Config, setAgent1Config] = useState<AgentConfig>(DEFAULT_AGENT1)
  const [agent2Config, setAgent2Config] = useState<AgentConfig>(DEFAULT_AGENT2)
  const [agent1Speaking, setAgent1Speaking] = useState(false)
  const [agent2Speaking, setAgent2Speaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasRecording, setHasRecording] = useState(false)

  // Refs de sessão — acessadas de dentro de callbacks sem problema de stale closure
  const session1Ref = useRef<ReturnType<GoogleGenAI['live']['connect']> extends Promise<infer T> ? T : never>(null as never)
  const session2Ref = useRef<ReturnType<GoogleGenAI['live']['connect']> extends Promise<infer T> ? T : never>(null as never)

  // Contexto de áudio e agendamento de playback
  const audioCtxRef = useRef<AudioContext | null>(null)
  const nextPlayTime1 = useRef(0)
  const nextPlayTime2 = useRef(0)

  // Buffers de PCM já resampleado (16kHz) de cada agente para envio progressivo
  const pcmBuffer1 = useRef<Int16Array[]>([])
  const pcmBuffer1Len = useRef(0)
  const pcmBuffer2 = useRef<Int16Array[]>([])
  const pcmBuffer2Len = useRef(0)

  // Buffer de gravação: captura todos os chunks de áudio (ambos agentes) em ordem cronológica
  const recordingChunks = useRef<Int16Array[]>([])

  // Espelho de isRunning em ref para uso seguro em callbacks assíncronos
  const isRunningRef = useRef(false)

  // -------------------------------------------------------------------------
  // Reprodução de áudio
  // -------------------------------------------------------------------------

  function playAudioChunk(base64Data: string, agentIndex: 1 | 2) {
    const ctx = audioCtxRef.current
    if (!ctx) return
    try {
      const int16 = base64PCMToInt16(base64Data)
      const timeRef = agentIndex === 1 ? nextPlayTime1 : nextPlayTime2
      // O Gemini Live produz PCM 24kHz — reproduzimos diretamente
      scheduleAudioChunk(ctx, int16, 24000, timeRef)
      // Grava o chunk para download posterior
      recordingChunks.current.push(int16)
    } catch (e) {
      console.error('Erro ao reproduzir áudio do agente', agentIndex, e)
    }
  }

  // -------------------------------------------------------------------------
  // Envia chunks PCM acumulados progressivamente para o outro agente
  // -------------------------------------------------------------------------

  function flushPcmBuffer(fromAgent: 1 | 2) {
    const bufRef = fromAgent === 1 ? pcmBuffer1 : pcmBuffer2
    const lenRef = fromAgent === 1 ? pcmBuffer1Len : pcmBuffer2Len
    const targetSession = fromAgent === 1 ? session2Ref.current : session1Ref.current

    if (!targetSession || !isRunningRef.current) return

    const chunks = bufRef.current.splice(0)
    lenRef.current = 0

    if (chunks.length === 0) return

    const combined = combineInt16Arrays(chunks)
    for (let i = 0; i < combined.length; i += SEND_CHUNK_SAMPLES) {
      const slice = combined.slice(i, Math.min(i + SEND_CHUNK_SAMPLES, combined.length))
      targetSession.sendRealtimeInput({
        audio: { data: int16ToBase64(slice), mimeType: 'audio/pcm;rate=16000' },
      })
    }
  }

  // -------------------------------------------------------------------------
  // Handler de mensagens recebidas de cada sessão
  // -------------------------------------------------------------------------

  function handleMessage(response: any, agentIndex: 1 | 2) {
    const content = response.serverContent
    if (!content) return

    const pcmBuf = agentIndex === 1 ? pcmBuffer1 : pcmBuffer2
    const pcmLen = agentIndex === 1 ? pcmBuffer1Len : pcmBuffer2Len
    const setSpeaking = agentIndex === 1 ? setAgent1Speaking : setAgent2Speaking
    const targetSession = agentIndex === 1 ? session2Ref.current : session1Ref.current

    // Processa todos os parts do turn
    if (content.modelTurn?.parts) {
      for (const part of content.modelTurn.parts) {
        if (part.inlineData?.data) {
          setSpeaking(true)
          playAudioChunk(part.inlineData.data, agentIndex)

          // Reamostrar 24kHz → 16kHz e acumular para envio progressivo
          const resampled = resamplePCM(base64PCMToInt16(part.inlineData.data), 24000, 16000)
          pcmBuf.current.push(resampled)
          pcmLen.current += resampled.length

          // Enviar assim que acumular o threshold (~200ms) — sem esperar o turn terminar
          if (pcmLen.current >= STREAM_THRESHOLD_SAMPLES && targetSession && isRunningRef.current) {
            flushPcmBuffer(agentIndex)
          }
        }
      }
    }

    // Turn completo: flush do restante + sinaliza VAD do outro agente
    if (content.turnComplete) {
      setSpeaking(false)
      if (isRunningRef.current) {
        setTimeout(() => {
          flushPcmBuffer(agentIndex)
          const target = agentIndex === 1 ? session2Ref.current : session1Ref.current
          target?.sendRealtimeInput({ audioStreamEnd: true })
        }, 50)
      }
    }

    // Interrupção: descarta o buffer pendente deste agente
    if (content.interrupted) {
      setSpeaking(false)
      pcmBuf.current = []
      pcmLen.current = 0
    }
  }

  // -------------------------------------------------------------------------
  // Download da gravação
  // -------------------------------------------------------------------------

  function downloadRecording() {
    const chunks = recordingChunks.current
    if (chunks.length === 0) return
    const combined = combineInt16Arrays(chunks)
    const blob = encodeWAV(combined, 24000)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `duelo-de-ias-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.wav`
    a.click()
    URL.revokeObjectURL(url)
  }

  // -------------------------------------------------------------------------
  // Iniciar conversa
  // -------------------------------------------------------------------------

  async function start() {
    if (!apiKey.trim()) return
    setError(null)
    setIsConnecting(true)
    setHasRecording(false)

    try {
      // Cria o AudioContext dentro do gesto do usuário (exigência dos browsers)
      audioCtxRef.current = new AudioContext()
      nextPlayTime1.current = 0
      nextPlayTime2.current = 0
      pcmBuffer1.current = []
      pcmBuffer1Len.current = 0
      pcmBuffer2.current = []
      pcmBuffer2Len.current = 0
      recordingChunks.current = []
      isRunningRef.current = true

      const ai = new GoogleGenAI({ apiKey })

      function makeConfig(cfg: AgentConfig) {
        return {
          responseModalities: ['audio'] as any,
          systemInstruction: {
            parts: [{ text: buildSystemPrompt(cfg.systemInstruction, cfg.documents, cfg.freeText) }],
          },
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voice } },
          },
          thinkingConfig: {
            thinkingLevel: cfg.thinkingLevel,
          },
        }
      }

      const [s1, s2] = await Promise.all([
        ai.live.connect({
          model: 'gemini-3.1-flash-live-preview',
          config: makeConfig(agent1Config),
          callbacks: {
            onopen: () => console.log('[Agente 1] Conectado'),
            onmessage: (r: any) => handleMessage(r, 1),
            onerror: (e: any) => {
              const msg = e?.message ?? String(e)
              console.error('[Agente 1] Erro:', msg)
              setError(`Agente 1 — ${msg}`)
              stop()
            },
            onclose: () => {
              console.log('[Agente 1] Conexão encerrada')
              setAgent1Speaking(false)
            },
          },
        }),
        ai.live.connect({
          model: 'gemini-3.1-flash-live-preview',
          config: makeConfig(agent2Config),
          callbacks: {
            onopen: () => console.log('[Agente 2] Conectado'),
            onmessage: (r: any) => handleMessage(r, 2),
            onerror: (e: any) => {
              const msg = e?.message ?? String(e)
              console.error('[Agente 2] Erro:', msg)
              setError(`Agente 2 — ${msg}`)
              stop()
            },
            onclose: () => {
              console.log('[Agente 2] Conexão encerrada')
              setAgent2Speaking(false)
            },
          },
        }),
      ])

      session1Ref.current = s1
      session2Ref.current = s2

      setIsConnecting(false)
      setIsRunning(true)

      // Dispara o primeiro turn: pede ao Agente 1 para iniciar a conversa
      s1.sendRealtimeInput({
        text: 'Olá! Por favor, inicie a conversa com o outro agente sobre o tema que achar mais interessante.',
      })
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      console.error('Erro ao conectar:', msg)
      setError(msg)
      setIsConnecting(false)
      isRunningRef.current = false
      audioCtxRef.current?.close()
      audioCtxRef.current = null
    }
  }

  // -------------------------------------------------------------------------
  // Parar conversa
  // -------------------------------------------------------------------------

  function stop() {
    isRunningRef.current = false

    try { session1Ref.current?.close() } catch {}
    try { session2Ref.current?.close() } catch {}
    session1Ref.current = null as never
    session2Ref.current = null as never

    pcmBuffer1.current = []
    pcmBuffer1Len.current = 0
    pcmBuffer2.current = []
    pcmBuffer2Len.current = 0

    audioCtxRef.current?.close()
    audioCtxRef.current = null

    setAgent1Speaking(false)
    setAgent2Speaking(false)
    setIsRunning(false)
    setIsConnecting(false)
    if (recordingChunks.current.length > 0) setHasRecording(true)
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <Header
          apiKey={apiKey}
          onApiKeyChange={handleApiKeyChange}
          isRunning={isRunning}
          isConnecting={isConnecting}
          onToggle={isRunning ? stop : start}
          error={error}
        />

        {/* Botão de download — aparece após parar a conversa */}
        {hasRecording && !isRunning && !isConnecting && (
          <div className="flex justify-center mb-6">
            <button
              onClick={downloadRecording}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 active:scale-95 border border-gray-700 hover:border-gray-500 text-sm font-medium text-gray-200 transition-all duration-150"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              Baixar Conversa (.wav)
            </button>
          </div>
        )}

        {/* Divisor visual */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 h-px bg-gray-800" />
          <span className="text-gray-600 text-xs font-medium uppercase tracking-wider">
            vs
          </span>
          <div className="flex-1 h-px bg-gray-800" />
        </div>

        {/* Painéis dos agentes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-16">
          <AgentPanel
            config={agent1Config}
            onChange={setAgent1Config}
            isSpeaking={agent1Speaking}
            accentColor="blue"
            disabled={isRunning || isConnecting}
          />
          <AgentPanel
            config={agent2Config}
            onChange={setAgent2Config}
            isSpeaking={agent2Speaking}
            accentColor="orange"
            disabled={isRunning || isConnecting}
          />
        </div>
      </div>
    </div>
  )
}
