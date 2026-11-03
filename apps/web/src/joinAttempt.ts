/**
 * A room code typed on Home. The room itself is the only thing that knows whether the code exists (the server answers
 * on the socket), so Home hands the typed code to the room screen and, when the server says "no such room", the room
 * screen hands it back here and returns to Home, which shows the reason next to the field with the code still typed.
 * A link or a bookmark (#/r/CODE) never goes through here and keeps the plain "no room" page.
 */
export type JoinFailure = { code: string; typed: string; error: string };
let attempt: { code: string; typed: string } | null = null;
let failure: JoinFailure | null = null;

export function startJoin(code: string, typed: string) {
  attempt = { code, typed };
  failure = null;
}
/** True while a code typed on Home is being tried for this room code. */
export const isTypedJoin = (code: string) => attempt?.code === code;
/** The room reports the server's answer. Returns true when Home should show it (the code came from the Home field). */
export function failJoin(code: string, error: string): boolean {
  if (attempt?.code !== code) return false;
  failure = { ...attempt, error };
  attempt = null;
  return true;
}
/** The room opened: the attempt is over. */
export function joinSucceeded(code: string) {
  if (attempt?.code === code) attempt = null;
}
export function takeJoinFailure(): JoinFailure | null {
  const f = failure;
  failure = null;
  return f;
}
