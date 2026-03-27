import type { Agent } from "../agent/Agent.js";

export interface ProactiveTimerSchedulerConfig {
  agent: Agent;
  enabled: boolean;
  intervalSeconds: number;
}

export class ProactiveTimerScheduler {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly config: ProactiveTimerSchedulerConfig) {}

  start(): void {
    if (!this.config.enabled) return;
    const intervalMs = Math.max(1, this.config.intervalSeconds) * 1000;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.config.agent.tickProactiveWakeup();
    } finally {
      this.running = false;
    }
  }
}
