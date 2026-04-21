import type { Pep440Version } from './shared';

export const VERSION_PATTERN: string;
export function clean(version: string | null | undefined): string | null;
export function explain(
  version: string | null | undefined,
): Pep440Version | null;
export function parse(
  version: string | null | undefined,
  regex?: RegExp,
): Pep440Version | null;
export function stringify(
  version: Pep440Version | null | undefined,
): string | null;
export function valid(version: string | null | undefined): string | null;
