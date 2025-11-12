import React, { useEffect, useMemo, useRef, useState } from 'react';

// -------- Helpers --------
const DATE_FMT = {
  toKey(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },
  toLabel(d: Date) {
    return d.toLocaleDateString(undefined, {
      day: '2-digit',
      month: '2-digit',
    });
  },
  fromKey(key: string) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  },
};

const VN_DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']; // week starts Monday
function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date: Date, n: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function getWeekDates(anchor: Date) {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
function nanoid() {
  return 's-' + Math.random().toString(36).slice(2, 10);
}

// -------- LocalStorage Hook --------
function useLocalStorage<T>(key: string, initialValue: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);
  return [state, setState] as const;
}

// -------- Status helpers --------
const STATUS_ORDER = [null, 'miss', 'partial', 'done'] as const;
type Status = (typeof STATUS_ORDER)[number];
const STATUS_UI: Record<string, { label: string; title: string }> = {
  null: { label: '—', title: 'Chưa đặt' },
  miss: { label: '•', title: 'Bỏ lỡ' },
  partial: { label: '½', title: 'Làm một phần' },
  done: { label: '✓', title: 'Hoàn thành' },
};
function nextStatus(s?: Status | null): Status | null {
  const i = STATUS_ORDER.indexOf((s ?? null) as any);
  return STATUS_ORDER[(i + 1) % STATUS_ORDER.length] as any;
}

