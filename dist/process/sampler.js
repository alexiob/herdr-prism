import { LinuxSampler } from "./linux.js";
import { NativeSampler } from "./native-helper.js";
export function createSampler(options = {}) { const platform = options.platform ?? process.platform; if (platform === 'linux')
    return new LinuxSampler(options); if (platform === 'darwin' || platform === 'macos' || platform === 'win32' || platform === 'windows')
    return new NativeSampler(options.helperPath, options.intervalMs, options.helperArgs); throw new Error(`Unsupported process platform: ${platform}`); }
