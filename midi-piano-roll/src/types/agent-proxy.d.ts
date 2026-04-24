declare module "*.mjs" {
  export function createTerminalLogger(opts?: {
    mode?: "pretty" | "raw" | "off" | "1" | "0";
    showDeltas?: boolean;
    maxChars?: number;
    showOutputs?: boolean;
    write?: (line: string) => void;
  }): {
    onRequestJson(input: unknown): void;
    onSseChunkText(text: string): void;
    close(): void;
  };
}