// -------- Main App --------
export default function DailyStudyProgressVN() {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [subjects, setSubjects] = useLocalStorage<
    { id: string; name: string; color: string; targetMin?: number }[]
  >('pt.subjects.v1', []);
  const [records, setRecords] = useLocalStorage<
    Record<
      string,
      Record<string, { status: Status | null; minutes?: number; note?: string }>
    >
  >('pt.records.v1', {});
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#22c55e');
  const [newTarget, setNewTarget] = useState<number | string>(60);

  function upsertRecord(
    dateKey: string,
    subjectId: string,
    patch: Partial<{ status: Status | null; minutes: number; note: string }>
  ) {
    setRecords((prev) => {
      const day = { ...(prev[dateKey] || {}) };
      const entry = { ...(day[subjectId] || { status: null }) };
      const next = { ...prev };
      day[subjectId] = { ...entry, ...patch };
      next[dateKey] = day;
      return next;
    });
  }
  function getEntry(dateKey: string, subjectId: string) {
    return (
      records?.[dateKey]?.[subjectId] || {
        status: null,
        minutes: 0,
        note: '',
      }
    );
  }

  // -------- Subject CRUD --------
  function addSubject() {
    const name = newName.trim();
    if (!name) return;
    const id = nanoid();
    setSubjects((s) => [
      ...s,
      { id, name, color: newColor, targetMin: Number(newTarget) || 0 },
    ]);
    setNewName('');
  }
  function removeSubject(id: string) {
    if (!confirm('Xóa môn này? Dữ liệu cũ vẫn giữ trong xuất JSON.')) return;
    setSubjects((s) => s.filter((x) => x.id !== id));
  }
  function renameSubject(id: string, name: string) {
    setSubjects((s) => s.map((x) => (x.id === id ? { ...x, name } : x)));
  }
  function recolorSubject(id: string, color: string) {
    setSubjects((s) => s.map((x) => (x.id === id ? { ...x, color } : x)));
  }
  function retargetSubject(id: string, targetMin: number | string) {
    setSubjects((s) =>
      s.map((x) =>
        x.id === id ? { ...x, targetMin: Number(targetMin) || 0 } : x
      )
    );
  }

  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
  const weekKeys = weekDates.map(DATE_FMT.toKey);

  // Stats
  function computeWeeklyRate(sid: string) {
    const total = weekKeys.length;
    let score = 0;
    for (const k of weekKeys) {
      const s = records?.[k]?.[sid]?.status || null;
      if (s === 'done') score += 1;
      else if (s === 'partial') score += 0.5;
    }
    return Math.round((score / total) * 100);
  }
  function streakDays(sid: string) {
    let count = 0;
    let cursor = new Date(today);
    for (let i = 0; i < 365; i++) {
      const k = DATE_FMT.toKey(cursor);
      if (records?.[k]?.[sid]?.status === 'done') count++;
      else break;
      cursor = addDays(cursor, -1);
    }
    return count;
  }

  // Export / Import JSON
  function exportJSON() {
    const data = {
      subjects,
      records,
      version: 1,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `progress-tracker-${DATE_FMT.toKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const importRef = useRef<HTMLInputElement | null>(null);
  function onImportJSON(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!data || !data.subjects || !data.records)
          throw new Error('Tập tin không đúng định dạng');
        setSubjects(data.subjects);
        setRecords(data.records);
        alert('Đã nhập dữ liệu thành công!');
      } catch (e: any) {
        alert('Lỗi đọc JSON: ' + e.message);
      }
    };
    reader.readAsText(file);
  }

  // Optional: Import Excel (SheetJS)
  async function tryImportExcel(file: File) {
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sh = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(sh, { header: 1 });
      const names = Array.from(
        new Set(rows.map((r) => String(r[0] || '').trim()).filter(Boolean))
      );
      if (!names.length) {
        alert('Không thấy tên môn ở cột đầu tiên của sheet 1.');
        return;
      }
      const existing = new Set(subjects.map((s) => s.name.toLowerCase()));
      const palette = [
        '#22c55e',
        '#3b82f6',
        '#f59e0b',
        '#ef4444',
        '#a855f7',
        '#14b8a6',
        '#e11d48',
        '#10b981',
        '#6366f1',
        '#f97316',
      ];
      const additions = names
        .filter((n) => !existing.has(n.toLowerCase()))
        .map((n, i) => ({
          id: nanoid(),
          name: n,
          color: palette[i % palette.length],
          targetMin: 60,
        }));
      if (!additions.length) {
        alert('Tất cả môn trong file đã tồn tại.');
        return;
      }
      setSubjects((prev) => [...prev, ...additions]);
      alert(`Đã thêm ${additions.length} môn từ Excel.`);
    } catch (e: any) {
      alert('Không thể nhập Excel: ' + e.message);
    }
  }

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.name.toLowerCase().endsWith('.json')) onImportJSON(f);
    else if (/\.xls|\.xlsx$/i.test(f.name)) tryImportExcel(f);
    else alert('Vui lòng chọn file .json hoặc .xlsx');
    e.target.value = ''; // reset
  }

  // Quick actions
  function markAllToday(status: Status) {
    const key = DATE_FMT.toKey(selectedDate);
    for (const s of subjects) {
      upsertRecord(key, s.id, { status });
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 sm:p-6 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Banner test - có thể xóa sau khi ok */}
        <div className="p-4 rounded-xl bg-emerald-500 text-white shadow">
          Tailwind + Inter OK ✅
        </div>

        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            📚 Nhật ký học tập hằng ngày
          </h1>
          <div className="flex gap-2">
            <button
              onClick={exportJSON}
              className="px-3 py-2 rounded-xl shadow bg-white hover:bg-slate-100"
            >
              Xuất JSON
            </button>
            <button
              onClick={() => importRef.current?.click()}
              className="px-3 py-2 rounded-xl shadow bg-white hover:bg-slate-100"
            >
              Nhập (JSON/Excel)
            </button>
            <input
              ref={importRef}
              onChange={onImportFile}
              type="file"
              accept=".json,.xls,.xlsx"
              className="hidden"
            />
          </div>
        </div>

        {/* Date controls */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            className="px-3 py-2 rounded-xl bg-white shadow hover:bg-slate-100"
            onClick={() => setSelectedDate(addDays(selectedDate, -7))}
          >
            ⟵ Tuần trước
          </button>
          <button
            className="px-3 py-2 rounded-xl bg-white shadow hover:bg-slate-100"
            onClick={() => setSelectedDate(today)}
          >
            Hôm nay
          </button>
          <button
            className="px-3 py-2 rounded-xl bg-white shadow hover:bg-slate-100"
            onClick={() => setSelectedDate(addDays(selectedDate, 7))}
          >
            Tuần sau ⟶
          </button>
          <input
            className="px-3 py-2 rounded-xl bg-white shadow"
            type="date"
            value={DATE_FMT.toKey(selectedDate)}
            onChange={(e) => setSelectedDate(DATE_FMT.fromKey(e.target.value))}
          />
          <div className="text-sm text-slate-600 ml-2">
            Tuần của <b>{DATE_FMT.toLabel(startOfWeek(selectedDate))}</b> -{' '}
            <b>{DATE_FMT.toLabel(addDays(startOfWeek(selectedDate), 6))}</b>
          </div>
        </div>

        {/* Grid + Today + Subjects */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Weekly Grid */}
          <section className="lg:col-span-2 bg-white rounded-2xl shadow p-4">
            <h2 className="text-lg font-semibold mb-3">📆 Lưới tuần</h2>
            {subjects.length === 0 ? (
              <p className="text-slate-600">
                Hãy thêm môn ở khối bên phải để bắt đầu.
              </p>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full border-separate border-spacing-y-1">
                  <thead>
                    <tr>
                      <th className="text-left text-xs font-medium text-slate-500 px-2 py-1">
                        Môn \ Ngày
                      </th>
                      {weekDates.map((d, i) => (
                        <th
                          key={i}
                          className="text-xs font-medium text-slate-500 px-2 py-1 text-center"
                        >
                          <div>{VN_DAYS[i]}</div>
                          <div className="font-semibold">
                            {DATE_FMT.toLabel(d)}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {subjects.map((s) => (
                      <tr key={s.id} className="align-middle">
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full"
                              style={{ background: s.color }}
                            />
                            <span className="font-medium">{s.name}</span>
                          </div>
                        </td>
                        {weekDates.map((d, idx) => {
                          const key = DATE_FMT.toKey(d);
                          const entry = getEntry(key, s.id);
                          const st = (entry.status ?? null) as Status | null;
                          const ui = STATUS_UI[String(st)];
                          return (
                            <td key={idx} className="px-1 py-1 text-center">
                              <button
                                className={`w-10 h-10 rounded-xl border hover:shadow transition text-sm font-semibold
                                  ${
                                    st === 'done'
                                      ? 'bg-emerald-100 border-emerald-200'
                                      : st === 'partial'
                                      ? 'bg-amber-100 border-amber-200'
                                      : st === 'miss'
                                      ? 'bg-rose-100 border-rose-200'
                                      : 'bg-white'
                                  }`}
                                title={ui?.title}
                                onClick={() =>
                                  upsertRecord(key, s.id, {
                                    status: nextStatus(st),
                                  })
                                }
                              >
                                {ui?.label ?? '—'}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {subjects.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => markAllToday('done' as Status)}
                  className="px-3 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  Đánh dấu hôm nay: ✓
                </button>
                <button
                  onClick={() => markAllToday('partial' as Status)}
                  className="px-3 py-2 rounded-xl bg-amber-500 text-white hover:bg-amber-600"
                >
                  Đánh dấu hôm nay: ½
                </button>
                <button
                  onClick={() => markAllToday('miss' as Status)}
                  className="px-3 py-2 rounded-xl bg-rose-500 text-white hover:bg-rose-600"
                >
                  Đánh dấu hôm nay: •
                </button>
              </div>
            )}
          </section>

          {/* Right column: Today + Subjects */}
          <div className="flex flex-col gap-6">
            {/* Today Panel */}
            <section className="bg-white rounded-2xl shadow p-4">
              <h2 className="text-lg font-semibold">
                🗓️ Ngày: {DATE_FMT.toLabel(selectedDate)}
              </h2>
              {subjects.length === 0 ? (
                <p className="mt-2 text-slate-600">Chưa có môn nào.</p>
              ) : (
                <div className="mt-2 flex flex-col gap-3">
                  {subjects.map((s) => {
                    const key = DATE_FMT.toKey(selectedDate);
                    const entry = getEntry(key, s.id);
                    const st = (entry.status ?? null) as Status | null;
                    const ui = STATUS_UI[String(st)];
                    return (
                      <div key={s.id} className="flex items-center gap-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full"
                          style={{ background: s.color }}
                        />
                        <span className="w-28 truncate" title={s.name}>
                          {s.name}
                        </span>
                        <button
                          className={`px-3 py-1 rounded-lg border text-sm font-semibold
                            ${
                              st === 'done'
                                ? 'bg-emerald-100 border-emerald-200'
                                : st === 'partial'
                                ? 'bg-amber-100 border-amber-200'
                                : st === 'miss'
                                ? 'bg-rose-100 border-rose-200'
                                : 'bg-white'
                            }`}
                          onClick={() =>
                            upsertRecord(key, s.id, { status: nextStatus(st) })
                          }
                          title={ui?.title}
                        >
                          {ui?.label ?? '—'}
                        </button>
                        <input
                          type="number"
                          className="w-24 px-2 py-1 rounded-lg bg-slate-50 border"
                          placeholder="phút"
                          min={0}
                          value={entry.minutes ?? ''}
                          onChange={(e) =>
                            upsertRecord(key, s.id, {
                              minutes: Number(e.target.value) || 0,
                            })
                          }
                          title="Phút đã học"
                        />
                        <span className="text-xs text-slate-500">
                          / {s.targetMin || 0}′
                        </span>
                        <input
                          type="text"
                          className="flex-1 px-2 py-1 rounded-lg bg-slate-50 border"
                          placeholder="ghi chú (tùy chọn)"
                          value={entry.note || ''}
                          onChange={(e) =>
                            upsertRecord(key, s.id, { note: e.target.value })
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Subjects Panel */}
            <section className="bg-white rounded-2xl shadow p-4">
              <h2 className="text-lg font-semibold mb-2">📙 Môn học</h2>
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  type="text"
                  className="px-3 py-2 rounded-xl bg-slate-50 border flex-1"
                  placeholder="Tên môn (VD: Toán, CSDL, Java, AI201)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="w-12 h-10 rounded-xl border"
                />
                <input
                  type="number"
                  min={0}
                  className="w-24 px-3 py-2 rounded-xl bg-slate-50 border"
                  value={newTarget}
                  onChange={(e) => setNewTarget(e.target.value)}
                  title="Mục tiêu phút/ngày"
                />
                <button
                  onClick={addSubject}
                  className="px-3 py-2 rounded-xl bg-slate-900 text-white hover:bg-black"
                >
                  Thêm
                </button>
              </div>
              {subjects.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {subjects.map((s) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <span
                        className="inline-block w-3 h-3 rounded-full"
                        style={{ background: s.color }}
                      />
                      <input
                        className="px-2 py-1 rounded-lg bg-slate-50 border flex-1"
                        value={s.name}
                        onChange={(e) => renameSubject(s.id, e.target.value)}
                      />
                      <input
                        type="color"
                        value={s.color}
                        onChange={(e) => recolorSubject(s.id, e.target.value)}
                        className="w-10 h-9 rounded-lg border"
                      />
                      <input
                        type="number"
                        min={0}
                        className="w-24 px-2 py-1 rounded-lg bg-slate-50 border"
                        value={s.targetMin || 0}
                        onChange={(e) => retargetSubject(s.id, e.target.value)}
                      />
                      <button
                        onClick={() => removeSubject(s.id)}
                        className="px-2 py-1 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200"
                      >
                        Xóa
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Stats Panel */}
            <section className="bg-white rounded-2xl shadow p-4">
              <h2 className="text-lg font-semibold">📈 Thống kê nhanh</h2>
              {subjects.length === 0 ? (
                <p className="text-slate-600">Thêm môn để xem thống kê.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {subjects.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full"
                          style={{ background: s.color }}
                        />
                        <span className="font-medium">{s.name}</span>
                      </div>
                      <div className="text-sm text-slate-600 flex items-center gap-3">
                        <span>
                          Tuần này: <b>{computeWeeklyRate(s.id)}%</b>
                        </span>
                        <span>
                          Streak: <b>{streakDays(s.id)}</b> ngày ✓
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>

        {/* Tips */}
        <div className="mt-6 text-xs text-slate-500">
          <p>
            Gợi ý: Nhấn vào mỗi ô để chuyển trạng thái (— → • → ½ → ✓). Dữ liệu
            lưu cục bộ (localStorage) — không cần mạng. Bạn có thể Nhập/Xuất để
            sao lưu hoặc chuyển máy.
          </p>
          <p className="mt-1">
            Mẹo: Có thể nhập danh sách môn từ Excel (.xlsx) — cột đầu tiên của
            sheet 1 sẽ được đọc làm tên môn.
          </p>
        </div>
      </div>
    </div>
  );
}
