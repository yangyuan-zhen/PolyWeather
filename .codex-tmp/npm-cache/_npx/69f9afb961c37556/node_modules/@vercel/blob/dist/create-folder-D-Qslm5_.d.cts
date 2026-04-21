import { Readable } from 'stream';
import { File } from 'undici';

interface BlobCommandOptions {
    /**
     * Define your blob API token.
     * @defaultvalue process.env.BLOB_READ_WRITE_TOKEN
     */
    token?: string;
    /**
     * `AbortSignal` to cancel the running request. See https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
     */
    abortSignal?: AbortSignal;
}
/**
 * The access level of a blob.
 * - 'public': The blob is publicly accessible via its URL.
 * - 'private': The blob requires authentication to access.
 */
type BlobAccessType = 'public' | 'private';
interface CommonCreateBlobOptions extends BlobCommandOptions {
    /**
     * Whether the blob should be publicly accessible.
     * - 'public': The blob will be publicly accessible via its URL.
     * - 'private': The blob will require authentication to access.
     */
    access: BlobAccessType;
    /**
     * Adds a random suffix to the filename.
     * @defaultvalue false
     */
    addRandomSuffix?: boolean;
    /**
     * Allow overwriting an existing blob. By default this is set to false and will throw an error if the blob already exists.
     * @defaultvalue false
     */
    allowOverwrite?: boolean;
    /**
     * Defines the content type of the blob. By default, this value is inferred from the pathname. Sent as the 'content-type' header when downloading a blob.
     */
    contentType?: string;
    /**
     * Number in seconds to configure the edge and browser cache. The minimum is 1 minute. There's no maximum but keep in mind that browser and edge caches will do a best effort to respect this value.
     * Detailed documentation can be found here: https://vercel.com/docs/storage/vercel-blob#caching
     * @defaultvalue 30 * 24 * 60 * 60 (1 Month)
     */
    cacheControlMaxAge?: number;
    /**
     * Only perform the operation if the blob's current ETag matches this value.
     * Use this for optimistic concurrency control to prevent overwriting changes made by others.
     * If the ETag doesn't match, a `BlobPreconditionFailedError` will be thrown.
     */
    ifMatch?: string;
}
/**
 * Event object passed to the onUploadProgress callback.
 */
interface UploadProgressEvent {
    /**
     * The number of bytes uploaded.
     */
    loaded: number;
    /**
     * The total number of bytes to upload.
     */
    total: number;
    /**
     * The percentage of the upload that has been completed.
     */
    percentage: number;
}
/**
 * Callback type for tracking upload progress.
 */
type OnUploadProgressCallback = (progressEvent: UploadProgressEvent) => void;
/**
 * Interface for including upload progress tracking capabilities.
 */
interface WithUploadProgress {
    /**
     * Callback to track the upload progress. You will receive an object with the following properties:
     * - `loaded`: The number of bytes uploaded
     * - `total`: The total number of bytes to upload
     * - `percentage`: The percentage of the upload that has been completed
     */
    onUploadProgress?: OnUploadProgressCallback;
}
declare class BlobError extends Error {
    constructor(message: string);
}
/**
 * Generates a download URL for a blob.
 * The download URL includes a ?download=1 parameter which causes browsers to download
 * the file instead of displaying it inline.
 *
 * @param blobUrl - The URL of the blob to generate a download URL for
 * @returns A string containing the download URL with the download parameter appended
 */
declare function getDownloadUrl(blobUrl: string): string;

/**
 * Result of a successful put or copy operation.
 */
interface PutBlobResult {
    /**
     * The URL of the blob.
     */
    url: string;
    /**
     * A URL that will cause browsers to download the file instead of displaying it inline.
     */
    downloadUrl: string;
    /**
     * The pathname of the blob within the store.
     */
    pathname: string;
    /**
     * The content-type of the blob.
     */
    contentType: string;
    /**
     * The content disposition header value.
     */
    contentDisposition: string;
    /**
     * The ETag of the blob. Can be used with `ifMatch` for conditional writes.
     */
    etag: string;
}
/**
 * Represents the body content for a put operation.
 * Can be one of several supported types.
 */
