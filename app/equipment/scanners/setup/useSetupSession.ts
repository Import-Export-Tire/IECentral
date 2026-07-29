// app/equipment/scanners/setup/useSetupSession.ts
// React hook that owns the wizard state machine.

import { useReducer, useMemo, useRef } from "react";
import { Id } from "@/convex/_generated/dataModel";
import { WebAdbClient, AdbConnection } from "./WebAdbClient";
import type { Check } from "@/lib/scanners/verify";

export type StepName =
  | "detect" | "location" | "identity" | "generate"
  | "manage" | "install" | "verify" | "done" | "error";

export type ExistingScanner = {
  _id: Id<"scanners">;
  number: string;
  locationCode: string | null;   // derived for InstallStep (mdmConfig / apk urls)
  locationName: string | null;
  status: string;
  conditionNotes: string | null;
  assignedTo: Id<"personnel"> | null;
};

export type ManageFields = {
  conditionNotes: string;
  status: string;
  assignedTo: Id<"personnel"> | null;
};

export type SetupState = {
  step: StepName;
  client: WebAdbClient;
  connection: AdbConnection | null;
  locationCode: string | null;
  locationName: string | null;
  scannerNumber: string | null;
  scannerId: Id<"scanners"> | null;
  provisionCode: string | null;
  pin: string | null;
  installProgress: Record<string, { status: "pending" | "in-progress" | "success" | "skipped" | "failed"; message?: string; percent?: number }>;
  installedVersions: { tireTrack?: string; rtLocator?: string; scannerAgent?: string };
  error: string | null;
  mode: "new" | "update";
  existingScanner: ExistingScanner | null;
  manage: ManageFields;
  deviceOwner: boolean;
  verification: Check[] | null;
  scanTestConfirmed: boolean;
};

type Action =
  | { type: "RESET" }
  | { type: "SET_CONNECTION"; connection: AdbConnection }
  | { type: "SET_LOCATION"; code: string; name: string }
  | { type: "SET_IDENTITY"; scannerNumber: string }
  | { type: "SET_GENERATED"; scannerId: Id<"scanners">; provisionCode: string; pin: string }
  | { type: "STEP"; step: StepName }
  | { type: "PROGRESS"; key: string; status: SetupState["installProgress"][string]["status"]; message?: string; percent?: number }
  | { type: "INSTALLED_VERSION"; app: "tireTrack" | "rtLocator" | "scannerAgent"; version: string }
  | { type: "ERROR"; message: string }
  | { type: "SET_UPDATE_MODE"; scanner: ExistingScanner }
  | { type: "SET_MANAGE"; fields: Partial<ManageFields> }
  | { type: "SET_DEVICE_OWNER"; value: boolean }
  | { type: "SET_VERIFICATION"; checks: Check[] }
  | { type: "CONFIRM_SCAN_TEST" };

function initialState(client: WebAdbClient): SetupState {
  return {
    step: "detect",
    client,
    connection: null,
    locationCode: null,
    locationName: null,
    scannerNumber: null,
    scannerId: null,
    provisionCode: null,
    pin: null,
    installProgress: {},
    installedVersions: {},
    error: null,
    mode: "new",
    existingScanner: null,
    manage: { conditionNotes: "", status: "available", assignedTo: null },
    deviceOwner: false,
    verification: null,
    scanTestConfirmed: false,
  };
}

function reducer(state: SetupState, action: Action): SetupState {
  switch (action.type) {
    case "RESET":
      return initialState(state.client);
    case "SET_CONNECTION":
      return { ...state, connection: action.connection };
    case "SET_LOCATION":
      return { ...state, locationCode: action.code, locationName: action.name };
    case "SET_IDENTITY":
      return { ...state, scannerNumber: action.scannerNumber };
    case "SET_GENERATED":
      return { ...state, scannerId: action.scannerId, provisionCode: action.provisionCode, pin: action.pin };
    case "STEP":
      return { ...state, step: action.step };
    case "PROGRESS":
      return {
        ...state,
        installProgress: {
          ...state.installProgress,
          [action.key]: { status: action.status, message: action.message, percent: action.percent },
        },
      };
    case "INSTALLED_VERSION":
      return { ...state, installedVersions: { ...state.installedVersions, [action.app]: action.version } };
    case "ERROR":
      return { ...state, step: "error", error: action.message };
    case "SET_UPDATE_MODE":
      return {
        ...state,
        mode: "update",
        existingScanner: action.scanner,
        scannerId: action.scanner._id,
        locationCode: action.scanner.locationCode,
        locationName: action.scanner.locationName,
        scannerNumber: action.scanner.number,
        manage: {
          conditionNotes: action.scanner.conditionNotes ?? "",
          status: action.scanner.status,
          assignedTo: action.scanner.assignedTo,
        },
      };
    case "SET_MANAGE":
      return { ...state, manage: { ...state.manage, ...action.fields } };
    case "SET_DEVICE_OWNER":
      return { ...state, deviceOwner: action.value };
    case "SET_VERIFICATION":
      return { ...state, verification: action.checks };
    case "CONFIRM_SCAN_TEST":
      // Flip the dataWedgeScanTest check to pass so the on-screen list and anything derived
      // from state.verification (e.g. what gets persisted) reflect the human confirmation.
      // Only that one check's status/observed changes — every other check is left untouched.
      return {
        ...state,
        scanTestConfirmed: true,
        verification: state.verification
          ? state.verification.map((c) =>
              c.key === "dataWedgeScanTest" ? { ...c, status: "pass", observed: "confirmed" } : c,
            )
          : state.verification,
      };
    default:
      return state;
  }
}

export function useSetupSession() {
  const clientRef = useRef<WebAdbClient | null>(null);
  if (!clientRef.current) clientRef.current = new WebAdbClient();
  const [state, dispatch] = useReducer(reducer, clientRef.current, initialState);

  const actions = useMemo(
    () => ({
      reset: () => dispatch({ type: "RESET" }),
      setConnection: (connection: AdbConnection) => dispatch({ type: "SET_CONNECTION", connection }),
      setLocation: (code: string, name: string) => dispatch({ type: "SET_LOCATION", code, name }),
      setIdentity: (scannerNumber: string) =>
        dispatch({ type: "SET_IDENTITY", scannerNumber }),
      setGenerated: (scannerId: Id<"scanners">, provisionCode: string, pin: string) =>
        dispatch({ type: "SET_GENERATED", scannerId, provisionCode, pin }),
      goToStep: (step: StepName) => dispatch({ type: "STEP", step }),
      reportProgress: (key: string, status: SetupState["installProgress"][string]["status"], message?: string, percent?: number) =>
        dispatch({ type: "PROGRESS", key, status, message, percent }),
      recordInstalledVersion: (app: "tireTrack" | "rtLocator" | "scannerAgent", version: string) =>
        dispatch({ type: "INSTALLED_VERSION", app, version }),
      reportError: (message: string) => dispatch({ type: "ERROR", message }),
      setUpdateMode: (scanner: ExistingScanner) => dispatch({ type: "SET_UPDATE_MODE", scanner }),
      setManage: (fields: Partial<ManageFields>) => dispatch({ type: "SET_MANAGE", fields }),
      setDeviceOwner: (value: boolean) => dispatch({ type: "SET_DEVICE_OWNER", value }),
      setVerification: (checks: Check[]) => dispatch({ type: "SET_VERIFICATION", checks }),
      confirmScanTest: () => dispatch({ type: "CONFIRM_SCAN_TEST" }),
    }),
    [],
  );

  return { state, actions };
}
