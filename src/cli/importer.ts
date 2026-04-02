import { extname } from "node:path";

import type { EventRole, MemoryEvent } from "../types.js";
import { createId } from "../utils/id.js";

export type IngestFormat = "auto" | "txt" | "json" | "jsonl";
export type IngestResolvedFormat = Exclude<IngestFormat, "auto">;
export type IngestTextSplitMode = "paragraph" | "line";

export interface IngestParseOptions {
  filePath: string;
  content: string;
  format: IngestFormat;
  textField: string;
  roleField: string;
  timeField: string;
  defaultRole: EventRole;
  textSplitMode: IngestTextSplitMode;
}

export interface IngestParseResult {
  format: IngestResolvedFormat;
  records: MemoryEvent[];
  skipped: number;
  warnings: string[];
}

const KNOWN_ROLES: ReadonlySet<EventRole> = new Set(["system", "user", "assistant", "tool"]);
const KNOWN_FORMATS: ReadonlySet<IngestFormat> = new Set(["auto", "txt", "json", "jsonl"]);
const KNOWN_TEXT_SPLIT_MODES: ReadonlySet<IngestTextSplitMode> = new Set(["paragraph", "line"]);

export function isSupportedIngestFormat(value: string | undefined): value is IngestFormat {
  if (!value) return false;
  return KNOWN_FORMATS.has(value as IngestFormat);
}

export function isSupportedIngestTextSplit(value: string | undefined): value is IngestTextSplitMode {
  if (!value) return false;
  return KNOWN_TEXT_SPLIT_MODES.has(value as IngestTextSplitMode);
}

export function isSupportedEventRole(value: string | undefined): value is EventRole {
  if (!value) return false;
  return KNOWN_ROLES.has(value as EventRole);
}

export function parseIngestContent(options: IngestParseOptions): IngestParseResult {
  const format = resolveIngestFormat(options.filePath, options.format);
  if (format === "txt") {
    return parseTextContent(options.content, options.defaultRole, options.textSplitMode);
  }
  if (format === "json") {
    return parseJsonContent(options);
  }
  return parseJsonlContent(options);
}

function resolveIngestFormat(filePath: string, format: IngestFormat): IngestResolvedFormat {
  if (format !== "auto") return format;
  const normalizedExt = extname(filePath).trim().toLowerCase();
  if (normalizedExt === ".json") return "json";
  if (normalizedExt === ".jsonl" || normalizedExt === ".ndjson") return "jsonl";
  return "txt";
}

function parseTextContent(
  content: string,
  defaultRole: EventRole,
  splitMode: IngestTextSplitMode
): IngestParseResult {
  const warnings: string[] = [];
  const rawItems =
    splitMode === "line"
      ? content.split(/\r?\n/)
      : content.split(/\r?\n(?:\s*\r?\n)+/);
  const records: MemoryEvent[] = [];
  let skipped = 0;
  const baseTimestamp = Date.now();

  for (const raw of rawItems) {
    const text = raw.trim();
    if (!text) {
      skipped += 1;
      continue;
    }
    records.push({
      id: createId("import_event"),
      role: defaultRole,
      text,
      timestamp: baseTimestamp + records.length
    });
  }

  return {
    format: "txt",
    records,
    skipped,
    warnings
  };
}

