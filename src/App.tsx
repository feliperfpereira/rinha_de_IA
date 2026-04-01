import { useEffect, useRef, useState } from 'react'
import { GoogleGenAI } from '@google/genai'
import { AgentConfig, AppMode, TranscriptEntry, UploadedDocument } from './types'
import { Header } from './components/Header'
import { AgentPanel } from './components/AgentPanel'
import { TranscriptPanel } from './components/TranscriptPanel'
import {
  base64PCMToInt16,
  int16ToBase64,
  resamplePCM,
  combineInt16Arrays,
  scheduleAudioChunk,
  encodeWAV,
} from './utils/audio'
import {
  buildSystemPrompt,
  estimateTokens,
  formatTokenCount,
  readFileAsText,
  MAX_DOCUMENT_TOKENS,
} from './utils/document'

// ---------------------------------------------------------------------------
// Configurações padrão — modo Duelo
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

// ---------------------------------------------------------------------------
// Configurações padrão — modo Podcast
// ---------------------------------------------------------------------------

const DEFAULT_PODCAST_INTERVIEWER: AgentConfig = {
  name: 'Entrevistador',
  voice: 'Puck',
  thinkingLevel: 'minimal',
  systemInstruction:
    'Você é o entrevistador de um podcast educativo. Você e o especialista têm acesso ao mesmo documento. ' +
    'Seu papel é guiar a conversa: comece apresentando brevemente o tema do documento, ' +
    'depois faça UMA pergunta objetiva por vez sobre cada seção ou conceito, em ordem. ' +
    'Espere o especialista terminar completamente sua explicação antes de intervir. ' +
    'Quando o especialista concluir, avance com a próxima pergunta ou peça aprofundamento se necessário. ' +
    'Você é o único que faz perguntas — o especialista apenas responde e explica. ' +
    'Seja breve: 1 a 2 frases por fala. Fale sempre em português brasileiro.',
  documents: [],
  freeText: '',
}

const DEFAULT_PODCAST_SPECIALIST: AgentConfig = {
  name: 'Especialista',
  voice: 'Kore',
  thinkingLevel: 'low',
  systemInstruction:
    'Você é o especialista convidado de um podcast educativo. Você e o entrevistador têm acesso ao mesmo documento. ' +
    'Seu papel é APENAS explicar e aprofundar os tópicos — NUNCA fazer perguntas. ' +
    'Quem faz perguntas é exclusivamente o entrevistador. ' +
    'Ao responder, elabore com detalhes, exemplos práticos e analogias para que o ouvinte aprenda. ' +
    'Desenvolva bem cada ponto antes de concluir — não corte sua explicação. ' +
    'Termine sempre com uma afirmação conclusiva, jamais com uma pergunta ou com algo direcionado ao entrevistador. ' +
    'Responda em 4 a 7 frases. Fale sempre em português brasileiro.',
  documents: [],
  freeText: '',
}

// Tamanho do bloco ao enviar áudio para o próximo agente (em amostras a 16kHz)
const SEND_CHUNK_SAMPLES = 4800 // ~300ms a 16kHz

// Threshold de acumulação antes de enviar progressivamente (em amostras a 16kHz)
const STREAM_THRESHOLD_SAMPLES = 3200 // ~200ms — começa a enviar antes do turn terminar

