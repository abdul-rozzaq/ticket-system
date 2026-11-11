// Runtime feature health, shown in Diagnostika. Only set from things the code actually observed.
import type { FeatureStatus } from '../shared/types';
import type { HealthEntry } from '../ui/bridge';

const health: Record<string, HealthEntry> = {};

export function setHealth(id: string, status: FeatureStatus, note = '') {
  const prev = health[id];
  if (prev && prev.status === status && prev.note === note) return;
  health[id] = { status, note };
}

export const getHealth = () => ({ ...health });
