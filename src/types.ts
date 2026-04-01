export type VoiceName = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export interface UploadedDocument {
  fileName: string;
  content: string;
  charCount: number;
  estimatedTokens: number;
}

export interface AgentConfig {
  name: string;
  voice: VoiceName;
  systemInstruction: string;
  documents: UploadedDocument[];
  freeText: string;
}
