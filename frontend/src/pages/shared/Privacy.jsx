import React from 'react';
import { useNavigate } from 'react-router-dom';

// What the platform records and why (SRS §36 "Privacy and Employee
// Transparency"), written for Version 1. This is draft wording: the company
// should review it before it is relied on.
export const PRIVACY_SECTIONS = [
  {
    heading: 'What is recorded',
    items: [
      'When you sign in, and failed sign-in attempts on your account.',
      'The project timer: which task you worked on, when you started and stopped, and how long.',
      'Task updates: the status and remarks you enter, and the tasks and hours allocated to you.',
      'Time corrections you ask for, and the decisions on them.',
      'Changes made to people, projects, tasks, logged hours and system settings: who changed what, when, and the old and new values (the audit trail).',
    ],
  },
  {
    heading: 'What is not recorded',
    items: [
      'Your password. It is stored only as a one-way scrambled value, and nobody, including administrators, can read it.',
      'Private communications, screenshots, audio or webcam images.',
      'Which applications or websites you use, or anything about your computer. Version 1 does not monitor workstations.',
    ],
  },
  {
    heading: 'Why',
    items: [
      'Project costing and man-hour control, resource planning, office management and the security of company data.',
      'Hours and project figures are used to see how projects are progressing. They are not used on their own to judge anyone’s conduct.',
    ],
  },
  {
    heading: 'Who can see it',
    items: [
      'You can see your own tasks, hours and reports.',
      'Your Team Leader, Department Head and the Project Manager of the projects you work on can see your tasks and hours on those projects, and decide on your time corrections.',
      'Management can see company-wide figures. HR and the System Administrator manage employee records and system settings, and cannot see project data.',
      'Each person sees only what their role needs; the system enforces this.',
    ],
  },
  {
    heading: 'How long it is kept',
    items: [
      'Project hours and the audit trail are kept as business records. Notifications you have read are removed after 90 days.',
      'If you have a question about your data, or think something recorded about you is wrong, ask your Team Leader or HR. You can also request a correction to your logged time in My Time.',
    ],
  },
];

export default function Privacy() {
  const navigate = useNavigate();
  return (
    <div className="login-shell" style={{ alignItems: 'flex-start', padding: '40px 16px' }}>
      <div className="login-card" style={{ maxWidth: 720, width: '100%' }}>
        <h1 className="login-title">Privacy and data use</h1>
        <p className="muted" style={{ marginBottom: 6 }}>AAPL Consulting Engineers LLC · Office Management Platform</p>
        <p style={{ fontSize: 13.5, marginBottom: 18 }}>
          AAPL’s systems are company assets. The platform records project and task information, sign-in activity and changes to company records for the purposes below.
          It is not intended to record passwords, private communication content, screenshots, audio or webcam footage.
        </p>
        {PRIVACY_SECTIONS.map((section) => (
          <section key={section.heading} style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{section.heading}</h2>
            <ul style={{ paddingLeft: 18, fontSize: 13.5, lineHeight: 1.55 }}>
              {section.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
        <p className="muted" style={{ fontSize: 12, marginBottom: 14 }}>Draft wording, to be confirmed by AAPL management.</p>
        <button className="btn" onClick={() => navigate(-1)}>Back</button>
      </div>
    </div>
  );
}
