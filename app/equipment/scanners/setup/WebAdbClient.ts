// app/equipment/scanners/setup/WebAdbClient.ts
// Wraps @yume-chan/adb with the operations the setup wizard needs.
// No React — pure TypeScript.

import { Adb, AdbDaemonTransport } from "@yume-chan/adb";
import { LinuxFileType } from "@yume-chan/adb";
import { AdbDaemonWebUsbDeviceManager } from "@yume-chan/adb-daemon-webusb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { ReadableStream } from "@yume-chan/stream-extra";

export const IET_PACKAGES = {
  tireTrack: "com.importexporttire.tiretrack",
  rtLocator: "com.rt_systems.rtlhandsfree",
  scannerAgent: "com.ietires.scanneragent",
};

// System packages that must NEVER be disabled (device stays usable). Prefixes + exact ids.
// Disabling launcher/SystemUI/IME/Settings/DataWedge can brick usability — keep these.
export const ESSENTIAL_SYSTEM_PREFIXES = [
  "com.android.", "android", "com.qualcomm.", "com.zebra.", "com.symbol.",
  "com.google.android.packageinstaller", "com.android.systemui",
  "com.android.settings", "com.android.inputmethod", "com.google.android.inputmethod",
];
export const ESSENTIAL_SYSTEM_EXACT = [
  "com.symbol.datawedge", "com.android.launcher3", "com.android.settings",
  "com.android.systemui", "com.android.shell", "com.android.providers.settings",
];

let credentialStore: AdbWebCredentialStore | null = null;

function getCredentialStore() {
  if (!credentialStore) {
    credentialStore = new AdbWebCredentialStore("IECentral-Scanner-Setup");
  }
  return credentialStore;
}

export type AdbConnection = {
  adb: Adb;
  serial: string;
  model: string;
  androidVersion: string;
  disconnect: () => Promise<void>;
};

