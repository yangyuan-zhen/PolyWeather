"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Snapshot = void 0;
const api_client_1 = require("./api-client");
const get_credentials_1 = require("./utils/get-credentials");
/**
 * A Snapshot is a saved state of a Sandbox that can be used to create new Sandboxes
 *
 * Use {@link Sandbox.snapshot} or {@link Snapshot.get} to construct.
 * @hideconstructor
 */
class Snapshot {
    /**
     * Unique ID of this snapshot.
     */
    get snapshotId() {
        return this.snapshot.id;
    }
    /**
     * The ID the sandbox from which this snapshot was created.
     */
    get sourceSandboxId() {
        return this.snapshot.sourceSandboxId;
    }
    /**
     * The status of the snapshot.
     */
    get status() {
        return this.snapshot.status;
    }
    /**
     * The size of the snapshot in bytes, or null if not available.
     */
    get sizeBytes() {
        return this.snapshot.sizeBytes;
    }
    /**
     * The creation date of this snapshot.
     */
    get createdAt() {
        return new Date(this.snapshot.createdAt);
    }
    /**
     * The expiration date of this snapshot, or undefined if it does not expire.
     */
    get expiresAt() {
        if (this.snapshot.expiresAt === undefined) {
            return undefined;
        }
        return new Date(this.snapshot.expiresAt);
    }
    /**
     * Create a new Snapshot instance.
     *
     * @param client - API client used to communicate with the backend
     * @param snapshot - Snapshot metadata
     */
    constructor({ client, snapshot, }) {
        this.client = client;
        this.snapshot = snapshot;
    }
    /**
     * Allow to get a list of snapshots for a team narrowed to the given params.
     * It returns both the snapshots and the pagination metadata to allow getting
     * the next page of results.
     */
    static async list(params) {
        const credentials = await (0, get_credentials_1.getCredentials)(params);
        const client = new api_client_1.APIClient({
            teamId: credentials.teamId,
            token: credentials.token,
            fetch: params?.fetch,
        });
        return client.listSnapshots({
            ...credentials,
            ...params,
        });
    }
    /**
     * Retrieve an existing snapshot.
     *
     * @param params - Get parameters and optional credentials.
     * @returns A promise resolving to the {@link Sandbox}.
     */
    static async get(params) {
        const credentials = await (0, get_credentials_1.getCredentials)(params);
        const client = new api_client_1.APIClient({
            teamId: credentials.teamId,
            token: credentials.token,
        });
        const sandbox = await client.getSnapshot({
            snapshotId: params.snapshotId,
            signal: params.signal,
        });
        return new Snapshot({
            client,
            snapshot: sandbox.json.snapshot,
        });
    }
    /**
     * Delete this snapshot.
     *
     * @param opts - Optional parameters.
     * @param opts.signal - An AbortSignal to cancel the operation.
     * @returns A promise that resolves once the snapshot has been deleted.
     */
    async delete(opts) {
        const response = await this.client.deleteSnapshot({
            snapshotId: this.snapshot.id,
            signal: opts?.signal,
        });
        this.snapshot = response.json.snapshot;
    }
}
exports.Snapshot = Snapshot;
//# sourceMappingURL=snapshot.js.map