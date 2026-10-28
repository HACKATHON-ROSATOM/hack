import { createConnection, type Socket } from "node:net";

export type Iec104Observation = {
  ca: number;
  ioa: number;
  value: number;
  receivedAt: Date;
};

export type Iec104Options = {
  host: string;
  port: number;
  onConnection: (connected: boolean) => void;
  onObservation: (observation: Iec104Observation) => void;
};

const MODULUS = 32768;
const START = Buffer.from([0x68, 4, 0x07, 0, 0, 0]);
const TEST = Buffer.from([0x68, 4, 0x43, 0, 0, 0]);
const TEST_CONFIRM = Buffer.from([0x68, 4, 0x83, 0, 0, 0]);
const STOP_CONFIRM = Buffer.from([0x68, 4, 0x23, 0, 0, 0]);
const START_CONFIRM = Buffer.from([0x68, 4, 0x0b, 0, 0, 0]);

// Information element size, quality byte offset, and value encoding for monitoring ASDUs.
const types: Record<
  number,
  { size: number; quality: number; value: "single" | "double" | "normalized" | "scaled" | "float" }
> = {
  1: { size: 1, quality: 0, value: "single" },
  2: { size: 4, quality: 0, value: "single" },
  3: { size: 1, quality: 0, value: "double" },
  4: { size: 4, quality: 0, value: "double" },
  9: { size: 3, quality: 2, value: "normalized" },
  10: { size: 6, quality: 2, value: "normalized" },
  11: { size: 3, quality: 2, value: "scaled" },
  12: { size: 6, quality: 2, value: "scaled" },
  13: { size: 5, quality: 4, value: "float" },
  14: { size: 8, quality: 4, value: "float" },
  21: { size: 2, quality: -1, value: "normalized" },
  30: { size: 8, quality: 0, value: "single" },
  31: { size: 8, quality: 0, value: "double" },
  34: { size: 10, quality: 2, value: "normalized" },
  35: { size: 10, quality: 2, value: "scaled" },
  36: { size: 12, quality: 4, value: "float" },
};

export class Iec104Client {
  private readonly options: Iec104Options;
  private socket: Socket | null = null;
  private running = false;
  private active = false;
  private buffer = Buffer.alloc(0);
  private sendSequence = 0;
  private acknowledgedSequence = 0;
  private receiveSequence = 0;
  private pendingReceived = 0;
  private lastReceived = 0;
  private lastInterrogation = 0;
  private interrogationPending = false;
  private requestTime = 0;
  private startTime = 0;
  private testTime = 0;
  private ackTime = 0;
  private timer: NodeJS.Timeout | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;

  constructor(options: Iec104Options) {
    this.options = options;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    clearInterval(this.timer);
    this.timer = undefined;
    this.socket?.destroy();
    this.socket = null;
    this.setActive(false);
  }

