// app/equipment/scanners/setup/WebAdbClient.ts
// Wraps @yume-chan/adb with the operations the setup wizard needs.
// No React — pure TypeScript.

import { Adb, AdbDaemonTransport } from "@yume-chan/adb";
import { LinuxFileType } from "@yume-chan/adb";
import { AdbDaemonWebUsbDeviceManager } from "@yume-chan/adb-daemon-webusb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { ReadableStream } from "@yume-chan/stream-extra";
import { parseDeviceOwner, parseSignerDigest } from "@/lib/scanners/verify";

export const IET_PACKAGES = {
  tireTrack: "com.importexporttire.tiretrack",
  rtLocator: "com.rt_systems.rtlhandsfree",
  scannerAgent: "com.ietires.scanneragent",
};

// Packages that must survive lockdown because the scanner stops being usable without them.
// Deliberately a short, exact list rather than prefixes: the old prefix approach allowlisted
// "com.android." and "com.symbol."/"com.zebra." wholesale, which silently protected Chrome,
// the Play Store, Contacts, Phone and a pile of Zebra demo tools — every app that was still
// cluttering the home screen after a "locked down" setup.
export const LOCKDOWN_KEEP_EXACT = [
  // The apps the job actually needs
  "com.importexporttire.tiretrack",
  "com.rt_systems.rtlhandsfree",
  "com.ietires.scanneragent",
  // Scanning itself — disabling this breaks the barcode engine
  "com.symbol.datawedge",
  // Basic usability: launcher, settings, installer
  "com.android.launcher3",
  "com.android.settings",
  "com.google.android.packageinstaller",
  "com.android.packageinstaller",
  // Backs the system file picker that other apps open
  "com.android.documentsui",
  // Bluetooth pairing, needed for the RS507 ring scanner (a documented setup step)
  "com.symbol.btapp",
  "com.zebra.bluetooth",
  // Battery swap/health tools are genuinely used on the warehouse floor
  "com.symbol.batterymanager",
  "com.zebra.hotswap",
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
    // Delegates to the strict section-scoped parser (lib/scanners/verify.ts) instead of
    // its own loose regex. The old `Device Owner:[\s\S]*?<pkg>` spanned the whole dump,
    // so when a *different* admin held real ownership and our package only appeared later
    // as an enrolled "Enabled Device Admin," this returned a false `true` — the wizard then
    // skipped `dpm set-device-owner`, and step 12's strict check (which used the correct
    // parser all along) failed identically on every retry. One parser, one truth.
    return parseDeviceOwner(out, pkg);
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

  /**
   * Packages that own a launcher icon — i.e. exactly what a warehouse worker can see and tap
   * from the home screen. Lockdown targets these rather than every installed package, because
   * the complaint is home-screen clutter and because disabling non-launchable system services
   * is how you brick a device. Verified against a TC51 (Android 8.1): `cmd package
   * query-activities` exists there and returns `pkg/Activity` pairs.
   */
  async listLaunchablePackages(): Promise<string[]> {
    const out = await this.shell(
      "cmd package query-activities --brief -a android.intent.action.MAIN " +
        "-c android.intent.category.LAUNCHER 2>/dev/null",
    );
    const pkgs = new Set<string>();
    for (const m of out.matchAll(/^\s*([a-zA-Z0-9_.]+)\/[^\s]*/gm)) {
      if (m[1].includes(".")) pkgs.add(m[1]);
    }
    return [...pkgs];
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

  /** Installed versionName, or null when the package is absent. */
  async getPackageVersion(pkg: string): Promise<string | null> {
    const out = await this.shell(`dumpsys package ${pkg} | grep versionName`);
    const m = out.match(/versionName=(\S+)/);
    return m ? m[1].trim() : null;
  }

  /**
   * The signing certificate digest, used to catch a vendor-signed or otherwise foreign
   * pre-existing copy of an app — the failure that silently broke RT Locator on W08-004.
   * Parsing lives in the pure, tested `parseSignerDigest` (lib/scanners/verify.ts) so there
   * is exactly one definition of the device-output shapes.
   */
  async getPackageSignerDigest(pkg: string): Promise<string | null> {
    const out = await this.shell(`dumpsys package ${pkg}`);
    return parseSignerDigest(out);
  }

  /**
   * File contents, or null when the file does not exist. An existing but empty file
   * returns "" — deliberately distinct from null, because "never written" and "written
   * empty" are different failures and a verification report must not conflate them.
   */
  async readTextFile(devicePath: string): Promise<string | null> {
    const exists = (await this.shell(`[ -f '${devicePath}' ] && echo YES || echo NO`)).trim();
    if (!exists.startsWith("YES")) return null;
    return await this.shell(`cat '${devicePath}' 2>/dev/null`);
  }

  async getSystemSetting(key: string): Promise<string | null> {
    const out = (await this.shell(`settings get system ${key}`)).trim();
    return out === "null" || out === "" ? null : out;
  }

  async getSecureSetting(key: string): Promise<string | null> {
    const out = (await this.shell(`settings get secure ${key}`)).trim();
    return out === "null" || out === "" ? null : out;
  }

  async dumpDevicePolicy(): Promise<string> {
    return this.shell("dumpsys device_policy");
  }

  getConnection(): AdbConnection | null {
    return this.connection;
  }

  /**
   * Read-only: the current mode of an appop for a package (e.g. "allow", "ignore", "deny",
   * "default"), or null when the output can't be parsed. `appops get <pkg> <op>` is readable
   * over ADB, which is what makes a real readback — rather than a string-sniffing heuristic
   * on the `set` command's output — possible for `grantWriteSettings` below.
   */
  async getAppOpMode(pkg: string, op: string): Promise<string | null> {
    const out = await this.shell(`appops get ${pkg} ${op} 2>&1`);
    // Observed shapes across Android versions: "WRITE_SETTINGS: allow" and
    // "Uid mode: allow; User mode: allow" (last token on the line wins in both).
    const m = out.match(/:\s*(\w+)\s*;?\s*$/m);
    return m ? m[1].toLowerCase() : null;
  }

  /**
   * Grant the WRITE_SETTINGS appop so the agent can change SYSTEM settings (screen timeout,
   * rotation) on its own from now on. This is an appop, not a runtime permission, so
   * dpm.setPermissionGrantState cannot do it and `pm grant` does not apply — it must be set
   * over ADB, once, here. Without it every future settings change needs USB again, and
   * silent failure here is invisible until someone notices settings aren't changing remotely.
   *
   * The previous check (`out.trim() && !/^\s*$/.test(out) && /Error|Exception|Unknown/i.test(out)`)
   * only caught three specific words in the `set` command's own output and never actually
   * confirmed the grant took. This reads the op back with `appops get` — the actual state —
   * and throws with the observed value if it isn't "allow".
   */
  async grantWriteSettings(pkg = "com.ietires.scanneragent"): Promise<void> {
    const out = await this.shell(`appops set ${pkg} WRITE_SETTINGS allow 2>&1`);
    if (/Error|Exception|Unknown/i.test(out)) {
      throw new Error(`appops WRITE_SETTINGS failed: ${out.trim()}`);
    }
    const mode = await this.getAppOpMode(pkg, "WRITE_SETTINGS");
    if (mode !== "allow") {
      throw new Error(
        `WRITE_SETTINGS grant did not take — appops get reports "${mode ?? "(unreadable)"}"`,
      );
    }
  }

  /**
   * Enable an accessibility service. `enabled_accessibility_services` is a SECURE setting
   * outside dpm.setSecureSetting's allowlist on API 27, so shell is the only way in — which
   * is why re-enabling a disabled service later needs USB. Appends to any existing value
   * rather than clobbering it, and is idempotent.
   */
  async enableAccessibilityService(component: string): Promise<void> {
    const current = (await this.shell("settings get secure enabled_accessibility_services")).trim();
    const existing = current === "null" || current === "" ? "" : current;
    if (existing.split(":").includes(component)) {
      await this.shell("settings put secure accessibility_enabled 1");
      return;
    }
    const next = existing ? `${existing}:${component}` : component;
    await this.shell(`settings put secure enabled_accessibility_services ${next}`);
    await this.shell("settings put secure accessibility_enabled 1");
  }
}
