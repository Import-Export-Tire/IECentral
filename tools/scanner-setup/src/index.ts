#!/usr/bin/env ts-node

import chalk from "chalk";
import inquirer from "inquirer";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as adb from "./adb";
import * as api from "./api";
import { buildRtConfig } from "../../../lib/scanners/rtConfig";

const LOCATIONS: Record<string, { name: string; code: string }> = {
  "1": { name: "Latrobe", code: "W08" },
  "2": { name: "Everson", code: "R10" },
  "3": { name: "Chestnut", code: "W09" },
};

async function main() {
  console.log("");
  console.log(chalk.bold("========================================"));
  console.log(chalk.bold("  IE Tires — Scanner Setup Tool"));
  console.log(chalk.bold("========================================"));
  console.log("");

  // Check ADB
  if (!adb.checkAdb()) {
    console.log(chalk.red("ADB not found. Install: brew install android-platform-tools"));
    process.exit(1);
  }
  console.log(chalk.green("✓ ADB found"));

  // Get location from args or prompt
  let locationCode = process.argv.find((a) => a.startsWith("--location="))?.split("=")[1];
  let locationName: string;

  if (!locationCode) {
    const { choice } = await inquirer.prompt([
      {
        type: "list",
        name: "choice",
        message: "Select location:",
        choices: [
          { name: "Latrobe (W08)", value: "1" },
          { name: "Everson (R10)", value: "2" },
          { name: "Chestnut (W09)", value: "3" },
        ],
      },
    ]);
    locationCode = LOCATIONS[choice].code;
    locationName = LOCATIONS[choice].name;
  } else {
    locationName = Object.values(LOCATIONS).find((l) => l.code === locationCode)?.name ?? locationCode;
  }

  console.log(chalk.green(`✓ Location: ${locationName} (${locationCode})`));

  // Fetch setup config from API
  console.log("");
  console.log("Fetching setup configuration...");
  let config: api.SetupConfig;
  try {
    config = await api.getSetupConfig(locationCode);
    console.log(chalk.green("✓ Config loaded"));
  } catch (err) {
    console.log(chalk.yellow("⚠ Could not fetch config from API, using defaults"));
    config = {
      locationCode,
      rtLocatorUrl: "",
      defaultDeviceIdPrefix: `${locationCode}-`,
      screenTimeoutMs: 1800000,
      screenRotation: "portrait",
      bloatwarePackages: [],
      tireTrackApkSource: "s3",
    };
  }

  // Watch for device
  const { mode } = await inquirer.prompt([
    {
      type: "list",
      name: "mode",
      message: "What do you want to do?",
      choices: [
        { name: "Watch for device (auto-detect USB)", value: "watch" },
        { name: "Connect to already-plugged device", value: "connect" },
      ],
    },
  ]);

  if (mode === "watch") {
    console.log("");
    console.log("Watching for USB devices... (plug in a scanner)");
    await watchForDevice(config, locationCode, locationName);
  } else {
    adb.restartAdbServer();
    await new Promise((r) => setTimeout(r, 2000));
    const devices = adb.listDevices().filter((d) => d.state === "device");
    if (devices.length === 0) {
      console.log(chalk.red("No device found. Check USB connection."));
      process.exit(1);
    }
    await setupDevice(devices[0].serial, config, locationCode, locationName);
  }
}

async function watchForDevice(
  config: api.SetupConfig,
  locationCode: string,
  locationName: string
) {
  const seen = new Set<string>();
  const check = async () => {
    const devices = adb.listDevices().filter((d) => d.state === "device");
    for (const device of devices) {
      if (!seen.has(device.serial)) {
        seen.add(device.serial);
        console.log(chalk.cyan(`\n→ Device detected: ${device.serial}`));
        await setupDevice(device.serial, config, locationCode, locationName);
        console.log(chalk.cyan("\nWatching for next device..."));
      }
    }
  };

  // Poll every 2 seconds
  setInterval(check, 2000);
  await check();
}

