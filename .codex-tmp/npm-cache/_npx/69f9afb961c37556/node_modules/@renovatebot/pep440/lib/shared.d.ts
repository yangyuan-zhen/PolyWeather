export interface Pep440Constraint {
  operator: string;
  prefix: string;
  version: string;
}
export interface Pep440SpecifierOptions {
  prereleases?: boolean;
}

export interface Pep440Version {
  public: string;
  base_version: string;
  is_prerelease: boolean;
  is_devrelease: boolean;
  is_postrelease: boolean;
  epoch: number;
  release: number[];
  pre: (string | number)[];
  post: (string | number)[];
  dev: (string | number)[];
  local: string | null;
}
