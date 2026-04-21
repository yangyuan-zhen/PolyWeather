import type { Pep440Constraint, Pep440SpecifierOptions } from './shared';

export const RANGE_PATTERN: string;

export function filter(
  versions: string[],
  specifier: string,
  options?: Pep440SpecifierOptions,
): string[];
export function maxSatisfying(
  versions: string[],
  specifier: string,
  options?: Pep440SpecifierOptions,
): string | null;
export function minSatisfying(
  versions: string[],
  specifier: string,
  options?: Pep440SpecifierOptions,
): string | null;
export function parse(ranges: string): Pep440Constraint[]; // have doubts regarding this which need to be discussed
export function satisfies(
  version: string,
  specifier: string,
  options?: Pep440SpecifierOptions,
): boolean;
export function validRange(specifier: string): boolean;
