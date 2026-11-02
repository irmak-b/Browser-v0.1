import creationalBg from './assets/creational_bg.png?no-inline';
import creationalW from './assets/creational_w.png?no-inline';
import cyberBg from './assets/cyber_bg.png?no-inline';
import cyberW from './assets/cyber_w.png?no-inline';
import developerBg from './assets/developer_bg.png?no-inline';
import developerW from './assets/developer_w.png?no-inline';
import type { CharacterType } from '../../shared/character';

export interface ThemeAssets { label: string; background: string; mascot: string }

export const THEMES: Record<CharacterType, ThemeAssets> = {
  creational: { label: 'Creational', background: creationalBg, mascot: creationalW },
  cyber: { label: 'Security', background: cyberBg, mascot: cyberW },
  developer: { label: 'Developer', background: developerBg, mascot: developerW },
};