import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Privacy, { PRIVACY_SECTIONS } from './Privacy';

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/somewhere', '/privacy']} initialIndex={1}>
      <Routes>
        <Route path="/somewhere" element={<div>Previous page</div>} />
        <Route path="/privacy" element={<Privacy />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Privacy and data use', () => {
  it('explains what is recorded, what is not, why, who can see it and for how long', () => {
    renderAt();
    expect(screen.getByRole('heading', { name: 'Privacy and data use' })).toBeInTheDocument();
    for (const heading of ['What is recorded', 'What is not recorded', 'Why', 'Who can see it', 'How long it is kept']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    // Every item of every section is on the page.
    for (const section of PRIVACY_SECTIONS) {
      for (const item of section.items) expect(screen.getByText(item)).toBeInTheDocument();
    }
  });

  it('says plainly that passwords, screenshots and workstation monitoring are not part of Version 1', () => {
    renderAt();
    const notRecorded = within(screen.getByRole('heading', { name: 'What is not recorded' }).closest('section'));
    expect(notRecorded.getByText(/Your password/)).toBeInTheDocument();
    expect(notRecorded.getByText(/screenshots, audio or webcam/)).toBeInTheDocument();
    expect(notRecorded.getByText(/does not monitor workstations/)).toBeInTheDocument();
  });

  it('is marked as draft wording for management to confirm', () => {
    renderAt();
    expect(screen.getByText(/Draft wording, to be confirmed by AAPL management/)).toBeInTheDocument();
  });

  it('goes back to where the reader came from', async () => {
    renderAt();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Previous page')).toBeInTheDocument();
  });
});
