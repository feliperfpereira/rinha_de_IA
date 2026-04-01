export type VoiceName = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export type AppMode = 'duelo' | 'podcast';

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface UploadedDocument {
  fileName: string;
  content: string;
  charCount: number;
  estimatedTokens: number;
}

export interface AgentConfig {
  name: string;
  voice: VoiceName;
  thinkingLevel: ThinkingLevel;
  systemInstruction: string;
  documents: UploadedDocument[];
  freeText: string;
}

export interface TranscriptEntry {
  agent: 1 | 2;
  text: string;
  timestamp: number;
}
