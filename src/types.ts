export type VoiceName = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

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