function parseJsonContent(options: IngestParseOptions): IngestParseResult {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(options.content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid JSON: ${message}`);
  }

  const rows = normalizeJsonRoot(parsed);
  return normalizeRows(rows, options, warnings);
}

function parseJsonlContent(options: IngestParseOptions): IngestParseResult {
  const warnings: string[] = [];
  const rows: unknown[] = [];
  const lines = options.content.split(/\r?\n/);
  let malformedLines = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!.trim();
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`line ${lineIndex + 1}: invalid JSONL row (${message})`);
      malformedLines += 1;
    }
  }

  const normalized = normalizeRows(rows, options, warnings, "jsonl");
  return {
    ...normalized,
    skipped: normalized.skipped + malformedLines
  };
}

function normalizeJsonRoot(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!isRecord(parsed)) return [parsed];
  const candidateRows = parsed.rows;
  if (Array.isArray(candidateRows)) return candidateRows;
  const candidateRecords = parsed.records;
  if (Array.isArray(candidateRecords)) return candidateRecords;
  const candidateItems = parsed.items;
  if (Array.isArray(candidateItems)) return candidateItems;
  return [parsed];
}

function normalizeRows(
  rows: unknown[],
  options: IngestParseOptions,
  warnings: string[],
  fixedFormat: IngestResolvedFormat = "json"
): IngestParseResult {
  const records: MemoryEvent[] = [];
  let skipped = 0;
  const baseTimestamp = Date.now();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const event = normalizeRow(
      rows[rowIndex],
      rowIndex + 1,
      {
        textField: options.textField,
        roleField: options.roleField,
        timeField: options.timeField,
        defaultRole: options.defaultRole,
        baseTimestamp
      },
      warnings
    );
    if (!event) {
      skipped += 1;
      continue;
    }
    records.push(event);
  }

  return {
    format: fixedFormat,
    records,
    skipped,
    warnings
  };
}

function normalizeRow(
  row: unknown,
  rowNumber: number,
  options: {
    textField: string;
    roleField: string;
    timeField: string;
    defaultRole: EventRole;
    baseTimestamp: number;
  },
  warnings: string[]
): MemoryEvent | null {
  if (typeof row === "string") {
    const text = row.trim();
    if (!text) return null;
    return {
      id: createId("import_event"),
      role: options.defaultRole,
      text,
      timestamp: options.baseTimestamp + rowNumber
    };
  }

  if (!isRecord(row)) {
    warnings.push(`row ${rowNumber}: unsupported record type`);
    return null;
  }

  const text = pickText(row, options.textField);
  if (!text) {
    warnings.push(`row ${rowNumber}: missing non-empty text field "${options.textField}"`);
    return null;
  }

  const role = pickRole(row, options.roleField, options.defaultRole);
  const timestamp = pickTimestamp(
    row,
    options.timeField,
    options.baseTimestamp + rowNumber
  );
  const metadata = buildMetadata(row, options.textField, options.roleField, options.timeField);

  return {
    id: createId("import_event"),
    role,
    text,
    timestamp,
    metadata
  };
}

function pickText(record: Record<string, unknown>, textField: string): string | undefined {
  const keys = uniqueKeys([textField, "text", "content", "message"]);
  for (const key of keys) {
    const value = record[key];
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    return text.length > 0 ? text : undefined;
  }
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  if (parts.length === 0) return undefined;
  return parts.join("\n");
}

function pickRole(record: Record<string, unknown>, roleField: string, fallback: EventRole): EventRole {
  const keys = uniqueKeys([roleField, "role"]);
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw !== "string") continue;
    const normalized = raw.trim().toLowerCase();
    if (isSupportedEventRole(normalized)) return normalized;
  }
  return fallback;
}

function pickTimestamp(
  record: Record<string, unknown>,
  timeField: string,
  fallback: number
): number {
  const keys = uniqueKeys([timeField, "timestamp", "time", "createdAt", "created_at"]);
  for (const key of keys) {
    const raw = record[key];
    const parsed = parseTimestamp(raw);
    if (parsed !== undefined) return parsed;
  }
  return fallback;
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeNumericTimestamp(value);
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return normalizeNumericTimestamp(numeric);
  }
  const asDate = Date.parse(trimmed);
  if (!Number.isFinite(asDate)) return undefined;
  return Math.trunc(asDate);
}

function normalizeNumericTimestamp(value: number): number {
  const abs = Math.abs(value);
  if (abs > 0 && abs <= 9_999_999_999) {
    return Math.trunc(value * 1000);
  }
  return Math.trunc(value);
}

function buildMetadata(
  record: Record<string, unknown>,
  textField: string,
  roleField: string,
  timeField: string
): Record<string, unknown> | undefined {
  const excluded = new Set(uniqueKeys([textField, roleField, timeField, "text", "role", "timestamp"]));
  const metadata: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (excluded.has(key)) continue;
    metadata[key] = value;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function uniqueKeys(input: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const key of input) {
    const normalized = key.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
