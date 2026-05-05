import test from "node:test";
import assert from "node:assert/strict";
import { getPreset } from "../src/presets.js";
import {
  ProviderError,
  ReplicateDreamActorProvider,
  normalizeReplicateFailure
} from "../src/providers.js";

test("ReplicateDreamActorProvider derives provider input from preset plus generic sources", () => {
  const provider = new ReplicateDreamActorProvider({
    apiToken: "test-token"
  });

  const input = provider.buildPredictionInput({
    preset: getPreset("preview-720p"),
    referenceInput: "https://example.com/reference.png",
    sourceInput: "https://example.com/driving.mp4"
  });

  assert.deepEqual(input, {
    image: "https://example.com/reference.png",
    video: "https://example.com/driving.mp4",
    cut_first_second: false
  });
});

test("ReplicateDreamActorProvider maps HTTP and terminal failures into normalized codes", async () => {
  const provider = new ReplicateDreamActorProvider({
    apiToken: "test-token"
  });

  assert.throws(
    () => provider.assertReplicateOk(new Response(JSON.stringify({ detail: "bad token" }), { status: 401 }), { detail: "bad token" }),
    (error) => error instanceof ProviderError && error.code === "provider_auth"
  );

  assert.throws(
    () => provider.assertReplicateOk(new Response(JSON.stringify({ detail: "slow down" }), { status: 429 }), { detail: "slow down" }),
    (error) => error instanceof ProviderError && error.code === "provider_rate_limited"
  );

  const rejectedInput = provider.normalizeTerminalState({
    status: "failed",
    error: "unsupported input dimensions"
  });
  assert.equal(rejectedInput.code, "provider_rejected_input");

  const canceled = provider.normalizeTerminalState({
    status: "cancelled",
    error: null
  });
  assert.equal(canceled.code, "provider_canceled");

  await assert.rejects(
    () => provider.collectResult({ status: "succeeded", output: null }, { runId: "run_test" }),
    (error) => error instanceof ProviderError && error.code === "provider_output_missing"
  );

  const timeout = normalizeReplicateFailure(new ProviderError("provider_timeout", "timed out", { retryable: true }));
  assert.deepEqual(
    {
      code: timeout.code,
      retryable: timeout.retryable
    },
    {
      code: "provider_timeout",
      retryable: true
    }
  );
});
