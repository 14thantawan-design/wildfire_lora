const { SerialPort } = require('serialport');
const { handlePacket, parsePacketLine, parseMetaFromLine } = require('./services/packetHandler');
const { markGatewayPacket } = require('./services/gatewayStatus');
const {
  acknowledgeCommand,
  listPendingCommands,
  markCommandSent,
  onCommand
} = require('./services/commandQueue');

class SerialBridge {
  constructor({ path, baudRate }) {
    this.path = path;
    this.baudRate = baudRate;
    this.port = null;
    this.buffer = '';
    this.pendingParsed = null;
    this.lineQueue = Promise.resolve();
    this.openedAt = null;
    this.closedAt = null;
    this.openError = null;
    this.lastLineAt = null;
    this.lastPacketAt = null;
    this.unsubscribeFromCommands = null;
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
      this.closedAt = new Date();
      console.warn('serial bridge closed');
    });

    this.port.open((error) => {
      if (error) {
        this.openError = error.message;
        console.error(`serial bridge failed to open ${this.path}: ${error.message}`);
        return;
      }

      this.openedAt = new Date();
      this.closedAt = null;
      this.openError = null;
      console.log(`serial bridge started: ${this.path} @ ${this.baudRate}`);
      listPendingCommands()
        .then((commands) => commands.forEach((command) => this.sendCommand(command)))
        .catch((pendingError) => console.error(`command restore error: ${pendingError.message}`));
    });

    this.unsubscribeFromCommands = onCommand((command) => this.sendCommand(command));
  }

  sendCommand(command) {
    if (!this.port || !this.port.isOpen) return false;

    const payload = JSON.stringify({
      t: 'cmd',
      id: command.node_id,
      cmd: command.command,
      cid: command.command_id
    });

    this.port.write(`CMD ${payload}\n`, (error) => {
      if (error) console.error(`serial command write error: ${error.message}`);
    });
    return true;
  }

  async saveParsed(parsed) {
    try {
      const result = await handlePacket(parsed.packet, parsed.meta);
      this.lastPacketAt = new Date();
      if (!result.ignored) {
        markGatewayPacket('serial');
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
    this.lastLineAt = new Date();
    const commandAck = String(line).trim().match(/^CMD_ACK\s+([A-Za-z0-9_-]+)$/);
    if (commandAck) {
      await acknowledgeCommand(commandAck[1]);
      return;
    }

    const commandSent = String(line).trim().match(/^CMD_SENT\s+([A-Za-z0-9_-]+)$/);
    if (commandSent) {
      await markCommandSent(commandSent[1]);
      return;
    }

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
    if (this.unsubscribeFromCommands) this.unsubscribeFromCommands();
  }

  status() {
    return {
      enabled: Boolean(this.path),
      path: this.path,
      baud_rate: this.baudRate,
      is_open: Boolean(this.port && this.port.isOpen),
      open_error: this.openError,
      opened_at: this.openedAt,
      closed_at: this.closedAt,
      last_line_at: this.lastLineAt,
      last_packet_at: this.lastPacketAt
    };
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
