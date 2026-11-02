import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { CharacterProfile, CharacterType } from '../../shared/character';
import { loadProfile, saveProfile } from '../onboarding/profileStore';
import { THEMES } from './themes';

interface CharacterContext { profile: CharacterProfile | null; choose(character: CharacterType): void }
const Context = createContext<CharacterContext | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<CharacterProfile | null>(loadProfile);

  useEffect(() => {
    const root = document.documentElement;
    if (!profile) {
      delete root.dataset.character;
      root.style.removeProperty('--wallpaper');
      root.style.removeProperty('--mascot');
      return;
    }
    root.dataset.character = profile.character;
    root.style.setProperty('--wallpaper', `url("${THEMES[profile.character].background}")`);
    root.style.setProperty('--mascot', `url("${THEMES[profile.character].mascot}")`);
  }, [profile]);

  const choose = useCallback((character: CharacterType) => {
    const next = { character, createdAtUtc: new Date().toISOString() };
    saveProfile(next);
    setProfile(next);
  }, []);

  return <Context.Provider value={{ profile, choose }}>{children}</Context.Provider>;
}

export function useCharacter(): CharacterContext {
  const value = useContext(Context);
  if (!value) throw new Error('useCharacter ThemeProvider içinde kullanılmalı.');
  return value;
}