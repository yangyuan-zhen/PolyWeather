"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSignal = resolveSignal;
const linuxSignalMapping = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGKILL: 9,
    SIGTERM: 15,
    SIGCONT: 18,
    SIGSTOP: 19,
};
function resolveSignal(signal) {
    if (typeof signal === "number") {
        return signal;
    }
    if (signal in linuxSignalMapping) {
        return linuxSignalMapping[signal];
    }
    throw new Error(`Unknown signal name: ${String(signal)}`);
}
//# sourceMappingURL=resolveSignal.js.map