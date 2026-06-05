class CampusAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.offset = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (output?.[0]) {
      output[0].fill(0);
    }

    if (!input?.length || !input[0]?.length) {
      return true;
    }

    const frameCount = input[0].length;
    const channelCount = input.length;

    for (let frame = 0; frame < frameCount; frame += 1) {
      let sample = 0;

      for (let channel = 0; channel < channelCount; channel += 1) {
        sample += input[channel][frame] / channelCount;
      }

      this.buffer[this.offset] = sample;
      this.offset += 1;

      if (this.offset === this.buffer.length) {
        const chunk = this.buffer;
        this.port.postMessage(chunk, [chunk.buffer]);
        this.buffer = new Float32Array(4096);
        this.offset = 0;
      }
    }

    return true;
  }
}

registerProcessor("campus-audio-processor", CampusAudioProcessor);
