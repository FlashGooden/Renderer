export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}
export type AnyRecord = Record<string, any>;

export type AssetKind = "reference" | "driving";
export type RunState = "queued" | "running" | "needs_review" | "succeeded" | "failed" | "dead_lettered";
export type ReviewDecision = "approve" | "reject";
export type ReviewCriterionKey = "identity" | "motion" | "stability" | "corruption" | "overall";
export type ReviewCriterionState = "pass" | "fail" | "needs_work" | "unreviewed";
export type ReviewTag =
  | "identity"
  | "motion"
  | "stability"
  | "corruption"
  | "blur"
  | "flicker"
  | "freeze"
  | "artifact"
  | "usable"
  | "needs_followup";
export type ArtifactKind =
  | "retargeted_video"
  | "preview_still"
  | "contact_sheet"
  | "provider_submit_request"
  | "provider_submit_response"
  | "provider_poll_response"
  | "provider_terminal_response"
  | "provider_cancel_response";
export type FailureCode =
  | "provider_auth"
  | "provider_rate_limited"
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_validation"
  | "provider_rejected_input"
  | "provider_run_failed"
  | "provider_canceled"
  | "provider_output_missing"
  | "provider_download_failed"
  | "provider_unknown";

export interface ProjectConfig {
  runnerUrl: string;
  runnerPort: number;
  dataDir: string;
  storageMode: "local" | "azure-blob" | string;
  azureBlobBaseUrl: string;
  replicateApiToken: string;
  replicateModel: string;
  providerTimeoutSec: number;
  providerPollIntervalMs: number;
  queuePollIntervalMs: number;
  queueMaxConcurrent: number;
  staleRunThresholdMs: number;
  staleRunSweepIntervalMs: number;
  tempFileMaxAgeSec: number;
  artifactRetentionDays: number;
  videoRetentionDays: number;
  metadataRetentionDays: number;
  replicateCostPerSecondUsd: number;
  azureBlobWriteUsdPerGb: number;
  azureBlobReadUsdPerGb: number;
  computeUsdPerMs: number;
}

export interface StorageLocator extends AnyRecord {
  type: string;
  path?: string;
  url?: string;
}

export interface StorageWriteResult {
  locator: StorageLocator;
  bytes: number;
}

export interface StorageReadResult {
  buffer: Buffer;
  bytes: number;
}

export interface MediaInspection {
  durationSec: number;
  sizeBytes: number;
  width: number;
  height: number;
  codecName: string | null;
  frameRate: number;
  formatName: string | null;
  formatNames: string[];
  hasVideoStream: boolean;
}

export interface Asset {
  id: string;
  kind: AssetKind;
  label: string;
  filename: string;
  extension: string;
  contentType: string;
  checksum: string;
  createdAt: string;
  locator: StorageLocator;
  media: MediaInspection;
}

export interface AssetRef {
  assetId: string;
  kind: AssetKind;
  filename: string;
  extension: string;
  contentType: string;
  checksum: string;
  locator: StorageLocator;
  media: MediaInspection;
}

export interface ProviderState extends AnyRecord {
  providerRunId?: string | null;
  modelId?: string | null;
  status?: string;
  getUrl?: string | null;
  pollUrl?: string | null;
  cancelUrl?: string | null;
  output?: any;
  error?: any;
  logs?: any;
  metrics?: AnyRecord | null;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  lastPolledAt?: string | null;
  pollCount?: number;
}

export interface ProviderSnapshot {
  id: string;
  displayName: string;
  modelId: string | null;
  runId: string | null;
  status: string;
  submittedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastPolledAt: string | null;
  pollCount: number;
}

export interface Failure {
  code: FailureCode | string;
  message: string;
  retryable: boolean;
  providerStatus: string | null;
  details: AnyRecord;
}

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterRatio: number;
  retryableFailureCodes?: string[];
}

export interface RetryState {
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastAttemptAt: string | null;
  lastFailureCode: string | null;
  lastFailureMessage: string | null;
}

