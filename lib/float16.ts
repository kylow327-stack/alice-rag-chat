import { readFileSync, writeFileSync } from "node:fs";

const floatView = new Float32Array(1);
const intView = new Int32Array(floatView.buffer);

/**
 * IEEE binary16, rounded to nearest even. Node 22 in this environment has no
 * DataView float16 helpers, so the index files stay portable without them.
 */
export function floatToHalf(value: number): number {
  floatView[0] = value;
  const x = intView[0] ?? 0;
  let bits = (x >> 16) & 0x8000;
  const mantissa = (x >> 12) & 0x07ff;
  const exponent = (x >> 23) & 0xff;

  if (exponent < 103) return bits;
  if (exponent > 142) {
    bits |= 0x7c00;
    bits |= ((exponent === 255 ? 0 : 1) && x & 0x007fffff) as number;
    return bits;
  }
  if (exponent < 113) {
    const m = mantissa | 0x0800;
    bits |= (m >> (114 - exponent)) + ((m >> (113 - exponent)) & 1);
    return bits;
  }
  bits |= ((exponent - 112) << 10) | (mantissa >> 1);
  bits += mantissa & 1;
  return bits & 0xffff;
}

export function halfToFloat(half: number): number {
  const sign = (half & 0x8000) >> 15;
  const exponent = (half >> 10) & 0x1f;
  const mantissa = half & 0x3ff;
  if (exponent === 0) {
    if (mantissa === 0) return sign ? -0 : 0;
    return (sign ? -1 : 1) * Math.pow(2, -14) * (mantissa / 1024);
  }
  if (exponent === 31) {
    return mantissa ? Number.NaN : sign ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }
  const value = Math.pow(2, exponent - 15) * (1 + mantissa / 1024);
  return sign ? -value : value;
}

export function readFloat16(file: string): Float32Array {
  const buf = readFileSync(file);
  if (buf.byteLength % 2 !== 0) {
    throw new Error(`${file} has an odd byte length`);
  }
  const count = buf.byteLength / 2;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = halfToFloat(buf.readUInt16LE(i * 2));
  }
  return out;
}

export function writeFloat16(file: string, values: Float32Array): void {
  const buf = Buffer.allocUnsafe(values.length * 2);
  for (let i = 0; i < values.length; i += 1) {
    buf.writeUInt16LE(floatToHalf(values[i] ?? 0), i * 2);
  }
  writeFileSync(file, buf);
}
