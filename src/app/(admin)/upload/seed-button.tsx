'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { seedAction } from './actions';

// Camp brand: pure black ground, #EB7837 accent, #f2ede6 text. Kept inline
// (rather than a CSS module) because this component owns no stylesheet of
// its own here — see `data.module.css` for the same palette in context.
const cardStyle: CSSProperties = {
  background: '#000000',
  color: '#f2ede6',
  borderRadius: '10px',
  paddingBlock: '1.1rem',
  paddingInline: '1.4rem',
  marginBlockStart: '1rem',
};

const buttonStyle: CSSProperties = {
  appearance: 'none',
  border: 'none',
  borderRadius: '999px',
  background: '#EB7837',
  color: '#000000',
  font: 'inherit',
  fontWeight: 600,
  paddingBlock: '0.55rem',
  paddingInline: '1.4rem',
  cursor: 'pointer',
};

const messageStyle: CSSProperties = {
  marginBlockStart: '0.75rem',
  marginBlockEnd: 0,
  color: '#f2ede6',
};

export function SeedButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSeed() {
    setBusy(true);
    const result = await seedAction();
    setBusy(false);
    setMessage(
      result.imported.length > 0
        ? `נטענו ${result.imported.length} קבצים`
        : 'כל הקבצים כבר במסד',
    );
    router.refresh();
  }

  return (
    <div style={cardStyle}>
      <button type="button" onClick={onSeed} disabled={busy} style={{ ...buttonStyle, opacity: busy ? 0.6 : 1 }}>
        {busy ? 'טוען…' : 'טען את קבצי העבר'}
      </button>
      {message ? <p style={messageStyle}>{message}</p> : null}
    </div>
  );
}
