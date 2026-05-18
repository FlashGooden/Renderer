// @ts-nocheck
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { AzureBlobStorageDriver, LocalStorageDriver } from "../src/storage.js";

test("LocalStorageDriver returns byte counts for writes and reads", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-storage-"));
  const driver = new LocalStorageDriver(rootDir);
  await driver.initialize();

  const bufferWrite = await driver.putBuffer("inputs/reference.txt", Buffer.from("hello"));
  assert.equal(bufferWrite.bytes, 5);

  const bufferRead = await driver.readBuffer(bufferWrite.locator);
  assert.equal(bufferRead.bytes, 5);
  assert.equal(bufferRead.buffer.toString("utf8"), "hello");

  const sourcePath = path.join(rootDir, "source.bin");
  await fs.writeFile(sourcePath, Buffer.from([0, 1, 2, 3]));

  const fileWrite = await driver.putFile("inputs/source.bin", sourcePath);
  assert.equal(fileWrite.bytes, 4);
});

test("AzureBlobStorageDriver returns byte counts for writes and reads", async () => {
  const uploaded = new Map();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const key = String(url);
    if (init.method === "PUT") {
      uploaded.set(key, Buffer.from(init.body));
      return new Response(null, { status: 201 });
    }
    return new Response(uploaded.get(key), { status: 200 });
  };

  try {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-storage-"));
    const driver = new AzureBlobStorageDriver("https://acct.blob.core.windows.net/container");

    const bufferWrite = await driver.putBuffer("outputs/buffer.bin", Buffer.from("abc"));
    assert.equal(bufferWrite.bytes, 3);

    const bufferRead = await driver.readBuffer(bufferWrite.locator);
    assert.equal(bufferRead.bytes, 3);
    assert.equal(bufferRead.buffer.toString("utf8"), "abc");

    const sourcePath = path.join(rootDir, "source.bin");
    await fs.writeFile(sourcePath, Buffer.from("abcdef"));

    const fileWrite = await driver.putFile("outputs/source.bin", sourcePath);
    assert.equal(fileWrite.bytes, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AzureBlobStorageDriver.buildUrl appends blob paths without query params", () => {
  const driver = new AzureBlobStorageDriver("https://acct.blob.core.windows.net/container");

  assert.equal(
    driver.buildUrl("outputs/a.mp4"),
    "https://acct.blob.core.windows.net/container/outputs/a.mp4"
  );
});

test("AzureBlobStorageDriver.buildUrl preserves SAS query params", () => {
  const driver = new AzureBlobStorageDriver(
    "https://acct.blob.core.windows.net/container?sv=2024-11-04&sig=abc123"
  );

  assert.equal(
    driver.buildUrl("outputs/a.mp4"),
    "https://acct.blob.core.windows.net/container/outputs/a.mp4?sv=2024-11-04&sig=abc123"
  );
});

test("AzureBlobStorageDriver.buildUrl normalizes duplicate slashes around the blob path", () => {
  const driver = new AzureBlobStorageDriver(
    "https://acct.blob.core.windows.net/container/?sv=2024-11-04&sig=abc123"
  );

  assert.equal(
    driver.buildUrl("/outputs/a.mp4"),
    "https://acct.blob.core.windows.net/container/outputs/a.mp4?sv=2024-11-04&sig=abc123"
  );
});