export interface QueueEntry {
  id: string;
  runId: string;
  state: "queued" | "leased" | "completed" | "failed" | "dead_lettered";
  priority: number;
  attempts: number;
  availableAt: string;
  leasedAt: string | null;
  leaseExpiresAt: string | null;
  workerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunCost {
  estimatedUsd: number;
  providerUsd?: number;
  storageWriteUsd?: number;
  storageReadUsd?: number;
  computeUsd?: number;
  totalUsd?: number;
  currency?: string;
  details?: AnyRecord;
}

export interface RunnerMetrics {
  queueWaitMs?: number;
  providerRuntimeMs?: number;
  totalRuntimeMs?: number;
  storageBytesWritten?: number;
  storageBytesRead?: number;
  computeMs?: number;
  providerPollCount?: number;
  details?: AnyRecord;
}

export interface LogEntry {
  id: string;
  runId?: string;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  context?: AnyRecord;
}

export interface EvaluationResult extends AnyRecord {
  overallScore: number;
  identityScore: number;
  motionScore: number;
  stabilityScore: number;
  corruptionScore: number;
  flags: string[];
}

export interface Artifact {
  id: string;
  kind: ArtifactKind | string;
  filename: string;
  locator: StorageLocator;
  contentType: string;
  createdAt: string;
  metadata: AnyRecord;
}

export interface RunSpec {
  referenceAssetId: string;
  sourceVideoAssetId: string;
  presetId: string;
  outputProfile: string;
  notes: string;
  benchmarkDatasetId: string | null;
  benchmarkCaseId: string | null;
  benchmarkRunGroupId: string | null;
  candidateLabel: string;
}

export interface Run {
  id: string;
  state: RunState;
  reviewStatus: string;
  providerId: string;
  provider: ProviderSnapshot;
  presetId: string;
  outputProfile: string;
  notes: string;
  referenceAssetId: string;
  sourceVideoAssetId: string;
  benchmarkDatasetId: string | null;
  benchmarkCaseId: string | null;
  benchmarkRunGroupId: string | null;
  candidateLabel: string;
  artifacts: Artifact[];
  attempts: number;
  cost: RunCost;
  retryState: RetryState | null;
  deadLetteredAt: string | null;
  deadLetterReason: string | null;
  archived?: boolean;
  evaluation: EvaluationResult | null;
  failure: Failure | null;
  failureReason: string | null;
  lineage: AnyRecord;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ReviewEntry {
  runId: string;
  reviewer: string;
  decision: ReviewDecision | null;
  notes: string;
  tags: ReviewTag[];
  criteria: Record<ReviewCriterionKey, ReviewCriterionState>;
  reviewedAt: string;
}

export interface BenchmarkCase {
  id: string | null;
  label: string;
  referenceAssetId: string;
  sourceVideoAssetId: string;
  tags: ReviewTag[];
  notes: string;
}

export interface BenchmarkDataset {
  id: string;
  label: string;
  notes: string;
  cases: BenchmarkCase[];
  createdAt: string;
  updatedAt: string;
}

export interface BenchmarkRunGroupMember {
  runId: string;
  benchmarkCaseId: string | null;
  candidateLabel: string;
}

export interface BenchmarkRunGroup {
  id: string;
  label: string;
  notes: string;
  benchmarkDatasetId: string;
  candidateLabels: string[];
  members: BenchmarkRunGroupMember[];
  createdAt: string;
  updatedAt: string;
}

export interface Preset {
  id: string;
  label: string;
  maxDurationSec: number;
  width: number;
  height: number;
  aspectRatio: string;
  identityStrength: number;
  motionStrength: number;
  providers?: Record<string, AnyRecord>;
}

export interface Provider {
  id: string;
  displayName?: string;
  modelId?: string | null;
  pollIntervalMs?: number;
  timeoutSec?: number;
  listCapabilities?: () => AnyRecord;
  validateRun(context: { referenceAsset: Asset; sourceAsset: Asset; preset: Preset }): void;
  submitRun(context: AnyRecord): Promise<{ providerRunId: string; providerState: ProviderState; rawRequest: any; rawResponse: any }>;
  pollRun(state: ProviderState): Promise<{ providerState: ProviderState; rawResponse: any; terminal: boolean }>;
  cancelRun(state: ProviderState): Promise<any>;
  collectResult(state: ProviderState, context: AnyRecord): Promise<{ outputPath: string; outputUrl: string | null; usage: AnyRecord }>;
  normalizeTerminalState(state: ProviderState): Error | null;
}

export interface ProviderRegistry {
  get(providerId: string): Provider;
  list(): string[];
}

export interface StorageDriver {
  initialize(): Promise<void>;
  putBuffer(relativePath: string, buffer: Buffer, contentType?: string): Promise<StorageWriteResult>;
  putFile(relativePath: string, sourcePath: string, contentType?: string): Promise<StorageWriteResult>;
  readBuffer(locator: StorageLocator): Promise<StorageReadResult>;
  createReadStream?(locator: StorageLocator): any;
}

export interface JobStore {
  initialize(): Promise<void>;
  createAsset(asset: Asset): Promise<Asset>;
  getAsset(assetId: string): Promise<Asset | null>;
  createRun(run: Run): Promise<Run>;
  getRun(runId: string): Promise<Run | null>;
  listRuns(options?: { includeArchived?: boolean; states?: RunState[]; limit?: number }): Promise<Run[]>;
  updateRun(runId: string, updater: Partial<Run> | ((run: Run) => Run | Promise<Run>)): Promise<Run>;
  archiveRun(runId: string, reason?: string): Promise<Run>;
  appendReview(runId: string, reviewEntry: ReviewEntry): Promise<ReviewEntry[]>;
  getReviewHistory(runId: string): Promise<ReviewEntry[]>;
  createBenchmarkDataset(dataset: BenchmarkDataset): Promise<BenchmarkDataset>;
  getBenchmarkDataset(datasetId: string): Promise<BenchmarkDataset | null>;
  updateBenchmarkDataset(datasetId: string, updater: Partial<BenchmarkDataset> | ((dataset: BenchmarkDataset) => BenchmarkDataset | Promise<BenchmarkDataset>)): Promise<BenchmarkDataset>;
  createBenchmarkRunGroup(group: BenchmarkRunGroup): Promise<BenchmarkRunGroup>;
  getBenchmarkRunGroup(groupId: string): Promise<BenchmarkRunGroup | null>;
  updateBenchmarkRunGroup(groupId: string, updater: Partial<BenchmarkRunGroup> | ((group: BenchmarkRunGroup) => BenchmarkRunGroup | Promise<BenchmarkRunGroup>)): Promise<BenchmarkRunGroup>;
}
