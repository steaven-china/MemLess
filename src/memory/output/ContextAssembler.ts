import type { BlockRef, Context, MemoryEvent, PredictionResult, ProactiveSignal } from "../../types.js";

export class ContextAssembler {
  assemble(
    blocks: BlockRef[],
    recentEvents: MemoryEvent[],
    prediction?: PredictionResult,
    proactiveSignal?: ProactiveSignal
  ): Context {
    const formatted = this.formatContext(blocks, recentEvents, prediction, proactiveSignal);
    return {
      blocks,
      recentEvents,
      formatted,
      prediction,
      proactiveSignal
    };
  }

  private formatContext(
    blocks: BlockRef[],
    recentEvents: MemoryEvent[],
    prediction?: PredictionResult,
    proactiveSignal?: ProactiveSignal
  ): string {
    const blockLines = blocks.map((block, index) => {
      const header =
        `#${index + 1} [${block.id}] score=${block.score.toFixed(3)} ` +
        `retention=${block.retentionMode ?? "raw"} match=${(block.matchScore ?? 0).toFixed(3)} ` +
        `tags=${(block.tags ?? ["normal"]).join("|")}`;
      const summary = block.summary ? `summary: ${block.summary}` : "summary: <empty>";
      const evidence = formatEvidence(block.rawEvents);
      return evidence ? `${header}\n${summary}\nevidence:\n${evidence}` : `${header}\n${summary}`;
    });

    const recentLines = recentEvents.map(
      (event) =>
        `${new Date(event.timestamp).toISOString()} ${event.role.toUpperCase()}: ${event.text}`
    );

    const predictionLines = prediction
      ? [
          "=== PREDICTION ===",
          `activeTrigger=${prediction.activeTrigger}`,
          `vectorDim=${prediction.vector.length}`,
          ...prediction.intents.map(
            (intent, index) =>
              `intent#${index + 1} block=${intent.blockId} conf=${intent.confidence.toFixed(3)} label=${intent.label}`
          )
        ]
      : [];

    const proactiveLines = proactiveSignal
      ? [
          "=== PROACTIVE SIGNAL ===",
          `allowWakeup=${proactiveSignal.allowWakeup}`,
          `mode=${proactiveSignal.mode}`,
          `reason=${proactiveSignal.reason}`,
          `evidenceNeedHint=${proactiveSignal.evidenceNeedHint}`,
          `triggerSource=${proactiveSignal.triggerSource}`,
          `timerEnabled=${proactiveSignal.timerEnabled}`,
          `timerIntervalSeconds=${proactiveSignal.timerIntervalSeconds}`,
          ...proactiveSignal.intents.map(
            (intent, index) =>
              `signalIntent#${index + 1} block=${intent.blockId} conf=${intent.confidence.toFixed(3)} label=${intent.label}`
          )
        ]
      : [];

    return [
      "=== RETRIEVED BLOCKS ===",
      ...blockLines,
      "",
      "=== RECENT EVENTS ===",
      ...recentLines,
      "",
      ...predictionLines,
      ...(predictionLines.length > 0 && proactiveLines.length > 0 ? [""] : []),
      ...proactiveLines
    ].join("\n");
  }
}

function formatEvidence(events: MemoryEvent[] | undefined): string {
  if (!events || events.length === 0) return "";
  return events
    .slice(-2)
    .map((event) => {
      const text = event.text.replace(/\s+/g, " ").trim();
      const clipped = text.length > 140 ? `${text.slice(0, 140)}...` : text;
      return `- ${event.role}: ${clipped}`;
    })
    .join("\n");
}
