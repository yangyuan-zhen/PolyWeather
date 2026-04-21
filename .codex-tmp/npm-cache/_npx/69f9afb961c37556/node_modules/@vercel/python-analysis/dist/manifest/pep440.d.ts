import type { Pep440Version, Pep440Constraint } from '@renovatebot/pep440';
export type { Pep440Version, Pep440Constraint } from '@renovatebot/pep440';
export { parse as parsePep440Version } from '@renovatebot/pep440';
export { parse as parsePep440Constraint, satisfies as pep440Satisfies, } from '@renovatebot/pep440/lib/specifier';
export declare function pep440ConstraintFromVersion(v: Pep440Version): Pep440Constraint[];
export declare function unparsePep440Version(v: Pep440Version): string;
