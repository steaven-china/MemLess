import { describe, expect, test } from "vitest";

import { Agent } from "../src/agent/Agent.js";
import type { ChatMessage, ILLMProvider } from "../src/agent/LLMProvider.js";
import type { IMemoryManager } from "../src/memory/IMemoryManager.js";
import type { BlockRef, Context, MemoryEvent, ProactivePlan } from "../src/types.js";

class FakeMemoryManager implements IMemoryManager {
  public events: MemoryEvent[] = [];
  public tickCount = 0;

  constructor(private readonly context: Context) {}

  async addEvent(event: MemoryEvent): Promise<void> {
    this.events.push(event);
  }

  async getContext(_query: string): Promise<Context> {
    return this.context;
  }

  async sealCurrentBlock(): Promise<void> {}

  createNewBlock(): void {}

  async retrieveBlocks(): Promise<BlockRef[]> {
    return [];
  }

  async tickProactiveWakeup(): Promise<void> {
    this.tickCount += 1;
  }
}

class MockProvider implements ILLMProvider {
  async generate(_messages: ChatMessage[]): Promise<string> {
    return "常规回答";
  }
}

describe("Agent proactive wakeup", () => {
  test("triggers proactive planner and actuator after normal response", async () => {
    const memory = new FakeMemoryManager({
      blocks: [],
      recentEvents: [],
      formatted: "",
      proactiveSignal: {
        allowWakeup: true,
        mode: "inject",
        intents: [{ blockId: "b1", label: "任务A", confidence: 0.92 }],
        reason: "inject_ready",
        evidenceNeedHint: "none",
        triggerSource: "user",
        timerEnabled: true,
        timerIntervalSeconds: 30
      }
    });

    let plannerCalled = 0;
    let actuatorCalled = 0;
    let plannerInput = "";
    let actuatorPlan: ProactivePlan | undefined;

    const planner = {
      buildPlan(input: { userInput: string; context: Context }): ProactivePlan {
        plannerCalled += 1;
        plannerInput = input.userInput;
        return {
          action: "ask_followup",
          shouldSearchEvidence: false,
          searchQueries: [],
          messageSeed: "继续推进",
          reason: "inject_ready"
        };
      }
    };

    const actuator = {
      async execute(plan: ProactivePlan): Promise<string> {
        actuatorCalled += 1;
        actuatorPlan = plan;
        return "主动消息";
      }
    };

    const agent = new Agent(memory, new MockProvider(), {
      proactivePlanner: planner as never,
      proactiveActuator: actuator as never
    });

    const result = await agent.respond("请继续");

    expect(result.text).toBe("常规回答");
    expect(result.proactiveText).toBe("主动消息");
    expect(plannerCalled).toBe(1);
    expect(plannerInput).toBe("请继续");
    expect(actuatorCalled).toBe(1);
    expect(actuatorPlan?.action).toBe("ask_followup");
    expect(memory.events.map((event) => event.role)).toEqual(["user", "assistant"]);
  });

  test("supports timer-triggered proactive wakeup without user event", async () => {
    const memory = new FakeMemoryManager({
      blocks: [],
      recentEvents: [],
      formatted: "",
      proactiveSignal: {
        allowWakeup: true,
        mode: "inject",
        intents: [{ blockId: "b1", label: "任务A", confidence: 0.92 }],
        reason: "inject_ready",
        evidenceNeedHint: "none",
        triggerSource: "user",
        timerEnabled: true,
        timerIntervalSeconds: 30
      }
    });

    const planner = {
      buildPlan(): ProactivePlan {
        return {
          action: "ask_followup",
          shouldSearchEvidence: false,
          searchQueries: [],
          messageSeed: "继续推进",
          reason: "inject_ready"
        };
      }
    };

    const actuator = {
      async execute(): Promise<string> {
        return "主动消息";
      }
    };

    const agent = new Agent(memory, new MockProvider(), {
      proactivePlanner: planner as never,
      proactiveActuator: actuator as never
    });

    const proactiveText = await agent.tickProactiveWakeup();

    expect(proactiveText).toBe("主动消息");
    expect(memory.tickCount).toBe(1);
    expect(memory.events).toHaveLength(0);
  });

});
