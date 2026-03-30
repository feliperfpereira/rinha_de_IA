/**
 * Decodifica uma string base64 de PCM bruto para Int16Array.
 * Formato de saída do Gemini: PCM little-endian, 16-bit, mono, 24kHz.
 */
export function base64PCMToInt16(base64: string): Int16Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Int16Array(bytes.buffer)
}

/**
 * Converte Int16Array para string base64.
 */
export function int16ToBase64(data: Int16Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  let binary = ''
  // Processar em blocos para evitar estouro de stack em strings longas
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    binary += String.fromCharCode(...Array.from(chunk))
  }
  return btoa(binary)
}

/**
 * Reamostrador PCM usando interpolação linear.
 * Usado para converter a saída 24kHz do Gemini para 16kHz de entrada.
 */
export function resamplePCM(
  input: Int16Array,
  inputRate: number,
  outputRate: number
): Int16Array {
  if (inputRate === outputRate) return input

  const ratio = inputRate / outputRate
  const outputLength = Math.round(input.length / ratio)
  const output = new Int16Array(outputLength)

  for (let i = 0; i < outputLength; i++) {
    const srcPos = i * ratio
    const srcIdx = Math.floor(srcPos)
    const frac = srcPos - srcIdx
    const s1 = srcIdx < input.length ? input[srcIdx] : 0
    const s2 = srcIdx + 1 < input.length ? input[srcIdx + 1] : s1
    output[i] = Math.round(s1 * (1 - frac) + s2 * frac)
  }

  return output
}

/**
 * Concatena múltiplos Int16Arrays em um único array.
 */
export function combineInt16Arrays(arrays: Int16Array[]): Int16Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const combined = new Int16Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    combined.set(arr, offset)
    offset += arr.length
  }
  return combined
}

/**
 * Agenda a reprodução de um chunk de áudio PCM via Web Audio API.
 * Garante reprodução contínua sem lacunas entre chunks.
 */
export function scheduleAudioChunk(
  ctx: AudioContext,
  int16Data: Int16Array,
  sampleRate: number,
  nextPlayTimeRef: { current: number }
): void {
  const float32 = new Float32Array(int16Data.length)
  for (let i = 0; i < int16Data.length; i++) {
    float32[i] = int16Data[i] / 32768.0
  }

  const buffer = ctx.createBuffer(1, float32.length, sampleRate)
  buffer.getChannelData(0).set(float32)

  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)

  // Agenda o chunk para tocar logo após o anterior terminar
  const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current)
  source.start(startTime)
  nextPlayTimeRef.current = startTime + buffer.duration
}
