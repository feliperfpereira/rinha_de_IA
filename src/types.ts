export type VoiceName = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export interface AgentConfig {
  name: string;
  voice: VoiceName;
  systemInstruction: string;
}