async function setupDevice(
  adbSerial: string,
  config: api.SetupConfig,
  locationCode: string,
  locationName: string
) {
  // Get device info
  const serialNumber = adb.getDeviceSerial(adbSerial);
  const model = adb.getDeviceModel(adbSerial);
  const androidVersion = adb.getAndroidVersion(adbSerial);

  console.log(chalk.green(`✓ Serial: ${serialNumber}`));
  console.log(chalk.green(`✓ Model: ${model}`));
  console.log(chalk.green(`✓ Android: ${androidVersion}`));

  // Check if scanner exists in database
  console.log("");
  console.log("Checking database...");
  let existingScanner: api.ScannerLookupResult | null = null;
  try {
    existingScanner = await api.lookupScanner(serialNumber);
  } catch {
    console.log(chalk.yellow("⚠ Could not check database"));
  }

  if (existingScanner?.found && existingScanner.scanner) {
    const s = existingScanner.scanner;
    console.log(chalk.cyan(`Found: Scanner #${s.number} at ${s.locationName}`));
    console.log(chalk.cyan(`  Status: ${s.status} | MDM: ${s.mdmStatus ?? "none"} | Online: ${s.isOnline}`));

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "This scanner is already registered. What do you want to do?",
        choices: [
          { name: "Update (push latest APKs + config)", value: "update" },
          { name: "Re-provision (full IoT re-provisioning)", value: "reprovision" },
          { name: "Skip this scanner", value: "skip" },
        ],
      },
    ]);

    if (action === "skip") return;
    if (action === "update") {
      await updateExistingScanner(adbSerial, config, locationCode);
      return;
    }
    // Fall through to full setup for re-provision
  }

  // Full new setup
  await fullSetup(adbSerial, serialNumber, model, androidVersion, config, locationCode, locationName);
}

async function updateExistingScanner(
  adbSerial: string,
  config: api.SetupConfig,
  locationCode: string
) {
  console.log(chalk.bold("\n--- Updating Scanner ---\n"));

  // Download and install latest APKs
  await downloadAndInstallApks(adbSerial, locationCode);

  // Push config
  await pushRtConfig(adbSerial, config);

  // Apply device settings
  applyDeviceSettings(adbSerial, config);

  console.log(chalk.green.bold("\n✓ Scanner updated!\n"));
}

