import { describe, it, expect } from "vitest";
import { dispatchCommand, SUPPORTED_COMMANDS } from "./commands";

describe("dispatchCommand", () => {
  it("supports the ask command", () => {
    expect(SUPPORTED_COMMANDS).toContain("ask");
  });
  it("ask uses the prompt input", async () => {
    const out = await dispatchCommand(
      "ask",
      { prompt: "hello" },
      { answer: async (q: string) => `echo:${q}` },
    );
    expect(out).toBe("echo:hello");
  });
  it("falls back to legacy `question` field for ask", async () => {
    const out = await dispatchCommand(
      "ask",
      { question: "legacy" },
      { answer: async (q: string) => `echo:${q}` },
    );
    expect(out).toBe("echo:legacy");
  });
  it("rejects an unknown command", async () => {
    await expect(
      dispatchCommand("nope", {}, { answer: async () => "" }),
    ).rejects.toThrow(/unknown command/i);
  });
  it("ask requires a prompt", async () => {
    await expect(
      dispatchCommand("ask", {}, { answer: async () => "" }),
    ).rejects.toThrow(/prompt/i);
  });
});
