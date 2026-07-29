import fetch from "node-fetch";

const BASE_URL = process.env.IECENTRAL_URL || "http://localhost:3000";
const CONVEX_URL = process.env.CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";

/**
 * API client for scanner MDM endpoints.
 */

export interface ScannerLookupResult {
  found: boolean;
  scanner?: {
    id: string;
    number: string;
    serialNumber: string;
    model: string;
    locationName: string;
    status: string;
    mdmStatus: string;
    isOnline: boolean;
    lastSeen: number;
    installedApps: {
      tireTrack?: string;
      rtLocator?: string;
      scannerAgent?: string;
    };
  };
}

export async function lookupScanner(serialNumber: string): Promise<ScannerLookupResult> {
  const res = await fetch(`${BASE_URL}/api/scanner-mdm/lookup?serialNumber=${encodeURIComponent(serialNumber)}`);
  return res.json() as Promise<ScannerLookupResult>;
}

export interface SetupConfig {
  locationCode: string;
  rtLocatorUrl: string;
  defaultDeviceIdPrefix: string;
  screenTimeoutMs: number;
  screenRotation: string;
  bloatwarePackages: string[];
  wifiSsid?: string;
  wifiPassword?: string;
  tireTrackApkSource: string;
  rtConfigXml?: string;
  rtDeviceId?: string;
  currentTireTrackVersion?: string;
  currentRtLocatorVersion?: string;
  currentAgentVersion?: string;
}

export async function getSetupConfig(locationCode: string): Promise<SetupConfig> {
  const res = await fetch(`${BASE_URL}/api/scanner-mdm/config?locationCode=${encodeURIComponent(locationCode)}`);
  return res.json() as Promise<SetupConfig>;
}

export interface ApkInfo {
  downloadUrl: string;
  version: string;
  source: string;
}

export async function getApkUrl(app: string, locationCode: string): Promise<ApkInfo> {
  const res = await fetch(`${BASE_URL}/api/scanner-mdm/apk?app=${app}&locationCode=${locationCode}`);
  return res.json() as Promise<ApkInfo>;
}

export interface ProvisionResult {
  thingName: string;
  thingArn: string;
  certificateArn: string;
  certificatePem: string;
  privateKey: string;
  publicKey: string;
  iotEndpoint: string;
}

export async function provisionScanner(data: {
  serialNumber: string;
  locationCode: string;
  scannerNumber: string;
  scannerId?: string;
}): Promise<ProvisionResult> {
  const res = await fetch(`${BASE_URL}/api/scanner-mdm/provision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json() as Promise<ProvisionResult>;
}

export async function getNextScannerNumber(locationCode: string): Promise<string> {
  const res = await fetch(`${CONVEX_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "scannerMdm:getNextScannerNumber",
      args: { locationCode },
      format: "json",
    }),
  });
  const data = await res.json();
  return data as string;
}

export async function createScanner(data: {
  number: string;
  pin: string;
  serialNumber: string;
  model: string;
  locationId: string;
  notes?: string;
  iotThingName?: string;
  iotThingArn?: string;
  iotCertificateArn?: string;
  installedApps?: Record<string, string>;
  androidVersion?: string;
  agentVersion?: string;
}): Promise<{ scannerId: string; number: string }> {
  const res = await fetch(`${CONVEX_URL}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "scannerMdm:createScannerFromSetup",
      args: data,
      format: "json",
    }),
  });
  return res.json() as Promise<{ scannerId: string; number: string }>;
}

export async function getLocationByName(name: string): Promise<{ _id: string; name: string } | null> {
  const res = await fetch(`${CONVEX_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "locations:getByName",
      args: { name },
      format: "json",
    }),
  });
  return res.json() as Promise<{ _id: string; name: string } | null>;
}
