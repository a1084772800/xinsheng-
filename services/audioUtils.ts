
export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Manually decodes raw PCM 16-bit data to an AudioBuffer.
 * Uses standard linear mapping. Volume boosting is handled by the AudioContext graph (Compressor+Gain)
 * to avoid fluctuating volume levels between clips caused by normalization.
 */
export async function decodeAudioData(
  pcmData: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  const alignedBuffer = pcmData.buffer.slice(pcmData.byteOffset, pcmData.byteOffset + pcmData.byteLength);
  const int16Data = new Int16Array(alignedBuffer);
  
  const frameCount = int16Data.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Standard conversion: Int16 (-32768 to 32767) -> Float32 (-1.0 to 1.0)
      channelData[i] = int16Data[i * numChannels + channel] / 32768.0;
    }
  }

  return buffer;
}
