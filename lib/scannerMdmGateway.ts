/**
 * Scanner MDM API Gateway. Env wins; prod URL is the documented fallback so
 * Reset/Set PIN and other jobs still send when the Vercel var is missing
 * (same pattern as DUNLOP_API_GATEWAY_URL).
 */
export const SCANNER_MDM_API_GATEWAY_URL =
  process.env.SCANNER_MDM_API_GATEWAY_URL ||
  "https://7brylwlei6.execute-api.us-east-1.amazonaws.com/prod";