async function fullSetup(
  adbSerial: string,
  serialNumber: string,
  model: string,
  androidVersion: string,
  config: api.SetupConfig,
  locationCode: string,
  locationName: string
) {
  console.log(chalk.bold("\n--- Full Scanner Setup ---\n"));

  // Generate scanner number
  let scannerNumber: string;
  try {
    scannerNumber = await api.getNextScannerNumber(locationCode);
    console.log(chalk.green(`✓ Scanner ID: ${scannerNumber}`));
  } catch {
    const { num } = await inquirer.prompt([
      { type: "input", name: "num", message: `Scanner number (e.g., ${locationCode}-001):` },
    ]);
    scannerNumber = num;
  }

  // Generate PIN
  const pin = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  console.log(chalk.green(`✓ PIN: ${chalk.yellow.bold(pin)}`));

  // Download and install APKs
  await downloadAndInstallApks(adbSerial, locationCode);

  // Push RT config
  await pushRtConfig(adbSerial, config);

  // Grant permissions
  console.log("Granting permissions...");
  const permissions = [
    ["com.rtsystems.rtlmobile", "android.permission.READ_EXTERNAL_STORAGE"],
    ["com.rtsystems.rtlmobile", "android.permission.WRITE_EXTERNAL_STORAGE"],
    ["com.ietires.tiretrack", "android.permission.READ_EXTERNAL_STORAGE"],
    ["com.ietires.tiretrack", "android.permission.WRITE_EXTERNAL_STORAGE"],
    ["com.ietires.tiretrack", "android.permission.CAMERA"],
    ["com.ietires.scanneragent", "android.permission.ACCESS_FINE_LOCATION"],
  ];
  for (const [pkg, perm] of permissions) {
    adb.grantPermission(adbSerial, pkg, perm);
  }
  console.log(chalk.green("✓ Permissions granted"));

  // Apply device settings
  applyDeviceSettings(adbSerial, config);

  // Disable bloatware
  if (config.bloatwarePackages.length > 0) {
    console.log("Disabling bloatware...");
    let disabled = 0;
    for (const pkg of config.bloatwarePackages) {
      if (adb.disablePackage(adbSerial, pkg)) disabled++;
    }
    console.log(chalk.green(`✓ Disabled ${disabled} apps`));
  }

  // Provision in IoT Core
  console.log("\nProvisioning in IoT Core...");
  let provisionResult: api.ProvisionResult | null = null;
  try {
    // First, get the location ID from Convex
    const location = await api.getLocationByName(locationName);
    const locationId = location?._id ?? "";

    // Create scanner record in Convex
    const scannerResult = await api.createScanner({
      number: scannerNumber,
      pin,
      serialNumber,
      model: `Zebra ${model}`,
      locationId,
      notes: "Configured via setup tool",
      androidVersion,
    });
    console.log(chalk.green(`✓ Registered in IE Central: ${scannerResult.number}`));

    // Provision in IoT Core
    provisionResult = await api.provisionScanner({
      serialNumber,
      locationCode,
      scannerNumber,
      scannerId: scannerResult.scannerId,
    });
    console.log(chalk.green(`✓ IoT provisioned: ${provisionResult.thingName}`));

    // Push certificates to device
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-certs-"));
    fs.writeFileSync(path.join(tempDir, "certificate.pem"), provisionResult.certificatePem);
    fs.writeFileSync(path.join(tempDir, "private.key"), provisionResult.privateKey);

    // Write IoT config
    const iotConfig = JSON.stringify({
      thingName: provisionResult.thingName,
      iotEndpoint: provisionResult.iotEndpoint,
    });
    fs.writeFileSync(path.join(tempDir, "iot_config.json"), iotConfig);

    // Push to device
    const appDir = "/data/data/com.ietires.scanneragent/files";
    adb.shellCommand(adbSerial, `run-as com.ietires.scanneragent mkdir -p ${appDir}`);
    adb.pushFile(adbSerial, path.join(tempDir, "certificate.pem"), `/sdcard/certificate.pem`);
    adb.pushFile(adbSerial, path.join(tempDir, "private.key"), `/sdcard/private.key`);
    adb.pushFile(adbSerial, path.join(tempDir, "iot_config.json"), `/sdcard/iot_config.json`);
    // Move from sdcard to app private storage
    adb.shellCommand(adbSerial, `run-as com.ietires.scanneragent cp /sdcard/certificate.pem ${appDir}/`);
    adb.shellCommand(adbSerial, `run-as com.ietires.scanneragent cp /sdcard/private.key ${appDir}/`);
    adb.shellCommand(adbSerial, `run-as com.ietires.scanneragent cp /sdcard/iot_config.json ${appDir}/`);
    // Cleanup
    adb.shellCommand(adbSerial, "rm /sdcard/certificate.pem /sdcard/private.key /sdcard/iot_config.json");
    fs.rmSync(tempDir, { recursive: true });
    console.log(chalk.green("✓ Certificates pushed to device"));

    // Activate device admin
    try {
      adb.shellCommand(adbSerial, "dpm set-active-admin com.ietires.scanneragent/.DeviceAdminReceiver");
      console.log(chalk.green("✓ Device admin activated"));
    } catch {
      console.log(chalk.yellow("⚠ Could not activate device admin — do manually"));
    }

    // Start agent service
    adb.shellCommand(adbSerial, "am startservice com.ietires.scanneragent/.MqttService");
    console.log(chalk.green("✓ Agent service started"));

  } catch (err) {
    console.log(chalk.yellow(`⚠ Provisioning failed: ${err}`));
    console.log(chalk.yellow("  Scanner registered but IoT not configured. Can re-provision later."));
  }

  // Summary
  console.log("");
  console.log(chalk.bold("========================================"));
  console.log(chalk.green.bold("  ✓ Setup complete!"));
  console.log(chalk.bold("========================================"));
  console.log("");
  console.log(chalk.cyan(`  Scanner:  ${chalk.bold(scannerNumber)}`));
  console.log(chalk.cyan(`  PIN:      ${chalk.bold.yellow(pin)}`));
  console.log(chalk.cyan(`  Serial:   ${chalk.bold(serialNumber)}`));
  console.log(chalk.cyan(`  Location: ${chalk.bold(locationName)}`));
  console.log(chalk.cyan(`  Model:    ${chalk.bold(model)}`));
  if (provisionResult) {
    console.log(chalk.cyan(`  IoT:      ${chalk.bold(provisionResult.thingName)}`));
  }
  console.log("");
  console.log(chalk.red("  Record the PIN — it cannot be recovered."));
  console.log("");
  console.log(chalk.bold("Manual steps:"));
  console.log("  1. Wi-Fi → Settings → Network & Internet");
  console.log("  2. Set PIN on device: Security Settings → Screen lock → PIN");
  console.log("  3. DataWedge → Profile0 → Suffix: ! | Send data: ✓ | Send TAB: ✓");
  console.log("  4. Home screen → Add RTLMobile + TireTrack + Settings");
  console.log("");
}

