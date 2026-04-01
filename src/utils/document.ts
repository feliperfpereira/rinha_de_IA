import { UploadedDocument } from '../types'

export const MAX_DOCUMENT_TOKENS = 80_000

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

export function formatTokenCount(tokens: number): string {
  return tokens >= 1000 ? `~${Math.round(tokens / 1000)}k tokens` : `~${tokens} tokens`
}

export function truncateToTokenBudget(
  text: string,
  maxTokens: number
): { text: string; truncated: boolean } {
  const maxChars = Math.floor(maxTokens * 3.5)
  if (text.length <= maxChars) return { text, truncated: false }

  // Tenta cortar na fronteira de frase mais próxima antes do limite
  const cutoff = text.lastIndexOf('.', maxChars)
  const pos = cutoff > maxChars * 0.8 ? cutoff + 1 : maxChars
  return { text: text.slice(0, pos).trimEnd(), truncated: true }
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      // Se tiver muitos caracteres de substituição, tenta windows-1252
      const badChars = (text.match(/\uFFFD/g) ?? []).length
      if (badChars / text.length > 0.01) {
        const reader2 = new FileReader()
        reader2.onload = () => resolve(reader2.result as string)
        reader2.onerror = () => resolve(text) // fallback para UTF-8 mesmo
        reader2.readAsText(file, 'windows-1252')
      } else {
        resolve(text)
      }
    }
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo'))
    reader.readAsText(file, 'utf-8')
  })
}

export function buildSystemPrompt(
  persona: string,
  docs: UploadedDocument[],
  freeText: string = '',
  maxDocTokens: number = MAX_DOCUMENT_TOKENS
): string {
  const hasDocs = docs.length > 0
  const hasFreeText = freeText.trim().length > 0
  if (!hasDocs && !hasFreeText) return persona

  const sections: string[] = []

  if (hasDocs) {
    const tokensPerDoc = Math.floor(maxDocTokens / (docs.length + (hasFreeText ? 1 : 0)))
    const docsSection = docs.map(d => {
      const { text, truncated } = truncateToTokenBudget(d.content, tokensPerDoc)
      return `--- DOCUMENTO DE REFERÊNCIA: ${d.fileName} ---\n${text}${truncated ? '\n[... documento truncado para caber no limite de contexto ...]' : ''}\n--- FIM DO DOCUMENTO ---`
    }).join('\n\n')
    sections.push(docsSection)
  }

  if (hasFreeText) {
    const tokensPerDoc = Math.floor(maxDocTokens / (docs.length + 1))
    const { text, truncated } = truncateToTokenBudget(freeText.trim(), tokensPerDoc)
    sections.push(`--- TEXTO LIVRE DE REFERÊNCIA ---\n${text}${truncated ? '\n[... truncado para caber no limite de contexto ...]' : ''}\n--- FIM DO TEXTO ---`)
  }

  return `${persona}

INSTRUÇÃO CRÍTICA — BASE DE CONHECIMENTO:
Você possui os seguintes documentos de referência. Suas respostas DEVEM ser fundamentadas neles.
Regras obrigatórias:
- Baseie seus argumentos, exemplos e afirmações no conteúdo desses documentos.
- Quando fizer uma afirmação relevante, indique de onde vem (ex: "segundo o texto...", "como descrito no documento...").
- Se o outro agente afirmar algo que contradiz os documentos, corrija com base neles.
- Não invente informações além do que está nos documentos e no seu conhecimento sobre o tema.
- Cite trechos ou ideias dos documentos ativamente ao longo da conversa, não apenas quando perguntado.

${sections.join('\n\n')}`
}