  private setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.options.onConnection(active);
  }

  private connect(): void {
    if (!this.running) return;
    this.buffer = Buffer.alloc(0);
    this.sendSequence = 0;
    this.acknowledgedSequence = 0;
    this.receiveSequence = 0;
    this.pendingReceived = 0;
    this.interrogationPending = false;
    this.requestTime = 0;
    this.testTime = 0;
    this.ackTime = 0;
    this.startTime = Date.now();
    this.lastReceived = Date.now();
    const socket = createConnection({ host: this.options.host, port: this.options.port });
    this.socket = socket;
    socket.setNoDelay(true);
    socket.on("connect", () => {
      this.startTime = Date.now();
      socket.write(START);
    });
    socket.on("data", (chunk: Buffer) => {
      if (this.socket !== socket) return;
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (this.buffer.length >= 2) {
        const length = this.buffer[1]!;
        if (this.buffer[0] !== 0x68 || length < 4 || length > 253) {
          socket.destroy();
          return;
        }
        if (this.buffer.length < length + 2) return;
        const frame = this.buffer.subarray(0, length + 2);
        this.buffer = this.buffer.subarray(length + 2);
        if (!this.handleFrame(frame)) {
          socket.destroy();
          return;
        }
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      clearInterval(this.timer);
      this.timer = undefined;
      this.setActive(false);
      if (this.running)
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = undefined;
          this.connect();
        }, 3000);
    });
    this.timer = setInterval(() => this.tick(), 1000);
  }

  private tick(): void {
    const now = Date.now();
    if (!this.active) {
      if (now - this.startTime >= 15000) this.socket?.destroy();
      return;
    }
    if (
      (this.testTime && now - this.testTime >= 15000) ||
      (this.ackTime && now - this.ackTime >= 15000) ||
      (this.interrogationPending && now - this.requestTime >= 15000)
    ) {
      this.socket?.destroy();
      return;
    }
    if (this.pendingReceived) this.acknowledge();
    if (!this.interrogationPending && now - this.lastInterrogation >= 4000) this.interrogate();
    if (!this.testTime && now - this.lastReceived >= 20000) {
      this.socket?.write(TEST);
      this.testTime = now;
    }
  }

  private acknowledge(): void {
    const frame = Buffer.from([0x68, 4, 1, 0, 0, 0]);
    frame.writeUInt16LE(this.receiveSequence << 1, 4);
    this.socket?.write(frame);
    this.pendingReceived = 0;
  }

  private interrogate(): void {
    // C_IC_NA_1, activation, common address 1, station interrogation (QOI 20).
    const frame = Buffer.from([0x68, 14, 0, 0, 0, 0, 100, 1, 6, 0, 1, 0, 0, 0, 0, 20]);
    frame.writeUInt16LE(this.sendSequence << 1, 2);
    frame.writeUInt16LE(this.receiveSequence << 1, 4);
    this.socket?.write(frame);
    this.pendingReceived = 0;
    if (this.sendSequence === this.acknowledgedSequence) this.ackTime = Date.now();
    this.sendSequence = (this.sendSequence + 1) % MODULUS;
    this.interrogationPending = true;
    this.requestTime = Date.now();
    this.lastInterrogation = this.requestTime;
  }

  private acceptAcknowledgement(sequence: number): boolean {
    const outstanding = (this.sendSequence - this.acknowledgedSequence + MODULUS) % MODULUS;
    const acknowledged = (sequence - this.acknowledgedSequence + MODULUS) % MODULUS;
    if (acknowledged > outstanding) return false;
    if (acknowledged) {
      this.acknowledgedSequence = sequence;
      this.ackTime = sequence === this.sendSequence ? 0 : Date.now();
    }
    return true;
  }

  private handleFrame(frame: Buffer): boolean {
    this.lastReceived = Date.now();
    const control = frame[2]!;
    if ((control & 1) === 0) {
      if (!this.active || frame.length < 12 || (frame[4]! & 1) !== 0) return false;
      const send = frame.readUInt16LE(2) >> 1;
      const receive = frame.readUInt16LE(4) >> 1;
      if (send !== this.receiveSequence || !this.acceptAcknowledgement(receive)) return false;
      this.receiveSequence = (this.receiveSequence + 1) % MODULUS;
      this.pendingReceived++;
      if (this.pendingReceived >= 8) this.acknowledge();
      return this.handleAsdu(frame.subarray(6));
    }
    if ((control & 3) === 1) {
      return (
        frame.length === 6 &&
        control === 1 &&
        frame[3] === 0 &&
        (frame[4]! & 1) === 0 &&
        this.acceptAcknowledgement(frame.readUInt16LE(4) >> 1)
      );
    }
    if (frame.length !== 6 || frame[3] !== 0 || frame[4] !== 0 || frame[5] !== 0) return false;
    switch (control) {
      case 0x0b:
        if (!this.active) {
          this.setActive(true);
          this.interrogate();
        }
        return true;
      case 0x07:
        this.socket?.write(START_CONFIRM);
        return true;
      case 0x13:
        this.socket?.write(STOP_CONFIRM);
        return false;
      case 0x43:
        this.socket?.write(TEST_CONFIRM);
        return true;
      case 0x83:
        this.testTime = 0;
        return true;
      default:
        return false;
    }
  }

  private handleAsdu(asdu: Buffer): boolean {
    if (asdu.length < 6) return false;
    const type = asdu[0]!;
    const count = asdu[1]! & 0x7f;
    const sequence = (asdu[1]! & 0x80) !== 0;
    const cause = asdu[2]! & 0x3f;
    const ca = asdu.readUInt16LE(4);
    if (type === 100 && ca === 1 && (cause === 10 || (asdu[2]! & 0x40) !== 0)) {
      this.interrogationPending = false;
    }
    const descriptor = types[type];
    if (!descriptor || (asdu[2]! & 0xc0) !== 0) return true;
    if (!count) return false;
    const expected = 6 + (sequence ? 3 + count * descriptor.size : count * (3 + descriptor.size));
    if (asdu.length !== expected) return false;
    let offset = 6;
    let base = 0;
    const receivedAt = new Date();
    for (let i = 0; i < count; i++) {
      if (!sequence || i === 0) {
        base = asdu.readUIntLE(offset, 3);
        offset += 3;
      }
      const ioa = sequence ? base + i : base;
      const quality = descriptor.quality < 0 ? 0 : asdu[offset + descriptor.quality]!;
      let value: number;
      switch (descriptor.value) {
        case "single":
          value = asdu[offset]! & 1;
          break;
        case "double":
          value = asdu[offset]! & 3;
          break;
        case "normalized":
          value = asdu.readInt16LE(offset) / 32768;
          break;
        case "scaled":
          value = asdu.readInt16LE(offset);
          break;
        case "float":
          value = asdu.readFloatLE(offset);
          break;
      }
      if ((quality & 0x80) === 0 && Number.isFinite(value)) {
        this.options.onObservation({ ca, ioa, value, receivedAt });
      }
      offset += descriptor.size;
    }
    return true;
  }
}