// Limite da janela de contexto para modelos com áudio nativo
const CONTEXT_WINDOW_LIMIT = 128_000

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

  const [mode, setMode] = useState<AppMode>('duelo')
  const [isRunning, setIsRunning] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [agent1Config, setAgent1Config] = useState<AgentConfig>(DEFAULT_AGENT1)
  const [agent2Config, setAgent2Config] = useState<AgentConfig>(DEFAULT_AGENT2)
  const [agent1Speaking, setAgent1Speaking] = useState(false)
  const [agent2Speaking, setAgent2Speaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasRecording, setHasRecording] = useState(false)

  // Transcrição em tempo real
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])

  // Timer
  const [elapsed, setElapsed] = useState(0)
  const startTimeRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Uso de tokens (janela de contexto)
  const [tokenUsage1, setTokenUsage1] = useState(0)
  const [tokenUsage2, setTokenUsage2] = useState(0)

  // Estado compartilhado do podcast
  const [sharedDocuments, setSharedDocuments] = useState<UploadedDocument[]>([])
  const [sharedFreeText, setSharedFreeText] = useState('')
  const sharedFileInputRef = useRef<HTMLInputElement>(null)

  function handleModeChange(newMode: AppMode) {
    if (isRunning || isConnecting) return
    setMode(newMode)
    if (newMode === 'podcast') {
      setAgent1Config(DEFAULT_PODCAST_INTERVIEWER)
      setAgent2Config(DEFAULT_PODCAST_SPECIALIST)
    } else {
      setAgent1Config(DEFAULT_AGENT1)
      setAgent2Config(DEFAULT_AGENT2)
    }
  }

  async function handleSharedFiles(files: FileList | null) {
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
      setSharedDocuments(prev => [...prev, ...newDocs])
    }
  }

  function removeSharedDoc(index: number) {
    setSharedDocuments(prev => prev.filter((_, i) => i !== index))
  }

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

  // Timer via useEffect
  useEffect(() => {
    if (isRunning) {
      startTimeRef.current = Date.now()
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setElapsed(0)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isRunning])

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
    // Captura uso de tokens (vem no nível raiz da resposta, periodicamente)
    if (response.usageMetadata) {
      const meta = response.usageMetadata
      // totalTokenCount é o acumulado da sessão; usa o maior valor disponível
      const total = meta.totalTokenCount
        ?? ((meta.promptTokenCount ?? 0) + (meta.responseTokenCount ?? 0))
      if (total > 0) {
        const setUsage = agentIndex === 1 ? setTokenUsage1 : setTokenUsage2
        setUsage(prev => Math.max(prev, total))
      }
      console.debug(`[Agente ${agentIndex}] Tokens:`, JSON.stringify(meta))
    }

    const content = response.serverContent
    if (!content) return

    const pcmBuf = agentIndex === 1 ? pcmBuffer1 : pcmBuffer2
    const pcmLen = agentIndex === 1 ? pcmBuffer1Len : pcmBuffer2Len
    const setSpeaking = agentIndex === 1 ? setAgent1Speaking : setAgent2Speaking
    const targetSession = agentIndex === 1 ? session2Ref.current : session1Ref.current

    // Captura transcrição do output de áudio — agrupa fragmentos do mesmo agente
    if (content.outputTranscription?.text) {
      const text = content.outputTranscription.text
      const ts = startTimeRef.current ? Date.now() - startTimeRef.current : 0
      setTranscript(prev => {
        const last = prev[prev.length - 1]
        // Agrupa com a última entrada se for do mesmo agente e recente (< 8s)
        if (last && last.agent === agentIndex && (ts - last.timestamp) < 8000) {
          const updated = [...prev]
          updated[updated.length - 1] = { ...last, text: last.text + text }
          return updated
        }
        return [...prev, { agent: agentIndex, text, timestamp: ts }]
      })
    }

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
  // Downloads
  // -------------------------------------------------------------------------

  function downloadRecording() {
    const chunks = recordingChunks.current
    if (chunks.length === 0) return
    const combined = combineInt16Arrays(chunks)
    const blob = encodeWAV(combined, 24000)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${mode}-de-ias-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.wav`
    a.click()
    URL.revokeObjectURL(url)
  }

  function downloadTranscript() {
    if (transcript.length === 0) return
    const lines = transcript.map(e => {
      const totalSec = Math.floor(e.timestamp / 1000)
      const min = String(Math.floor(totalSec / 60)).padStart(2, '0')
      const sec = String(totalSec % 60).padStart(2, '0')
      const name = e.agent === 1 ? agent1Config.name : agent2Config.name
      return `[${min}:${sec}] ${name}: ${e.text}`
    }).join('\n\n')
    const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${mode}-de-ias-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`
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
      setTranscript([])
      setTokenUsage1(0)
      setTokenUsage2(0)
      isRunningRef.current = true

      const ai = new GoogleGenAI({ apiKey })

      function makeConfig(cfg: AgentConfig) {
        // No modo podcast, os dois agentes compartilham os mesmos documentos
        const docs = mode === 'podcast' ? sharedDocuments : cfg.documents
        const freeText = mode === 'podcast' ? sharedFreeText : cfg.freeText
        return {
          responseModalities: ['audio'] as any,
          systemInstruction: {
            parts: [{ text: buildSystemPrompt(cfg.systemInstruction, docs, freeText) }],
          },
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voice } },
          },
          thinkingConfig: {
            thinkingLevel: cfg.thinkingLevel as any,
          },
          outputAudioTranscription: {},
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

      // Dispara o primeiro turn com prompt adequado ao modo
      const initialPrompt =
        mode === 'podcast'
          ? 'Olá! Você é o entrevistador. Inicie o podcast apresentando brevemente o tema do documento e faça a primeira pergunta ao especialista sobre o primeiro ponto ou seção do conteúdo.'
          : 'Olá! Por favor, inicie a conversa com o outro agente sobre o tema que achar mais interessante.'

      s1.sendRealtimeInput({ text: initialPrompt })
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
  // Cálculos derivados
  // -------------------------------------------------------------------------

  const sharedFreeTextTokens = estimateTokens(sharedFreeText)
  const sharedTotalTokens =
    sharedDocuments.reduce((sum, d) => sum + d.estimatedTokens, 0) + sharedFreeTextTokens
  const sharedBudgetPct = Math.min(100, (sharedTotalTokens / MAX_DOCUMENT_TOKENS) * 100)
  const sharedBudgetColor =
    sharedBudgetPct > 85 ? 'bg-red-500' : sharedBudgetPct > 60 ? 'bg-yellow-500' : 'bg-green-500'

  // Maior uso de tokens entre as duas sessões (para o indicador)
  const maxTokenUsage = Math.max(tokenUsage1, tokenUsage2)
  const contextPct = Math.min(100, (maxTokenUsage / CONTEXT_WINDOW_LIMIT) * 100)

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
          mode={mode}
          onModeChange={handleModeChange}
          elapsed={elapsed}
          contextPct={contextPct}
          tokenUsage={maxTokenUsage}
          contextLimit={CONTEXT_WINDOW_LIMIT}
        />

        {/* Botões de download — aparecem após parar a conversa */}
        {hasRecording && !isRunning && !isConnecting && (
          <div className="flex justify-center gap-3 mb-6 flex-wrap">
            <button
              onClick={downloadRecording}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 active:scale-95 border border-gray-700 hover:border-gray-500 text-sm font-medium text-gray-200 transition-all duration-150"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              {mode === 'podcast' ? 'Baixar Podcast (.wav)' : 'Baixar Conversa (.wav)'}
            </button>
            {transcript.length > 0 && (
              <button
                onClick={downloadTranscript}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 active:scale-95 border border-gray-700 hover:border-gray-500 text-sm font-medium text-gray-200 transition-all duration-150"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                </svg>
                Baixar Transcrição (.txt)
              </button>
            )}
          </div>
        )}

        {/* Seção de documento compartilhado — só no modo Podcast */}
        {mode === 'podcast' && (
          <div className="mb-6 rounded-2xl border border-purple-500/30 bg-purple-500/5 p-6 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-purple-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
              </svg>
              <span className="text-purple-300 text-xs font-semibold uppercase tracking-wider">
                Documento do Podcast
              </span>
            </div>
            <p className="text-gray-400 text-xs leading-relaxed -mt-1">
              Faça upload do documento a ser analisado. O entrevistador e o especialista terão acesso ao mesmo conteúdo e percorrerão cada ponto juntos.
            </p>

            {/* Chips dos documentos compartilhados */}
            {sharedDocuments.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {sharedDocuments.map((doc, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-gray-300 text-xs truncate flex-1 min-w-0">{doc.fileName}</span>
                    <span className="text-gray-500 text-xs flex-shrink-0">{formatTokenCount(doc.estimatedTokens)}</span>
                    {!isRunning && !isConnecting && (
                      <button
                        onClick={() => removeSharedDoc(i)}
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
                      className={`h-full rounded-full transition-all duration-300 ${sharedBudgetColor}`}
                      style={{ width: `${sharedBudgetPct}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 flex-shrink-0">
                    {formatTokenCount(sharedTotalTokens)} / ~80k por agente
                  </span>
                </div>
              </div>
            )}

            {/* Texto livre */}
            <textarea
              value={sharedFreeText}
              onChange={(e) => setSharedFreeText(e.target.value)}
              disabled={isRunning || isConnecting}
              rows={3}
              placeholder="Cole aqui qualquer texto de referência (trechos, anotações, resumos...)"
              className="bg-gray-800/80 text-gray-200 rounded-lg px-3 py-2.5 border border-gray-700 hover:border-gray-600 outline-none resize-none text-sm disabled:opacity-50 placeholder:text-gray-600 leading-relaxed"
            />

            {/* Botão de upload */}
            {!isRunning && !isConnecting && (
              <>
                <button
                  onClick={() => sharedFileInputRef.current?.click()}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg border border-dashed border-purple-500/40 hover:border-purple-400/60 text-gray-500 hover:text-gray-400 text-xs transition-colors duration-150"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                  Adicionar arquivo (.txt, .md, .csv)
                </button>
                <input
                  ref={sharedFileInputRef}
                  type="file"
                  accept=".txt,.md,.csv"
                  multiple
                  className="hidden"
                  onChange={(e) => handleSharedFiles(e.target.files)}
                />
              </>
            )}
          </div>
        )}

        {/* Divisor visual */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 h-px bg-gray-800" />
          <span className="text-gray-600 text-xs font-medium uppercase tracking-wider">
            {mode === 'podcast' ? 'ao vivo' : 'vs'}
          </span>
          <div className="flex-1 h-px bg-gray-800" />
        </div>

        {/* Painéis dos agentes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <AgentPanel
            config={agent1Config}
            onChange={setAgent1Config}
            isSpeaking={agent1Speaking}
            accentColor="blue"
            disabled={isRunning || isConnecting}
            hideDocuments={mode === 'podcast'}
          />
          <AgentPanel
            config={agent2Config}
            onChange={setAgent2Config}
            isSpeaking={agent2Speaking}
            accentColor="orange"
            disabled={isRunning || isConnecting}
            hideDocuments={mode === 'podcast'}
          />
        </div>

        {/* Transcrição em tempo real */}
        {(isRunning || transcript.length > 0) && (
          <div className="mt-6 pb-16">
            <TranscriptPanel
              entries={transcript}
              agent1Name={agent1Config.name}
              agent2Name={agent2Config.name}
            />
          </div>
        )}

        {/* Espaçamento inferior quando não há transcrição */}
        {!isRunning && transcript.length === 0 && <div className="pb-16" />}
      </div>
    </div>
  )
}
