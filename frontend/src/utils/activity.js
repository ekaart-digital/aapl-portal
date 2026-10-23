// Whether a work timer is running in this browser. A running timer counts as
// activity, so the idle sign-out must not end the session underneath it.
let timerRunning = false;

export function setTimerRunning(value) {
  timerRunning = Boolean(value);
}

export function isTimerRunning() {
  return timerRunning;
}

// Shown on the login page after the idle sign-out.
export const IDLE_NOTICE_KEY = 'aapl_idle_signout';
