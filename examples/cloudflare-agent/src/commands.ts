/**
 * Command dispatch for the Tai fulfillment contract. Maps a command id +
 * inputs to a text result. Kept pure (the answer fn is injected) so it is
 * unit-testable without the network or env.
 */
export const SUPPORTED_COMMANDS = ["ask"] as const;

export type Answerer = { answer: (prompt: string) => Promise<string> };

export async function dispatchCommand(
  command: string,
  inputs: Record<string, unknown>,
  deps: Answerer,
): Promise<string> {
  if (command === "ask") {
    const prompt = String(inputs.prompt ?? inputs.question ?? "").trim();
    if (!prompt) throw new Error("ask requires a `prompt`");
    return deps.answer(prompt);
  }
  throw new Error(`unknown command: ${command}`);
}
