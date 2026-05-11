// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { AzureBlobStorageDriver } from "../src/storage.js";

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
