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
} from './utils/audio'

// ---------------------------------------------------------------------------
// Configurações padrão dos agentes
// ---------------------------------------------------------------------------

const DEFAULT_AGENT1: AgentConfig = {
  name: 'Agente Filósofo',
  voice: 'Puck',
  systemInstruction:
    'Você é um filósofo apaixonado e curioso. Está em uma conversa de áudio com outro agente de IA. ' +
    'Responda de forma concisa (2 a 3 frases no máximo), faça perguntas instigantes e mantenha a conversa ' +
    'fluindo com ideias profundas e provocativas. Fale sempre em português brasileiro.',
}

const DEFAULT_AGENT2: AgentConfig = {
  name: 'Agente Coach',
  voice: 'Zephyr',
  systemInstruction:
    'Você é um coach motivacional entusiasmado e prático. Está em uma conversa de áudio com outro agente de IA. ' +
    'Responda de forma concisa (2 a 3 frases no máximo), seja otimista e inspirador, conecte as ideias do outro ' +
    'agente com ações práticas do dia a dia. Fale sempre em português brasileiro.',
}

// Tamanho do bloco ao enviar áudio para o próximo agente (em amostras a 16kHz)
const SEND_CHUNK_SAMPLES = 16000 // ~1 segundo

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export default function App() {
  const [apiKey, setApiKey] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [agent1Config, setAgent1Config] = useState<AgentConfig>(DEFAULT_AGENT1)
  const [agent2Config, setAgent2Config] = useState<AgentConfig>(DEFAULT_AGENT2)
  const [agent1Speaking, setAgent1Speaking] = useState(false)
  const [agent2Speaking, setAgent2Speaking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Refs de sessão — acessadas de dentro de callbacks sem problema de stale closure
  const session1Ref = useRef<ReturnType<GoogleGenAI['live']['connect']> extends Promise<infer T> ? T : never>(null as never)
  const session2Ref = useRef<ReturnType<GoogleGenAI['live']['connect']> extends Promise<infer T> ? T : never>(null as never)

  // Contexto de áudio e agendamento de playback
  const audioCtxRef = useRef<AudioContext | null>(null)
  const nextPlayTime1 = useRef(0)
  const nextPlayTime2 = useRef(0)

  // Buffers que acumulam os chunks de cada agente durante o turn
  const audioBuffer1 = useRef<string[]>([])
  const audioBuffer2 = useRef<string[]>([])

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
    } catch (e) {
      console.error('Erro ao reproduzir áudio do agente', agentIndex, e)
    }
  }

  // -------------------------------------------------------------------------
  // Orquestração: ao fim de um turn, envia o áudio acumulado para o outro agente
  // -------------------------------------------------------------------------

  function pipeTurnAudio(fromAgent: 1 | 2) {
    if (!isRunningRef.current) return

    const bufferRef = fromAgent === 1 ? audioBuffer1 : audioBuffer2
    const chunks = bufferRef.current.splice(0) // esvazia e obtém os chunks

    if (chunks.length === 0) {
      console.warn(`Agente ${fromAgent} completou o turn sem produzir áudio.`)
      return
    }

    const targetSession = fromAgent === 1 ? session2Ref.current : session1Ref.current
    if (!targetSession) return

    // Junta todos os chunks, reamostrar 24kHz → 16kHz e envia para o outro agente
    const combined = combineInt16Arrays(chunks.map(b64 => base64PCMToInt16(b64)))
    const resampled = resamplePCM(combined, 24000, 16000)

    for (let i = 0; i < resampled.length; i += SEND_CHUNK_SAMPLES) {
      const slice = resampled.slice(i, Math.min(i + SEND_CHUNK_SAMPLES, resampled.length))
      targetSession.sendRealtimeInput({
        audio: { data: int16ToBase64(slice), mimeType: 'audio/pcm;rate=16000' },
      })
    }

    // Sinaliza fim do áudio para o VAD do outro agente
    targetSession.sendRealtimeInput({ audioStreamEnd: true })
  }

  // -------------------------------------------------------------------------
  // Handler de mensagens recebidas de cada sessão
  // -------------------------------------------------------------------------

  function handleMessage(response: any, agentIndex: 1 | 2) {
    const content = response.serverContent
    if (!content) return

    const bufferRef = agentIndex === 1 ? audioBuffer1 : audioBuffer2
    const setSpeaking = agentIndex === 1 ? setAgent1Speaking : setAgent2Speaking

    // Processa todos os parts do turn (pode conter áudio e outros dados ao mesmo tempo)
    if (content.modelTurn?.parts) {
      for (const part of content.modelTurn.parts) {
        if (part.inlineData?.data) {
          setSpeaking(true)
          bufferRef.current.push(part.inlineData.data)
          playAudioChunk(part.inlineData.data, agentIndex)
        }
      }
    }

    // Turn completo: agenda o envio para o próximo agente
    if (content.turnComplete) {
      setSpeaking(false)
      if (isRunningRef.current) {
        // Pequeno delay para garantir que o playback já foi agendado antes de enviar
        setTimeout(() => pipeTurnAudio(agentIndex), 50)
      }
    }

    // Interrupção: descarta o buffer deste agente
    if (content.interrupted) {
      setSpeaking(false)
      bufferRef.current = []
    }
  }

  // -------------------------------------------------------------------------
  // Iniciar conversa
  // -------------------------------------------------------------------------

  async function start() {
    if (!apiKey.trim()) return
    setError(null)
    setIsConnecting(true)

    try {
      // Cria o AudioContext dentro do gesto do usuário (exigência dos browsers)
      audioCtxRef.current = new AudioContext()
      nextPlayTime1.current = 0
      nextPlayTime2.current = 0
      audioBuffer1.current = []
      audioBuffer2.current = []
      isRunningRef.current = true

      const ai = new GoogleGenAI({ apiKey })

      function makeConfig(cfg: AgentConfig) {
        return {
          responseModalities: ['audio'] as any,
          systemInstruction: { parts: [{ text: cfg.systemInstruction }] },
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voice } },
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

    audioBuffer1.current = []
    audioBuffer2.current = []

    audioCtxRef.current?.close()
    audioCtxRef.current = null

    setAgent1Speaking(false)
    setAgent2Speaking(false)
    setIsRunning(false)
    setIsConnecting(false)
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <Header
          apiKey={apiKey}
          onApiKeyChange={setApiKey}
          isRunning={isRunning}
          isConnecting={isConnecting}
          onToggle={isRunning ? stop : start}
          error={error}
        />

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
