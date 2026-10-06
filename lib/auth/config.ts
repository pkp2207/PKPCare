// Edge-safe feature flags read from env at call time (never cached, so tests and
// runtime config changes behave predictably).

// Legacy shared admin passkey: ON unless ALLOW_LEGACY_ADMIN_PASSKEY is "false".
// Set to "false" once real staff accounts exist.
export function isLegacyPasskeyAllowed(): boolean {
  return (
    (process.env.ALLOW_LEGACY_ADMIN_PASSKEY ?? "true").trim().toLowerCase() !==
    "false"
  );
}

// Patient identity enforcement: OFF unless PATIENT_AUTH_ENFORCED is exactly "true".
export function isPatientAuthEnforced(): boolean {
  return process.env.PATIENT_AUTH_ENFORCED === "true";
}
