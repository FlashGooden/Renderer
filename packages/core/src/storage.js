import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { ensureDir } from "./fs-utils.js";

export class LocalStorageDriver {
  constructor(rootDir) {
    this.rootDir = path.join(rootDir, "blobs");
  }

  async initialize() {
    await ensureDir(this.rootDir);
  }

  async putBuffer(relativePath, buffer) {
    const absolutePath = path.join(this.rootDir, relativePath);
    await ensureDir(path.dirname(absolutePath));
    await fs.writeFile(absolutePath, buffer);
    return {
      type: "local",
      path: absolutePath
    };
  }

  async putFile(relativePath, sourcePath) {
    const absolutePath = path.join(this.rootDir, relativePath);
    await ensureDir(path.dirname(absolutePath));
    await fs.copyFile(sourcePath, absolutePath);
    return {
      type: "local",
      path: absolutePath
    };
  }

  async readBuffer(locator) {
    return fs.readFile(locator.path);
  }

  createReadStream(locator) {
    return createReadStream(locator.path);
  }
}

export class AzureBlobStorageDriver {
  constructor(baseUrl) {
    if (!baseUrl) {
      throw new Error("AVATAR_AZURE_BLOB_BASE_URL is required for azure-blob storage mode.");
    }
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async initialize() {}

  buildUrl(relativePath) {
    return `${this.baseUrl}/${relativePath.replace(/^\/+/, "")}`;
  }

  async putBuffer(relativePath, buffer, contentType = "application/octet-stream") {
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
      type: "azure-blob",
      url
    };
  }

  async putFile(relativePath, sourcePath, contentType = "application/octet-stream") {
    const buffer = await fs.readFile(sourcePath);
    return this.putBuffer(relativePath, buffer, contentType);
  }

  async readBuffer(locator) {
    const response = await fetch(locator.url);
    if (!response.ok) {
      throw new Error(`Azure Blob download failed with status ${response.status}.`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  createReadStream() {
    throw new Error("Streaming Azure Blob artifacts is not supported by this minimal implementation.");
  }
}

export function createStorageDriver(config) {
  if (config.storageMode === "azure-blob") {
    return new AzureBlobStorageDriver(config.azureBlobBaseUrl);
  }
  return new LocalStorageDriver(config.dataDir);
}

