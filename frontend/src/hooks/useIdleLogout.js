import { useEffect } from 'react';
import { isTimerRunning } from '../utils/activity';

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
const CHECK_EVERY_MS = 15000;

// Calls onTimeout once the signed-in person has done nothing for
// `timeoutMinutes`. Never fires while a work timer is running. Does nothing
// without a timeout (signed out, or the server sent none).
export default function useIdleLogout({ active, timeoutMinutes, onTimeout }) {
  useEffect(() => {
    if (!active || !timeoutMinutes) return undefined;
    const limit = timeoutMinutes * 60 * 1000;
    let lastActivity = Date.now();

    const touch = () => { lastActivity = Date.now(); };
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, touch, { passive: true }));

    const timer = setInterval(() => {
      if (isTimerRunning()) { lastActivity = Date.now(); return; }
      if (Date.now() - lastActivity >= limit) onTimeout();
    }, CHECK_EVERY_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, touch));
      clearInterval(timer);
    };
  }, [active, timeoutMinutes, onTimeout]);
}