export class WebAdbClient {
  private connection: AdbConnection | null = null;

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && "usb" in navigator;
  }

  async connect(): Promise<AdbConnection> {
    if (!WebAdbClient.isSupported()) {
      throw new Error(
        "WebUSB not supported in this browser. Use Chrome or Edge.",
      );
    }
    const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
    if (!manager) throw new Error("Could not initialize WebUSB device manager.");

    // No vendorId filter: in ADB mode the TC51 (and most Android devices)
    // enumerate under Google's ADB composite vendor ID (0x18D1), not the
    // Symbol/Zebra ID (0x05E0). Passing no filter lets the library apply its
    // vendor-agnostic ADB interface filter (classCode 0xFF / subclass 0x42 /
    // protocol 1), which matches any device exposing an ADB interface.
    const device = await manager.requestDevice();
    if (!device) throw new Error("No device selected.");

    const connection = await device.connect();
    const transport = await AdbDaemonTransport.authenticate({
      serial: device.serial,
      connection,
      credentialStore: getCredentialStore(),
    });
    const adb = new Adb(transport);

    // Use the built-in getProp helper for device properties
    const model = (await adb.getProp("ro.product.model")).trim();
    const androidVersion = (await adb.getProp("ro.build.version.release")).trim();
    const realSerial = (await adb.getProp("ro.serialno")).trim();

    this.connection = {
      adb,
      serial: realSerial || device.serial,
      model,
      androidVersion,
      disconnect: async () => {
        await adb.close();
        this.connection = null;
      },
    };
    return this.connection;
  }

  /**
   * Release the active device: closes the ADB transport, which drops Chrome's
   * WebUSB interface claim. Idempotent and safe to call when already idle.
   * Must be called whenever the wizard closes/errors, or the device stays
   * claimed and the next attempt fails with "device in use by another program".
   */
  async disconnect(): Promise<void> {
    const conn = this.connection;
    this.connection = null;
    if (conn) {
      try {
        await conn.adb.close();
      } catch {
        /* already closed / device unplugged */
      }
    }
  }

  private async shellCommand(adb: Adb, cmd: string): Promise<string> {
    // Prefer shell protocol (multiplexed stdout/stderr + exit code) when available;
    // fall back to none protocol (merged output stream) for older Android builds.
    if (adb.subprocess.shellProtocol?.isSupported) {
      const result = await adb.subprocess.shellProtocol.spawnWaitText(cmd);
      return result.stdout;
    }
    return adb.subprocess.noneProtocol.spawnWaitText(cmd);
  }

  async shell(cmd: string): Promise<string> {
    if (!this.connection) throw new Error("Not connected");
    return this.shellCommand(this.connection.adb, cmd);
  }

  async pushTextFile(content: string, devicePath: string): Promise<void> {
    if (!this.connection) throw new Error("Not connected");
    const sync = await this.connection.adb.sync();
    try {
      const bytes = new TextEncoder().encode(content);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
      await sync.write({
        filename: devicePath,
        file: stream,
        type: LinuxFileType.File,
        permission: 0o644,
      });
    } finally {
      await sync.dispose();
    }
  }

  async installApk(
    apkBuffer: ArrayBuffer,
    onProgress?: (pct: number) => void,
  ): Promise<void> {
    if (!this.connection) throw new Error("Not connected");
    const remotePath = `/data/local/tmp/setup-wizard-${Date.now()}.apk`;
    const sync = await this.connection.adb.sync();
    try {
      const bytes = new Uint8Array(apkBuffer);
      const total = bytes.byteLength;
      let pushed = 0;
      const CHUNK = 256 * 1024;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < bytes.byteLength; i += CHUNK) {
            const slice = bytes.slice(i, Math.min(i + CHUNK, bytes.byteLength));
            controller.enqueue(slice);
            pushed += slice.byteLength;
            onProgress?.(Math.round((pushed / total) * 100));
          }
          controller.close();
        },
      });
      await sync.write({
        filename: remotePath,
        file: stream,
        type: LinuxFileType.File,
        permission: 0o644,
      });
    } finally {
      await sync.dispose();
    }
    // Redirect stderr→stdout: pm/cmd writes "Failure [INSTALL_FAILED_...]" to stderr on
    // Android 8.1, but shellProtocol only returns stdout. Without this the error message
    // is blank AND InstallStep's INSTALL_FAILED_UPDATE_INCOMPATIBLE auto-retry can't match.
    const result = await this.shell(`pm install -r ${remotePath} 2>&1`);
    await this.shell(`rm -f ${remotePath}`);
    if (!/Success/.test(result)) {
      throw new Error(`Install failed: ${result.trim() || "pm install produced no output"}`);
    }
  }

  async uninstall(pkg: string): Promise<void> {
    if (!this.connection) throw new Error("Not connected");
    await this.shell(`pm uninstall ${pkg}`);
  }

  async setActiveAdmin(component: string): Promise<void> {
    const out = await this.shell(`dpm set-active-admin ${component}`);
    if (!/Success/.test(out) && !/already/.test(out)) {
      throw new Error(`Device Admin activation failed: ${out.trim()}`);
    }
  }

  async listAccounts(): Promise<string[]> {
    const out = await this.shell("dumpsys account");
    return [...out.matchAll(/Account \{name=([^,]+), type=([^}]+)\}/g)].map((m) => `${m[1]} (${m[2]})`);
  }

  async isDeviceOwner(pkg = "com.ietires.scanneragent"): Promise<boolean> {
    const out = await this.shell("dumpsys device_policy");
    return new RegExp(`Device Owner:[\\s\\S]*?${pkg.replace(/\./g, "\\.")}`).test(out);
  }

  async setDeviceOwner(component = "com.ietires.scanneragent/.DeviceAdminReceiver"): Promise<void> {
    const out = await this.shell(`dpm set-device-owner ${component} 2>&1`);
    if (!/Success/.test(out)) throw new Error(`set-device-owner failed: ${out.trim()}`);
  }

  async openAccountsSettings(): Promise<void> {
    await this.shell("am start -a android.settings.SYNC_SETTINGS");
  }

  async disablePackages(packages: string[]): Promise<number> {
    let disabled = 0;
    for (const pkg of packages) {
      try {
        const out = await this.shell(`pm disable-user --user 0 ${pkg}`);
        if (/disabled|new state: disabled/.test(out)) disabled++;
      } catch {
        /* package may not exist on this device — skip silently */
      }
    }
    return disabled;
  }

  async launchActivity(component: string): Promise<void> {
    await this.shell(`am start -n ${component}`);
  }

  async grantPermission(pkg: string, permission: string): Promise<void> {
    await this.shell(`pm grant ${pkg} ${permission}`);
  }

  async listPackages(): Promise<string[]> {
    const out = await this.shell("pm list packages");
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith("package:"))
      .map((l) => l.slice("package:".length).trim())
      .filter(Boolean);
  }

  // Enable DataWedge Keystroke Output with a Tab key after each scanned barcode.
  // Uses the DataWedge intent API on the active/default profile.
  async configureDataWedgeTab(): Promise<void> {
    await this.shell(
      `am broadcast -a com.symbol.datawedge.api.ACTION --es com.symbol.datawedge.api.SET_CONFIG ` +
      `'{"PROFILE_NAME":"Profile0 (default)","PROFILE_ENABLED":"true","CONFIG_MODE":"UPDATE",` +
      `"PLUGIN_CONFIG":{"PLUGIN_NAME":"KEYSTROKE","RESET_CONFIG":"true",` +
      `"PARAM_LIST":{"keystroke_output_enabled":"true","keystroke_action_char_set":"1",` +
      `"keystroke_key_event_send_mode":"1","keystroke_send_tab":"true"}}}'`
    );
  }

  getConnection(): AdbConnection | null {
    return this.connection;
  }
}
