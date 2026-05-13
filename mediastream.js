/* ---------------------------------------------------------------------------
** This software is in the public domain, furnished "as is", without technical
** support, and with no warranty, express or implied, as to its usefulness for
** any purpose.
**
** -------------------------------------------------------------------------*/

import { VideoProcessor } from './videoprocessor.js';
import { AudioProcessor } from './audioprocessor.js';

export class MediaStream {
    reconnectTimer = null;
    ws = null;
    wt = null;
    metadata = {media:'', codec: '', freq: 0, channels: 0, ts: 0, type: ''};

    constructor(videoCanvas, audioContext, onvideoloadedcallback, onaudioloadedcallback) {
        this.videoProcessor = new VideoProcessor(videoCanvas, onvideoloadedcallback);
        if (audioContext) {
            this.audioProcessor = new AudioProcessor(audioContext, onaudioloadedcallback);
        }
    }

    async onMessage(message) {
        const { data } = message;
        try {
            if (data instanceof ArrayBuffer) {
                const bytes = new Uint8Array(data);
                if (this.metadata.media === 'video') {
                    await this.videoProcessor.onVideoFrame(this.metadata, bytes);
                } else if (this.metadata.media === 'audio') {
                    await this.audioProcessor?.onAudioFrame(this.metadata, bytes);
                }
            } else if (typeof data === 'string') {
                this.metadata = JSON.parse(data);
            }
        } catch (e) {
            console.warn(e);
        }
    }

    setVolume(volume) {
        this.audioProcessor?.setVolume(volume);
    }

    // ------------------------------------------------------------------ WebSocket
    connect(stream) {
        let wsurl = new URL(stream, location.href);
        wsurl.protocol = wsurl.protocol.replace("http", "ws");
        this.close();
        console.log(`Connecting WebSocket to ${wsurl}`);
        this.ws = new WebSocket(wsurl.href);
        this.ws.binaryType = 'arraybuffer';
        this.ws.onopen = () => clearTimeout(this.reconnectTimer);
        this.ws.onerror = () => console.log(`WebSocket error`);
        this.ws.onmessage = (message) => this.onMessage(message);
        this.ws.onclose = () => this.reconnectTimer = setTimeout(() => this.connect(stream), 1000);
    }

    // ------------------------------------------------------------------ WebTransport (QUIC)
    // Wire protocol (length-prefixed, little-endian uint32):
    //   [4B json_len][json_len B UTF-8 JSON][4B data_len][data_len B binary] ...
    // Returns true if the WebTransport connection was established, false if it
    // failed (so the caller can fall back to WebSocket).
    async connectWebTransport(stream, quicPort, certFingerprint) {
        this.close();
        const wtUrl = new URL(stream, location.href);
        wtUrl.protocol = 'https:';
        wtUrl.port = quicPort;
        console.log(`Connecting WebTransport to ${wtUrl}`);

        let wt;
        try {
            const wtOptions = {};
            if (certFingerprint) {
                const hashBytes = new Uint8Array(certFingerprint);
                wtOptions.serverCertificateHashes = [
                    { 
                        algorithm: 'sha-256', 
                        value: hashBytes.buffer 
                    }
                ];
                wtOptions.allowPooling = false; // Avoid sharing connections with other origins, since the cert is pinned.
            }
            wt = new WebTransport(wtUrl.href, wtOptions);
            this.wt = wt;
            await wt.ready;
        } catch (e) {
            console.warn(`WebTransport unavailable (${e}), using WebSocket`);
            this.wt = null;
            return false;
        }

        // Connection is live; reconnect via WebTransport on drop.
        const reconnect = () => {
            if (this.wt === wt) {
                this.reconnectTimer = setTimeout(() => this.connectWebTransport(stream, quicPort, certFingerprint), 1000);
            }
        };
        wt.closed.then(reconnect).catch(reconnect);

        // Read server-initiated unidirectional streams.
        const streamReader = wt.incomingUnidirectionalStreams.getReader();
        (async () => {
            try {
                while (true) {
                    const { value: uniStream, done } = await streamReader.read();
                    if (done) break;
                    this._readFrames(uniStream, wt).catch(e => console.warn('Frame read error:', e));
                }
            } catch (_) { /* connection closed */ }
        })();

        return true;
    }

    async _readFrames(uniStream, wt) {
        const reader = uniStream.getReader();
        let buf = new Uint8Array(0);

        const readBytes = async (n) => {
            while (buf.length < n) {
                const { value, done } = await reader.read();
                if (done) throw new Error('stream closed');
                const merged = new Uint8Array(buf.length + value.length);
                merged.set(buf);
                merged.set(value, buf.length);
                buf = merged;
            }
            const chunk = buf.slice(0, n);
            buf = buf.slice(n);
            return chunk;
        };

        const dv = new DataView(new ArrayBuffer(4));
        const readU32LE = async () => {
            const b = await readBytes(4);
            dv.setUint8(0, b[0]); dv.setUint8(1, b[1]);
            dv.setUint8(2, b[2]); dv.setUint8(3, b[3]);
            return dv.getUint32(0, true /* LE */);
        };

        while (this.wt === wt) {
            const jsonLen = await readU32LE();
            const jsonBytes = await readBytes(jsonLen);
            const jsonStr = new TextDecoder().decode(jsonBytes);
            await this.onMessage({ data: jsonStr });

            const dataLen = await readU32LE();
            const dataBytes = await readBytes(dataLen);
            await this.onMessage({ data: dataBytes.buffer });
        }
    }

    close() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.onclose = () => {};
            this.ws.onerror = () => {};
            this.ws.close();
            this.ws = null;
        }
        if (this.wt) {
            const wt = this.wt;
            this.wt = null;
            wt.close();
        }
        this.videoProcessor.close();
        this.audioProcessor?.close();
    }
}
