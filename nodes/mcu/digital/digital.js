/*
 * Copyright (c) 2022-2023  Moddable Tech, Inc.
 *
 *   This file is part of the Moddable SDK Runtime.
 *
 *   The Moddable SDK Runtime is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU Lesser General Public License as published by
 *   the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *
 *   The Moddable SDK Runtime is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU Lesser General Public License for more details.
 *
 *   You should have received a copy of the GNU Lesser General Public License
 *   along with the Moddable SDK Runtime.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

import {Node} from "nodered";
import Timer from "timer";

let cache;		// support multiple nodes sharing the same pin, like the RPi implementation

class DigitalInNode extends Node {
	#timer;
	#stableCount = 0;
	#stableValue = -1;
	#currentState = -1;

	onStart(config) {
		super.onStart(config);

		const Digital = globalThis.device?.io?.Digital;
		if (!Digital)
			return void this.status({fill: "red", shape: "dot", text: "node-red:common.status.error"});

		const interval = (config.debounceInterval > 0) ? config.debounceInterval : 10;
		const count    = (config.debounceCount    > 0) ? config.debounceCount    :  5;
		Object.defineProperty(this, "debounceInterval", {value: interval});
		Object.defineProperty(this, "debounceCount",    {value: count});

		if (config.invert) {
			Object.defineProperty(this, "invert", {value: 1});
		}
		const edgeMask = parseInt(config.edge) || 3;
		Object.defineProperty(this, "edgeMask", {value: edgeMask});

		cache ??= new Map;
		let io = cache.get(config.pin);
		if (io) {
			if (io.mode !== config.mode)
				return void this.status({fill: "red", shape: "dot", text: "mismatch"});
			io.readers.push(this);
		}
		else {
			io = new Digital({
				pin: config.pin,
				mode: Digital[config.mode],
				edge: Digital.Rising + Digital.Falling,
				onReadable() {
					this.readers.forEach(reader => reader.#startPolling(this));
				}
			});
			io.mode = config.mode;
			io.pin = config.pin;
			io.readers = [this];
			cache.set(config.pin, io);
		}

		if (config.initial) {
			const payload = io.read() ^ (this.invert ?? 0);
			this.send({
				payload,
				topic: "gpio/" + config.pin
			});
			this.status({fill: "green", shape: "dot", text: payload.toString()});
		}
	}

	#startPolling(io) {
		if (this.#timer !== undefined) {
			Timer.clear(this.#timer);
			this.#timer = undefined;
		}
		this.#stableCount = 0;
		this.#stableValue = -1;

		this.#timer = Timer.repeat(() => {
			const sample = io.read() ^ (this.invert ?? 0);
			this.status({fill: "yellow", shape: "dot", text: ""});
			
			if (sample === this.#stableValue) {
				this.#stableCount++;
			}
			else {
				this.#stableCount = 1;
				this.#stableValue = sample;
			}

			if (this.#stableCount >= this.debounceCount) {
				Timer.clear(this.#timer);
				this.#timer = undefined;
				this.#stableCount = 0;
				this.#stableValue = -1;

				const prev = this.#currentState;
				const rising  = (prev !== 1 && sample === 1);
				const falling = (prev !== 0 && sample === 0);
				this.#currentState = sample;

				this.status({fill: "green", shape: "dot", text: sample.toString()});
				if ((rising && (this.edgeMask & 1)) || (falling && (this.edgeMask & 2))) {
					const msg = {payload: sample, topic: "gpio/" + io.pin};
					this.send(msg);
				}
			}
		}, this.debounceInterval);
	}

	static type = "mcu_digital_in";
	static {
		RED.nodes.registerType(this.type, this);
	}
}

class DigitalOutNode extends Node {
	#io;

	onStart(config) {
		super.onStart(config);

		if (!globalThis.device?.io?.Digital)
			return;

		if (config.invert)
			Object.defineProperty(this, "invert", {value: 1});

		cache ??= new Map;
		let io = cache.get(config.pin);

		if (io) {
			if (io.mode !== config.mode)
				return void this.status({fill: "red", shape: "dot", text: "mismatch"});
			this.#io = io;
		}
		else {
			try {
				this.#io = io = new device.io.Digital({
					pin: config.pin,
					mode: device.io.Digital[config.mode]
				});

				if (undefined !== config.initial) {
					if (0 == config.initial)
						io.write(0 ^ (this.invert ?? 0));
					else if (1 == config.initial)
						io.write(1 ^ (this.invert ?? 0));
				}
				io.mode = config.mode;
				cache.set(config.pin, io);
			}
			catch {
				this.status({fill: "red", shape: "dot", text: "node-red:common.status.error"});
			}
		}
	}
	onMessage(msg, done) {
		if (this.#io) {
			const value = msg.payload ^ (this.invert ?? 0);
			this.#io.write(value);
			this.status({fill:"green", shape:"dot", text: value.toString()});
		}
		done();
	}

	static type = "mcu_digital_out";
	static {
		RED.nodes.registerType(this.type, this);
	}
}