async function downloadAndInstallApks(adbSerial: string, locationCode: string) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-apks-"));

  for (const app of ["tiretrack", "rtlocator", "agent"] as const) {
    console.log(`Fetching ${app} APK...`);
    try {
      const apkInfo = await api.getApkUrl(app, locationCode);
      if (apkInfo.downloadUrl) {
        console.log(`  Downloading ${app} v${apkInfo.version}...`);
        const res = await fetch(apkInfo.downloadUrl);
        const buffer = await res.buffer();
        const apkPath = path.join(tempDir, `${app}.apk`);
        fs.writeFileSync(apkPath, buffer);

        console.log(`  Installing ${app}...`);
        if (adb.installApk(adbSerial, apkPath)) {
          console.log(chalk.green(`  ✓ ${app} installed`));
        } else {
          console.log(chalk.yellow(`  ⚠ ${app} install failed`));
        }
      }
    } catch (err) {
      console.log(chalk.yellow(`  ⚠ Could not fetch ${app}: ${err}`));
    }
  }

  fs.rmSync(tempDir, { recursive: true });
}

async function pushRtConfig(adbSerial: string, config: api.SetupConfig) {
  if (!config.rtConfigXml && !config.rtLocatorUrl) return;

  console.log("Pushing RT config...");
  const built = buildRtConfig({
    locationCode: config.locationCode ?? "unknown",
    rtLocatorUrl: config.rtLocatorUrl ?? "",
    rtDeviceId: config.rtDeviceId ?? "",
    template: config.rtConfigXml,
  });
  if (built.problems.length > 0) {
    console.error(chalk.red(`✗ RT config invalid: ${built.problems.join("; ")}`));
    return;
  }
  const xml = built.xml;

  const tempFile = path.join(os.tmpdir(), "rtlconfig.xml");
  fs.writeFileSync(tempFile, xml);
  adb.mkdir(adbSerial, "/sdcard/My Documents");
  if (adb.pushFile(adbSerial, tempFile, "/sdcard/My Documents/rtlconfig.xml")) {
    console.log(chalk.green("✓ RT config pushed"));
  } else {
    console.log(chalk.yellow("⚠ RT config push failed"));
  }
  fs.unlinkSync(tempFile);
}

function applyDeviceSettings(adbSerial: string, config: api.SetupConfig) {
  console.log("Applying device settings...");
  adb.setScreenTimeout(adbSerial, config.screenTimeoutMs);
  console.log(chalk.green(`✓ Screen timeout: ${config.screenTimeoutMs / 60000} min`));

  adb.setAutoRotate(adbSerial, config.screenRotation === "auto");
  console.log(chalk.green(`✓ Rotation: ${config.screenRotation}`));
}

// Start
main().catch((err) => {
  console.error(chalk.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
