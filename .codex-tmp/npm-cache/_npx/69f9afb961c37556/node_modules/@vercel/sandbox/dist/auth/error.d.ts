export declare class NotOk extends Error {
    name: string;
    response: {
        statusCode: number;
        responseText: string;
    };
    constructor(response: {
        statusCode: number;
        responseText: string;
    });
}
