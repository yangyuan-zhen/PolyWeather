declare const linuxSignalMapping: {
    readonly SIGHUP: 1;
    readonly SIGINT: 2;
    readonly SIGQUIT: 3;
    readonly SIGKILL: 9;
    readonly SIGTERM: 15;
    readonly SIGCONT: 18;
    readonly SIGSTOP: 19;
};
type CommonLinuxSignals = keyof typeof linuxSignalMapping;
export type Signal = CommonLinuxSignals | number;
export declare function resolveSignal(signal: Signal): number;
export {};
