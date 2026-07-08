const { SerialPort } = require('serialport');
const { handlePacket, parsePacketLine, parseMetaFromLine } = require('./services/packetHandler');

class SerialBridge {
  constructor({ path, baudRate }) {
    this.path = path;
    this.baudRate = baudRate;
    this.port = null;
    this.buffer = '';
    this.pendingParsed = null;
    this.lineQueue = Promise.resolve();
  }

  start() {
    if (!this.path) {
      console.log('serial disabled: SERIAL_PORT is not set');
      return;
    }

    this.port = new SerialPort({
      path: this.path,
      baudRate: this.baudRate,
      autoOpen: false
    });

    this.port.on('data', (chunk) => this.handleData(chunk));
    this.port.on('error', (error) => {
      console.error(`serial error: ${error.message}`);
    });
    this.port.on('close', () => {
      console.warn('serial bridge closed');
    });

    this.port.open((error) => {
      if (error) {
        console.error(`serial bridge failed to open ${this.path}: ${error.message}`);
        return;
      }

      console.log(`serial bridge started: ${this.path} @ ${this.baudRate}`);
    });
  }

  async saveParsed(parsed) {
    try {
      const result = await handlePacket(parsed.packet, parsed.meta);
      if (!result.ignored) {
        console.log(`packet saved: type=${result.type} node=${result.node_id}`);
      }
    } catch (error) {
      console.error(`packet handling error: ${error.message}`);
    }
  }

  async flushPending() {
    if (!this.pendingParsed) return;
    const parsed = this.pendingParsed;
    this.pendingParsed = null;
    await this.saveParsed(parsed);
  }

  async handleLine(line) {
    const parsed = parsePacketLine(line);
    if (parsed) {
      await this.flushPending();

      if (String(line).includes('payload=')) {
        this.pendingParsed = parsed;
      } else {
        await this.saveParsed(parsed);
      }
      return;
    }

    if (this.pendingParsed) {
      const meta = parseMetaFromLine(line);
      this.pendingParsed.meta = {
        ...this.pendingParsed.meta,
        ...meta
      };

      if (/^=+$/.test(String(line).trim())) {
        await this.flushPending();
      }
    }
  }

  handleData(chunk) {
    this.buffer += chunk.toString('utf8');

    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      this.lineQueue = this.lineQueue.then(() => this.handleLine(line)).catch((error) => {
        console.error(`serial line error: ${error.message}`);
      });
    }
  }

  close() {
    this.flushPending().catch((error) => {
      console.error(`serial flush error: ${error.message}`);
    });

    if (this.port && this.port.isOpen) {
      this.port.close();
    }
  }
}

function createSerialBridge() {
  const path = process.env.SERIAL_PORT;
  const baudRate = Number(process.env.SERIAL_BAUD || 115200);
  return new SerialBridge({ path, baudRate });
}

module.exports = {
  SerialBridge,
  createSerialBridge
};
