import { StringDecoder } from "node:string_decoder";
/** Bounded framing before JSON parsing. Normal records retain order and backpressure. */
export async function* engineLines(
  stream: NodeJS.ReadableStream,
  maxBytes = 1024 * 1024,
): AsyncGenerator<string> {
  const decoder = new StringDecoder("utf8");
  let buffered = "",
    discard = false;
  const append = (part: string) => {
    if (discard) return;
    if (Buffer.byteLength(buffered) + Buffer.byteLength(part) > maxBytes) {
      discard = true;
      buffered = "";
    } else buffered += part;
  };
  for await (const chunk of stream) {
    const text = decoder.write(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
    );
    let start = 0,
      index: number;
    while ((index = text.indexOf("\n", start)) !== -1) {
      append(text.slice(start, index));
      yield discard
        ? '{"msg":"Engine record exceeded the 1 MiB input limit."}'
        : buffered.replace(/\r$/, "");
      buffered = "";
      discard = false;
      start = index + 1;
    }
    append(text.slice(start));
  }
  append(decoder.end());
  if (discard) yield '{"msg":"Engine record exceeded the 1 MiB input limit."}';
  else if (buffered) yield buffered;
}
