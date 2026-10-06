import net from 'node:net';
import { EventEmitter } from 'node:events';
import { validateRequest } from "./schema.js";
/** Herdr's Windows interprocess ToNsName prepends the local NPFS namespace. */
export function herdrTransportPath(endpoint, platform = process.platform) {
    return platform === 'win32' && !/^\\\\[^\\]+\\pipe\\/i.test(endpoint) ? '\\\\.\\pipe\\' + endpoint : endpoint;
}
export class RpcError extends Error {
    code;
    constructor(code, message) { super(message); this.name = 'RpcError'; this.code = code; }
}
/** Herdr ordinary API connections accept one request. Subscriptions own separate streams. */
export class HerdrClient extends EventEmitter {
    endpoint;
    options;
    stopped = false;
    counter = 0;
    version = 0;
    active;
    connections = new Set();
    constructor(endpoint, options = {}) { super(); if (!endpoint)
        throw new Error('HERDR_SOCKET_PATH is required'); this.endpoint = endpoint; this.options = options; }
    async connect() { await this.call('ping'); }
    async call(method, params = {}) {
        validateRequest(method, params);
        if (this.stopped)
            throw new Error('RPC client closed');
        const stream = method === 'events.subscribe';
        const version = stream ? ++this.version : 0;
        const id = `hat-${process.pid}-${++this.counter}`;
        return new Promise((resolve, reject) => {
            const socket = this.options.transportFactory?.() ?? net.createConnection(herdrTransportPath(this.endpoint));
            const connection = { socket, id, buffer: '', stream, version, settled: false, reject };
            this.connections.add(connection);
            socket.setEncoding('utf8');
            const fail = (error) => {
                if (!connection.settled) {
                    connection.settled = true;
                    clearTimeout(connection.timer);
                    reject(error);
                }
                socket.destroy();
            };
            connection.timer = setTimeout(() => fail(new RpcError('timeout', `${method} timed out; result may be unknown`)), this.options.timeoutMs ?? 5000);
            socket.once('connect', () => {
                if (this.stopped) {
                    fail(new Error('RPC client closed'));
                    return;
                }
                this.emit('connected');
                socket.write(JSON.stringify({ id, method, params }) + '\n', error => { if (error)
                    fail(error); });
            });
            socket.on('data', chunk => {
                connection.buffer += String(chunk);
                const limit = this.options.maxFrameBytes ?? 4 * 1024 * 1024;
                let index;
                while ((index = connection.buffer.indexOf('\n')) >= 0) {
                    const line = connection.buffer.slice(0, index);
                    connection.buffer = connection.buffer.slice(index + 1);
                    if (Buffer.byteLength(line) > limit) {
                        fail(new Error('RPC frame limit exceeded'));
                        return;
                    }
                    if (!line.trim())
                        continue;
                    let message;
                    try {
                        message = JSON.parse(line);
                    }
                    catch {
                        fail(new Error('Malformed RPC JSON'));
                        return;
                    }
                    if (!message || typeof message !== 'object') {
                        fail(new Error('Malformed RPC envelope'));
                        return;
                    }
                    if (typeof message.event === 'string') {
                        if (stream && !this.stopped && !socket.destroyed)
                            this.emit('event', message);
                        continue;
                    }
                    if (String(message.id) !== id)
                        continue;
                    if (message.error) {
                        fail(new RpcError(String(message.error.code ?? 'rpc_error'), String(message.error.message ?? message.error.code ?? 'RPC error')));
                        return;
                    }
                    if (connection.settled)
                        continue;
                    if (!('result' in message)) {
                        fail(new Error('RPC response has no result'));
                        return;
                    }
                    connection.settled = true;
                    clearTimeout(connection.timer);
                    if (stream && version === this.version && !this.stopped) {
                        const previous = this.active;
                        this.active = connection;
                        if (previous && previous !== connection)
                            previous.socket.destroy();
                    }
                    else
                        socket.destroy();
                    resolve(message.result);
                }
                if (Buffer.byteLength(connection.buffer) > limit)
                    fail(new Error('RPC frame limit exceeded'));
            });
            socket.on('error', error => { fail(error); if (!this.stopped)
                this.emit('diagnostic', error.message); });
            socket.once('end', () => { if (!connection.settled)
                fail(new Error('RPC connection closed before response'));
            else
                socket.destroy(); });
            socket.once('close', () => {
                clearTimeout(connection.timer);
                this.connections.delete(connection);
                if (!connection.settled) {
                    connection.settled = true;
                    reject(new Error('RPC connection closed'));
                }
                if (this.active === connection) {
                    this.active = undefined;
                    if (!this.stopped)
                        this.emit('disconnected');
                }
            });
        });
    }
    close() {
        if (this.stopped)
            return;
        this.stopped = true;
        this.version++;
        this.active = undefined;
        for (const connection of this.connections) {
            clearTimeout(connection.timer);
            if (!connection.settled) {
                connection.settled = true;
                connection.reject(new Error('RPC client closed'));
            }
            connection.socket.destroy();
        }
        this.connections.clear();
    }
}
