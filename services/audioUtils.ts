
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
 * Wraps raw PCM data with a valid WAV header so the browser can decode it natively.
 */
function createWavHeader(dataLength: number, sampleRate: number, numChannels: number, bitsPerSample: number): Uint8Array {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);

    const writeString = (view: DataView, offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    // RIFF identifier
    writeString(view, 0, 'RIFF');
    // file length (data + 36)
    view.setUint32(4, 36 + dataLength, true);
    // RIFF type
    writeString(view, 8, 'WAVE');
    // format chunk identifier
    writeString(view, 12, 'fmt ');
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (raw)
    view.setUint16(20, 1, true);
    // channel count
    view.setUint16(22, numChannels, true);
    // sample rate
    view.setUint32(24, sampleRate, true);
    // byte rate (sample rate * block align)
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    // block align (channel count * bytes per sample)
    view.setUint16(32, numChannels * (bitsPerSample / 8), true);
    // bits per sample
    view.setUint16(34, bitsPerSample, true);
    // data chunk identifier
    writeString(view, 36, 'data');
    // data chunk length
    view.setUint32(40, dataLength, true);

    return new Uint8Array(header);
}

export async function decodeAudioData(
  pcmData: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  // 1. Create a WAV header for the raw PCM data
  // Gemini returns 16-bit PCM.
  const header = createWavHeader(pcmData.length, sampleRate, numChannels, 16);

  // 2. Concatenate Header + Data to create a valid WAV "file" in memory
  const wavBytes = new Uint8Array(header.length + pcmData.length);
  wavBytes.set(header);
  wavBytes.set(pcmData, header.length);

  // 3. Use the Browser's Native Decoder
  // method to decode the audio. This bypasses all manual gain/normalization logic
  // and uses the browser's optimized internal codecs.
  // This ensures the volume is exactly as the source intended ("Original Sound").
  return await ctx.decodeAudioData(wavBytes.buffer);
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
        if (typeof reader.result === 'string') {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        } else {
            reject(new Error('Failed to convert blob to base64'));
        }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
