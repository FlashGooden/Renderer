import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream, type ReadStream } from "node:fs";
import { ensureDir } from "./fs-utils.js";
import type { ProjectConfig, StorageDriver, StorageLocator, StorageReadResult, StorageWriteResult } from "./types.js";

export class LocalStorageDriver implements StorageDriver {
  rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.join(rootDir, "blobs");
  }

  async initialize(): Promise<void> {
    await ensureDir(this.rootDir);
  }

  async putBuffer(relativePath: string, buffer: Buffer): Promise<StorageWriteResult> {
    const absolutePath = path.join(this.rootDir, relativePath);
    await ensureDir(path.dirname(absolutePath));
    await fs.writeFile(absolutePath, buffer);
    return {
      locator: {
        type: "local",
        path: absolutePath
      },
      bytes: buffer.length
    };
  }

  async putFile(relativePath: string, sourcePath: string): Promise<StorageWriteResult> {
    const absolutePath = path.join(this.rootDir, relativePath);
    await ensureDir(path.dirname(absolutePath));
    await fs.copyFile(sourcePath, absolutePath);
    const stat = await fs.stat(absolutePath);
    return {
      locator: {
        type: "local",
        path: absolutePath
      },
      bytes: stat.size
    };
  }

  async readBuffer(locator: StorageLocator): Promise<StorageReadResult> {
    if (!locator.path) {
      throw new Error("Local storage locator is missing a path.");
    }
    const buffer = await fs.readFile(locator.path);
    return {
      buffer,
      bytes: buffer.length
    };
  }

  createReadStream(locator: StorageLocator): ReadStream {
    if (!locator.path) {
      throw new Error("Local storage locator is missing a path.");
    }
    return createReadStream(locator.path);
  }
}

export class AzureBlobStorageDriver implements StorageDriver {
  baseUrl: string;

  constructor(baseUrl: string) {
    if (!baseUrl) {
      throw new Error("AVATAR_AZURE_BLOB_BASE_URL is required for azure-blob storage mode.");
    }
    this.baseUrl = baseUrl;
  }

  async initialize(): Promise<void> {}

  buildUrl(relativePath: string): string {
    const url = new URL(this.baseUrl);
    const cleanBasePath = url.pathname.replace(/\/+$/, "");
    const cleanRelativePath = relativePath.replace(/^\/+/, "");
    url.pathname = `${cleanBasePath}/${cleanRelativePath}`;
    return url.toString();
  }

  async putBuffer(relativePath: string, buffer: Buffer, contentType = "application/octet-stream"): Promise<StorageWriteResult> {
    const url = this.buildUrl(relativePath);
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "content-type": contentType,
        "content-length": String(buffer.length)
      },
      body: buffer
    });

    if (!response.ok) {
      throw new Error(`Azure Blob upload failed with status ${response.status}.`);
    }

    return {
      locator: {
        type: "azure-blob",
        url
      },
      bytes: buffer.length
    };
  }

  async putFile(relativePath: string, sourcePath: string, contentType = "application/octet-stream"): Promise<StorageWriteResult> {
    const buffer = await fs.readFile(sourcePath);
    return this.putBuffer(relativePath, buffer, contentType);
  }

  async readBuffer(locator: StorageLocator): Promise<StorageReadResult> {
    if (!locator.url) {
      throw new Error("Azure Blob locator is missing a URL.");
    }
    const response = await fetch(locator.url);
    if (!response.ok) {
      throw new Error(`Azure Blob download failed with status ${response.status}.`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      buffer,
      bytes: buffer.length
    };
  }

  createReadStream(): never {
    throw new Error("Streaming Azure Blob artifacts is not supported by this minimal implementation.");
  }
}

export function createStorageDriver(config: ProjectConfig): StorageDriver {
  if (config.storageMode === "azure-blob") {
    return new AzureBlobStorageDriver(config.azureBlobBaseUrl);
  }
  return new LocalStorageDriver(config.dataDir);
}
