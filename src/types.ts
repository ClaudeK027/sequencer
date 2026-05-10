export interface Step {
  id: string;
  name: string;
  /** Durée en secondes */
  duration: number;
}

export interface Sequence {
  id: string;
  name: string;
  steps: Step[];
  /** Timestamp epoch ms */
  updatedAt: number;
}

export interface BackupPayload {
  type: 'sequence-timer-backup';
  version: number;
  exportedAt: string;
  soundEnabled: boolean;
  sequences: Array<{
    name: string;
    updatedAt: number;
    steps: Array<{ name: string; duration: number }>;
  }>;
}
