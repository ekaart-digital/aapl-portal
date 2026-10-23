import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import useIdleLogout from './useIdleLogout';
import { setTimerRunning } from '../utils/activity';

function Probe(props) {
  useIdleLogout(props);
  return null;
}

const minutes = (n) => n * 60 * 1000;

describe('idle sign-out', () => {
  let onTimeout;

  beforeEach(() => {
    vi.useFakeTimers();
    onTimeout = vi.fn();
    setTimerRunning(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    setTimerRunning(false);
  });

  it('signs out after the set time with no activity', () => {
    render(<Probe active timeoutMinutes={30} onTimeout={onTimeout} />);
    vi.advanceTimersByTime(minutes(29));
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(minutes(2));
    expect(onTimeout).toHaveBeenCalled();
  });

  it('restarts the clock on any activity', () => {
    render(<Probe active timeoutMinutes={30} onTimeout={onTimeout} />);
    vi.advanceTimersByTime(minutes(25));
    window.dispatchEvent(new Event('mousemove'));
    vi.advanceTimersByTime(minutes(25));
    expect(onTimeout).not.toHaveBeenCalled(); // 25 minutes since the last movement
    window.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(minutes(29));
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(minutes(2));
    expect(onTimeout).toHaveBeenCalled();
  });

  it('never signs out while a work timer is running', () => {
    setTimerRunning(true);
    render(<Probe active timeoutMinutes={30} onTimeout={onTimeout} />);
    vi.advanceTimersByTime(minutes(180));
    expect(onTimeout).not.toHaveBeenCalled();

    // Once the timer stops, the clock starts from then, not from the last click.
    setTimerRunning(false);
    vi.advanceTimersByTime(minutes(20));
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(minutes(20));
    expect(onTimeout).toHaveBeenCalled();
  });

  it('does nothing when nobody is signed in, or the server sent no timeout', () => {
    render(<Probe active={false} timeoutMinutes={30} onTimeout={onTimeout} />);
    render(<Probe active timeoutMinutes={undefined} onTimeout={onTimeout} />);
    vi.advanceTimersByTime(minutes(600));
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('stops watching when it is removed', () => {
    const { unmount } = render(<Probe active timeoutMinutes={30} onTimeout={onTimeout} />);
    unmount();
    vi.advanceTimersByTime(minutes(600));
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('follows a changed timeout', () => {
    const { rerender } = render(<Probe active timeoutMinutes={60} onTimeout={onTimeout} />);
    vi.advanceTimersByTime(minutes(40));
    rerender(<Probe active timeoutMinutes={30} onTimeout={onTimeout} />);
    vi.advanceTimersByTime(minutes(29));
    expect(onTimeout).not.toHaveBeenCalled(); // the clock restarted with the new setting
    vi.advanceTimersByTime(minutes(2));
    expect(onTimeout).toHaveBeenCalled();
  });
});
