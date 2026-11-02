export const CHARACTER_TYPES = ['creational', 'cyber', 'developer'] as const;
export type CharacterType = (typeof CHARACTER_TYPES)[number];

export interface CharacterProfile {
  character: CharacterType;
  createdAtUtc: string;
}