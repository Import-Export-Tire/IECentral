// app/equipment/scanners/setup/useSetupSession.ts
// React hook that owns the wizard state machine.

import { useReducer, useMemo, useRef } from "react";
import { Id } from "@/convex/_generated/dataModel";
import { WebAdbClient, AdbConnection } from "./WebAdbClient";

export type StepName =
  | "detect" | "location" | "identity" | "generate"
  | "install" | "verify" | "done" | "error";

export type SetupState = {
  step: StepName;
  client: WebAdbClient;
  connection: AdbConnection | null;
  locationCode: string | null;
  locationName: string | null;
  scannerNumber: string | null;
  rtDeviceId: string;
  scannerId: Id<"scanners"> | null;
  provisionCode: string | null;
  pin: string | null;
  installProgress: Record<string, { status: "pending" | "in-progress" | "success" | "skipped" | "failed"; message?: string; percent?: number }>;
  installedVersions: { tireTrack?: string; rtLocator?: string; scannerAgent?: string };
  error: string | null;
};

type Action =
  | { type: "RESET" }
  | { type: "SET_CONNECTION"; connection: AdbConnection }
  | { type: "SET_LOCATION"; code: string; name: string }
  | { type: "SET_IDENTITY"; scannerNumber: string; rtDeviceId: string }
  | { type: "SET_GENERATED"; scannerId: Id<"scanners">; provisionCode: string; pin: string }
  | { type: "STEP"; step: StepName }
  | { type: "PROGRESS"; key: string; status: SetupState["installProgress"][string]["status"]; message?: string; percent?: number }
  | { type: "INSTALLED_VERSION"; app: "tireTrack" | "rtLocator" | "scannerAgent"; version: string }
  | { type: "ERROR"; message: string };

function initialState(client: WebAdbClient): SetupState {
  return {
    step: "detect",
    client,
    connection: null,
    locationCode: null,
    locationName: null,
    scannerNumber: null,
    rtDeviceId: "0001",
    scannerId: null,
    provisionCode: null,
    pin: null,
    installProgress: {},
    installedVersions: {},
    error: null,
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
      return { ...state, scannerNumber: action.scannerNumber, rtDeviceId: action.rtDeviceId };
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
      setIdentity: (scannerNumber: string, rtDeviceId: string) =>
        dispatch({ type: "SET_IDENTITY", scannerNumber, rtDeviceId }),
      setGenerated: (scannerId: Id<"scanners">, provisionCode: string, pin: string) =>
        dispatch({ type: "SET_GENERATED", scannerId, provisionCode, pin }),
      goToStep: (step: StepName) => dispatch({ type: "STEP", step }),
      reportProgress: (key: string, status: SetupState["installProgress"][string]["status"], message?: string, percent?: number) =>
        dispatch({ type: "PROGRESS", key, status, message, percent }),
      recordInstalledVersion: (app: "tireTrack" | "rtLocator" | "scannerAgent", version: string) =>
        dispatch({ type: "INSTALLED_VERSION", app, version }),
      reportError: (message: string) => dispatch({ type: "ERROR", message }),
    }),
    [],
  );

  return { state, actions };
}
