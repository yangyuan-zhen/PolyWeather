/**
 * Reads the linked project configuration from `.vercel/project.json`.
 *
 * @param cwd - The directory to search for `.vercel/project.json`.
 * @returns The linked project's `projectId` and `teamId`, or `null` if not found.
 */
export declare function readLinkedProject(cwd: string): Promise<{
    projectId: string;
    teamId: string;
} | null>;
