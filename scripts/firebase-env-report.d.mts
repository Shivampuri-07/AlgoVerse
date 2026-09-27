export const PUBLIC_FIREBASE_VARS: string[];
export function unexpectedFirebaseNames(env?: Record<string, string | undefined>): string[];
export function firebaseEnvReport(env?: Record<string, string | undefined>): string;