type PutBody = string | Readable | Buffer | Blob | ArrayBuffer | ReadableStream | File;

/**
 * Input format for a multipart upload part.
 * Used internally for processing multipart uploads.
 */
interface PartInput {
    /**
     * The part number (1-based index).
     */
    partNumber: number;
    /**
     * The content of the part.
     */
    blob: PutBody;
}
/**
 * Represents a single part of a multipart upload.
 * This structure is used when completing a multipart upload to specify the
 * uploaded parts and their order.
 */
interface Part {
    /**
     * The ETag value returned when the part was uploaded.
     * This value is used to verify the integrity of the uploaded part.
     */
    etag: string;
    /**
     * The part number of this part (1-based).
     * This number is used to order the parts when completing the multipart upload.
     */
    partNumber: number;
}

/**
 * Options for completing a multipart upload.
 * Used with the completeMultipartUpload method.
 */
interface CommonCompleteMultipartUploadOptions {
    /**
     * Unique upload identifier for the multipart upload, received from createMultipartUpload.
     * This ID is used to identify which multipart upload is being completed.
     */
    uploadId: string;
    /**
     * Unique key identifying the blob object, received from createMultipartUpload.
     * This key is used to identify which blob object the parts belong to.
     */
    key: string;
}
type CompleteMultipartUploadCommandOptions = CommonCompleteMultipartUploadOptions & CommonCreateBlobOptions;

/**
 * Options for uploading a part in a multipart upload process.
 * Used with the uploadPart method.
 */
interface CommonMultipartUploadOptions {
    /**
     * Unique upload identifier for the multipart upload, received from createMultipartUpload.
     * This ID is used to associate all uploaded parts with the same multipart upload.
     */
    uploadId: string;
    /**
     * Unique key identifying the blob object, received from createMultipartUpload.
     * This key is used to identify which blob object the parts belong to.
     */
    key: string;
    /**
     * A number identifying which part is being uploaded (1-based).
     * This number is used to order the parts when completing the multipart upload.
     * Parts must be uploaded with consecutive part numbers starting from 1.
     */
    partNumber: number;
}
type UploadPartCommandOptions = CommonMultipartUploadOptions & CommonCreateBlobOptions;

type CreateFolderCommandOptions = Pick<CommonCreateBlobOptions, 'token' | 'abortSignal'> & {
    /** @defaultValue 'public' — kept for backward compatibility */
    access?: BlobAccessType;
};
interface CreateFolderResult {
    pathname: string;
    url: string;
}
/**
 * Creates a folder in your store. Vercel Blob has no real concept of folders, our file browser on Vercel.com displays folders based on the presence of trailing slashes in the pathname. Unless you are building a file browser system, you probably don't need to use this method.
 *
 * Use the resulting `url` to delete the folder, just like you would delete a blob.
 * @param pathname - Can be user1/ or user1/avatars/
 * @param options - Additional options including required `access` ('public' or 'private') and optional `token`
 */
declare function createFolder(pathname: string, options?: CreateFolderCommandOptions): Promise<CreateFolderResult>;

export { type BlobAccessType as B, type CommonCompleteMultipartUploadOptions as C, type OnUploadProgressCallback as O, type PutBlobResult as P, type UploadPartCommandOptions as U, type WithUploadProgress as W, type BlobCommandOptions as a, type Part as b, type PutBody as c, type CommonMultipartUploadOptions as d, createFolder as e, type CommonCreateBlobOptions as f, BlobError as g, type CompleteMultipartUploadCommandOptions as h, type CreateFolderCommandOptions as i, type CreateFolderResult as j, type PartInput as k, type UploadProgressEvent as l, getDownloadUrl as m };
