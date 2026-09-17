const HEX = /^[0-9a-f]*$/;

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !HEX.test(hex)) throw new Error(`not hex: ${hex.slice(0, 16)}`);
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export const utf8 = {
  encode: (text: string): Uint8Array => new TextEncoder().encode(text),
  decode: (bytes: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
};
