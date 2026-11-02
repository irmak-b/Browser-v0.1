import { CHARACTER_TYPES, type CharacterProfile } from '../../shared/character';

const KEY = 'browser.characterProfile';

export function loadProfile(): CharacterProfile | null {
    
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CharacterProfile>;
    return CHARACTER_TYPES.includes(value.character as never) && typeof value.createdAtUtc === 'string'
      ? (value as CharacterProfile) : null;
  } catch { return null; }
}

export function saveProfile(profile: CharacterProfile): void {
  try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* backend gelene kadar sessiz */ }
}