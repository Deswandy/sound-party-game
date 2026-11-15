interface D1Database {
  prepare(query: string): unknown;
}

interface R2Bucket {
  put(key: string, value: ReadableStream | ArrayBuffer | string): Promise<unknown>;
}
