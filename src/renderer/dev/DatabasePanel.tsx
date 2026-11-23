import { useState, type FormEvent } from 'react';
import { addDatabaseRecord, fetchDatabaseRecords, type DatabaseRecord } from './database-service';

const DEMO_PASSWORD = 'ornek-parola-42';

export function DemoPassword() {
  const [revealed, setRevealed] = useState(false);
  return <div className="tools-password">
    <div>
      <span>Örnek parola</span>
      <code>{revealed ? DEMO_PASSWORD : '••••••••••'}</code>
    </div>
    <button type="button" className="tools-icon" aria-label={revealed ? 'Örnek parolayı gizle' : 'Örnek parolayı göster'}
      onClick={() => setRevealed(value => !value)}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
        <circle cx="12" cy="12" r="2.5" />
        {revealed && <path d="m3 3 18 18" />}
      </svg>
    </button>
  </div>;
}

export function DatabasePanel() {
  const [records, setRecords] = useState<DatabaseRecord[] | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('Veri servisi henüz bağlanmadı.');

  async function readRecords() {
    setPending(true);
    setMessage('');
    try {
      const result = await fetchDatabaseRecords();
      setRecords(result);
      if (!result) setMessage('Veritabanı bağlı değil. Veri alınamadı.');
    } catch {
      setMessage('Kayıtlar alınamadı. Yeniden deneyin.');
    } finally {
      setPending(false);
    }
  }

  async function addRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const label = String(fields.get('label') ?? '').trim();
    const value = String(fields.get('value') ?? '').trim();
    if (!label || !value) {
      setMessage('Başlık ve değer girin.');
      return;
    }

    setPending(true);
    setMessage('');
    try {
      const result = await addDatabaseRecord({ label, value });
      if (!result) {
        setMessage('Veritabanı bağlı değil. Kayıt eklenmedi.');
        return;
      }
      setRecords(previous => [result, ...(previous ?? []).filter(record => record.id !== result.id)]);
      form.reset();
      setMessage('Kayıt eklendi.');
    } catch {
      setMessage('Kayıt eklenemedi. Yeniden deneyin.');
    } finally {
      setPending(false);
    }
  }

  return <>
    <p>Formu örnek verilerle deneyebilirsiniz.</p>
    <button type="button" className="tools-action" disabled={pending} onClick={() => void readRecords()}>Verileri getir</button>
    {records && (records.length ? <ul className="tools-list">
      {records.map(record => <li key={record.id}><strong>{record.label}</strong><span>{record.value}</span></li>)}
    </ul> : <p>Kayıt bulunamadı.</p>)}
    <form className="database-form" onSubmit={event => void addRecord(event)} autoComplete="off">
      <label>Başlık <input name="label" maxLength={80} required /></label>
      <label>Değer <input name="value" maxLength={300} required /></label>
      <button type="submit" disabled={pending}>Veri ekle</button>
    </form>
    {message && <p role="status">{message}</p>}
    <DemoPassword />
  </>;
}
