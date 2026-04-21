/**
 * Resolves the team and project scope for sandbox operations.
 *
 * First checks for a locally linked project in `.vercel/project.json`.
 * If found, uses the `projectId` and `orgId` from there.
 *
 * Otherwise, if `teamId` is not provided, selects the first available team for the account.
 * Ensures a default project exists within the team, creating it if necessary.
 *
 * @param opts.token - Vercel API authentication token.
 * @param opts.teamId - Optional team slug. If omitted, the first team is selected.
 * @param opts.cwd - Optional directory to search for `.vercel/project.json`. Defaults to `process.cwd()`.
 * @returns The resolved scope with `projectId`, `teamId`, and whether the project was `created`.
 *
 * @throws {NotOk} If the API returns an error other than 404 when checking the project.
 * @throws {ZodError} If no teams exist for the account.
 *
 * @example
 * ```ts
 * const scope = await inferScope({ token: "vercel_..." });
 * // => { projectId: "vercel-sandbox-default-project", teamId: "my-team", created: false }
 * ```
 */
export declare function inferScope(opts: {
    token: string;
    teamId?: string;
    cwd?: string;
}): Promise<{
    projectId: string;
    teamId: string;
    created: boolean;
}>;
/**
 * Selects a team for the current token by querying the Teams API and
 * returning the slug of the first team in the result set.
 *
 * @param token - Authentication token used to call the Vercel API.
 * @returns A promise that resolves to the first team's slug.
 */
export declare function selectTeam(token: string): Promise<string>;
