import React, { useEffect, useMemo, useRef, useState } from 'react';

/* ===================== Types ===================== */
type Subject = {
  id: string;
  name: string;
  color: string;
  targetMin?: number;
};

type Status = 'done' | 'partial' | 'miss' | null;

type RecordEntry = {
  status: Status;
  minutes?: number;
  note?: string;
};

type Records = {
  [dateKey: string]: {
    [subjectId: string]: RecordEntry;
  };
};

type ActiveTimer = {
  id: string;
  subjectId: string;
  dateKey: string;    // luôn là "hôm nay" lúc bấm Start
  targetSec: number;  // tổng giây cần đếm
  isRunning: boolean;
  startedAt: number;  // ms epoch khi bắt đầu lần gần nhất
  elapsedSec: number; // tổng giây đã tích lũy (không gồm khoảng đang chạy)
};

/* ===================== Helpers ===================== */

const DATE_FMT = {
  toKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },
  toLabel(d: Date): string {
    return d.toLocaleDateString(undefined, {
      day: '2-digit',
      month: '2-digit',
    });
  },
  fromKey(key: string): Date {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  },
};

const VN_DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] as const; // Mon..Sun

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Mon=0..Sun=6
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function getWeekDates(anchor: Date): Date[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
function nanoid(): string {
  return 's-' + Math.random().toString(36).slice(2, 10);
}

/* ===================== LocalStorage Hook ===================== */
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

/* ===================== Status UI ===================== */
const STATUS_ORDER: Status[] = [null, 'miss', 'partial', 'done'];
const STATUS_UI: Record<
  'null' | 'miss' | 'partial' | 'done',
  { label: string; title: string }
> = {
  null: { label: '—', title: 'Chưa đặt' },
  miss: { label: '•', title: 'Bỏ lỡ' },
  partial: { label: '½', title: 'Làm một phần' },
  done: { label: '✓', title: 'Hoàn thành' },
};
function nextStatus(s: Status): Status {
  const i = STATUS_ORDER.indexOf(s ?? null);
  return STATUS_ORDER[(i + 1) % STATUS_ORDER.length];
}

/* ======== Minutes → status theo target (dùng cho tô màu/đổi nhãn) ======== */
function statusFromMinutes(minutes: number, target?: number): Status {
  if (!minutes || minutes <= 0) return null;
  const T = Number(target) || 0;
  if (T <= 0) return 'partial';
  if (minutes >= T) return 'done';
  if (minutes >= Math.ceil(T / 2)) return 'partial';
  return null;
}

/* ===================== Main App ===================== */
export default function DailyStudyProgressVN() {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [subjects, setSubjects] = useLocalStorage<Subject[]>(
    'pt.subjects.v1',
    []
  );
  const [records, setRecords] = useLocalStorage<Records>('pt.records.v1', {});
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [newName, setNewName] = useState<string>('');
  const [newColor, setNewColor] = useState<string>('#22c55e');
  const [newTarget, setNewTarget] = useState<number>(60);

  function upsertRecord(
    dateKey: string,
    subjectId: string,
    patch: Partial<RecordEntry>
  ): void {
    setRecords((prev) => {
      const day = { ...(prev[dateKey] || {}) };
      const entry = { ...(day[subjectId] || { status: null }) };
      const next: Records = { ...prev };
      day[subjectId] = { ...entry, ...patch };
      next[dateKey] = day;
      return next;
    });
  }
  function getEntry(dateKey: string, subjectId: string): RecordEntry {
    return (
      records?.[dateKey]?.[subjectId] || { status: null, minutes: 0, note: '' }
    );
  }

  // ====== helper cộng phút + cập nhật status bám theo target ======
  function applyMinutes(dateKey: string, sid: string, addMin: number): void {
    if (!addMin || addMin <= 0) return;
    const subj = subjects.find((x) => x.id === sid);
    const prevMin = getEntry(dateKey, sid).minutes || 0;
    const nextMin = Math.max(0, Math.round(prevMin + addMin));
    const st = statusFromMinutes(nextMin, subj?.targetMin);
    upsertRecord(dateKey, sid, { minutes: nextMin, status: st });
  }

  // -------- Subject CRUD --------
  function addSubject(): void {
    const name = newName.trim();
    if (!name) return;
    const id = nanoid();
    setSubjects((s) => [
      ...s,
      { id, name, color: newColor, targetMin: Number(newTarget) || 0 },
    ]);
    setNewName('');
  }
  function removeSubject(id: string): void {
    if (!confirm('Xóa môn này? Dữ liệu cũ vẫn giữ trong xuất JSON.')) return;
    setSubjects((s) => s.filter((x) => x.id !== id));
  }
  function renameSubject(id: string, name: string): void {
    setSubjects((s) => s.map((x) => (x.id === id ? { ...x, name } : x)));
  }
  function recolorSubject(id: string, color: string): void {
    setSubjects((s) => s.map((x) => (x.id === id ? { ...x, color } : x)));
  }
  function retargetSubject(id: string, targetMin: number | string): void {
    setSubjects((s) =>
      s.map((x) =>
        x.id === id ? { ...x, targetMin: Number(targetMin) || 0 } : x
      )
    );
  }

  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
  const weekKeys = weekDates.map(DATE_FMT.toKey);

  // ======= Stats (xét minutes → status) =======
  function derivedStatus(dateKey: string, sid: string): Status {
    const entry = getEntry(dateKey, sid);
    const fromMin = statusFromMinutes(
      entry.minutes || 0,
      subjects.find((s) => s.id === sid)?.targetMin
    );
    return fromMin ?? (entry.status ?? null);
  }

  function computeWeeklyRate(sid: string): number {
    const total = weekKeys.length;
    let score = 0;
    for (const k of weekKeys) {
      const s = derivedStatus(k, sid);
      if (s === 'done') score += 1;
      else if (s === 'partial') score += 0.5;
    }
    return Math.round((score / total) * 100);
  }
  function streakDays(sid: string): number {
    let count = 0;
    let cursor = new Date(today);
    for (let i = 0; i < 365; i++) {
      const k = DATE_FMT.toKey(cursor);
      if (derivedStatus(k, sid) === 'done') count++;
      else break;
      cursor = addDays(cursor, -1);
    }
    return count;
  }

  // Export / Import JSON
  function exportJSON(): void {
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

  function onImportJSON(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as {
          subjects: Subject[];
          records: Records;
        };
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

  // Optional: Import subjects from Excel (first column)
  async function tryImportExcel(file: File): Promise<void> {
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sh = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(sh, { header: 1 });
      const names = Array.from(
        new Set(
          rows
            .map((r) => String((r?.[0] ?? '') as string).trim())
            .filter(Boolean)
        )
      );
      if (!names.length) {
        alert('Không thấy tên môn ở cột đầu tiên của sheet 1.');
        return;
      }
      const existing = new Set(subjects.map((s) => s.name.toLowerCase()));
      const palette: string[] = [
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
      const additions: Subject[] = names
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

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.name.toLowerCase().endsWith('.json')) onImportJSON(f);
    else if (/\.xls|\.xlsx$/i.test(f.name)) tryImportExcel(f);
    else alert('Vui lòng chọn file .json hoặc .xlsx');
    e.target.value = ''; // reset
  }

  // Quick actions
  function markAllToday(status: Status): void {
    const key = DATE_FMT.toKey(selectedDate);
    for (const s of subjects) {
      upsertRecord(key, s.id, { status });
    }
  }

  /* ===================== TIMER STATE/LOGIC ===================== */
  const [activeTimer, setActiveTimer] = useLocalStorage<ActiveTimer | null>(
    'pt.timer.v1',
    null
  );
  const [tick, setTick] = useState(0);
  const [timerSubjectId, setTimerSubjectId] = useState<string | null>(
    () => subjects[0]?.id || null
  );
  const [timerDurationMin, setTimerDurationMin] = useState<number>(25);

  useEffect(() => {
    if (!timerSubjectId && subjects[0]?.id) setTimerSubjectId(subjects[0].id);
  }, [subjects, timerSubjectId]);

  function formatMMSS(totalSec: number): string {
    const m = Math.floor(Math.max(0, totalSec) / 60);
    const s = Math.max(0, totalSec) % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  function remainingSec(t: ActiveTimer | null): number {
    if (!t) return 0;
    let passed = t.elapsedSec;
    if (t.isRunning) passed += Math.floor((Date.now() - t.startedAt) / 1000);
    return Math.max(0, t.targetSec - passed);
  }

  function startTimer() {
    if (!timerSubjectId) return alert('Chưa có môn để bấm giờ.');
    const dateKey = DATE_FMT.toKey(new Date());
    setActiveTimer({
      id: nanoid(),
      subjectId: timerSubjectId,
      dateKey,
      targetSec: Math.max(60, Math.round(timerDurationMin * 60)), // tối thiểu 1 phút
      isRunning: true,
      startedAt: Date.now(),
      elapsedSec: 0,
    });
  }
  function pauseTimer() {
    setActiveTimer((t) => {
      if (!t || !t.isRunning) return t;
      const addSec = Math.floor((Date.now() - t.startedAt) / 1000);
      const nt: ActiveTimer = {
        ...t,
        isRunning: false,
        elapsedSec: t.elapsedSec + addSec,
      };
      const addMin = Math.floor(addSec / 60);
      if (addMin > 0) applyMinutes(t.dateKey, t.subjectId, addMin);
      return nt;
    });
  }
  function resumeTimer() {
    setActiveTimer((t) =>
      t ? { ...t, isRunning: true, startedAt: Date.now() } : t
    );
  }
  function stopTimer(commit = true) {
    setActiveTimer((t) => {
      if (!t) return null;
      let totalSec = t.elapsedSec;
      if (t.isRunning) totalSec += Math.floor((Date.now() - t.startedAt) / 1000);
      if (commit) {
        const addMin = Math.floor(totalSec / 60);
        if (addMin > 0) applyMinutes(t.dateKey, t.subjectId, addMin);
      }
      return null;
    });
  }

  // tick mỗi giây + auto-finish khi hết giờ
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    setActiveTimer((t) => {
      if (!t) return t;
      if (remainingSec(t) <= 0) {
        const addMin = Math.floor(t.targetSec / 60);
        if (addMin > 0) applyMinutes(t.dateKey, t.subjectId, addMin);
        return null;
      }
      return t;
    });
  }, [tick]);

  // cố gắng commit phút khi đóng tab
  useEffect(() => {
    const onUnload = () => {
      setActiveTimer((t) => {
        if (!t) return t;
        let sec = t.elapsedSec;
        if (t.isRunning) sec += Math.floor((Date.now() - t.startedAt) / 1000);
        const addMin = Math.floor(sec / 60);
        if (addMin > 0) applyMinutes(t.dateKey, t.subjectId, addMin);
        return null;
      });
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  /* =============== UI =============== */
    return (
  <div className="min-h-screen bg-slate-50 text-slate-800 font-sans">
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 text-sm sm:text-[15px]">
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
          Tuần của <b>{DATE_FMT.toLabel(startOfWeek(selectedDate))}</b> -{" "}
          <b>{DATE_FMT.toLabel(addDays(startOfWeek(selectedDate), 6))}</b>
        </div>
      </div>

      {/* Tất cả card xếp 1 cột */}
      <div className="mt-6 space-y-6">
        {/* Weekly Grid */}
        <section className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-lg font-semibold mb-3">📆 Lưới tuần</h2>
          {subjects.length === 0 ? (
            <p className="text-slate-600">
              Hãy thêm môn ở khối bên dưới để bắt đầu.
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
                  {subjects.map((s: Subject) => (
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
                        const minutes = entry.minutes || 0;
                        const stDerived =
                          statusFromMinutes(minutes, s.targetMin) ??
                          (entry.status ?? null);
                        const ui =
                          STATUS_UI[
                            (stDerived ?? "null") as
                              | "null"
                              | "miss"
                              | "partial"
                              | "done"
                          ];
                        const cellLabel =
                          minutes > 0 ? `${minutes}′` : ui?.label ?? "—";
                        return (
                          <td key={idx} className="px-1 py-1 text-center">
                            <button
                              className={`w-10 h-10 rounded-xl border hover:shadow transition text-sm font-semibold
                                ${
                                  stDerived === "done"
                                    ? "bg-emerald-100 border-emerald-200"
                                    : stDerived === "partial"
                                    ? "bg-amber-100 border-amber-200"
                                    : stDerived === "miss"
                                    ? "bg-rose-100 border-rose-200"
                                    : "bg-white"
                                }`}
                              title={ui?.title}
                              onClick={() =>
                                upsertRecord(key, s.id, {
                                  status: nextStatus(entry.status ?? null),
                                })
                              }
                            >
                              {cellLabel}
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
                onClick={() => markAllToday("done")}
                className="px-3 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Đánh dấu hôm nay: ✓
              </button>
              <button
                onClick={() => markAllToday("partial")}
                className="px-3 py-2 rounded-xl bg-amber-500 text-white hover:bg-amber-600"
              >
                Đánh dấu hôm nay: ½
              </button>
              <button
                onClick={() => markAllToday("miss")}
                className="px-3 py-2 rounded-xl bg-rose-500 text-white hover:bg-rose-600"
              >
                Đánh dấu hôm nay: •
              </button>
            </div>
          )}
        </section>

        {/* Today Panel */}
        <section className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-lg font-semibold">
            🗓️ Ngày: {DATE_FMT.toLabel(selectedDate)}
          </h2>
          {subjects.length === 0 ? (
            <p className="mt-2 text-slate-600">Chưa có môn nào.</p>
          ) : (
            <div className="mt-2 flex flex-col gap-3">
              {subjects.map((s: Subject) => {
                const key = DATE_FMT.toKey(selectedDate);
                const entry = getEntry(key, s.id);
                const minutes = entry.minutes || 0;
                const st =
                  statusFromMinutes(minutes, s.targetMin) ??
                  (entry.status ?? null);
                const ui =
                  STATUS_UI[
                    (st ?? "null") as "null" | "miss" | "partial" | "done"
                  ];
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
                          st === "done"
                            ? "bg-emerald-100 border-emerald-200"
                            : st === "partial"
                            ? "bg-amber-100 border-amber-200"
                            : st === "miss"
                            ? "bg-rose-100 border-rose-200"
                            : "bg-white"
                        }`}
                      onClick={() =>
                        upsertRecord(key, s.id, {
                          status: nextStatus(entry.status ?? null),
                        })
                      }
                      title={ui?.title}
                    >
                      {ui?.label ?? "—"}
                    </button>
                    <input
                      type="number"
                      className="w-24 px-2 py-1 rounded-lg bg-slate-50 border"
                      placeholder="phút"
                      min={0}
                      value={entry.minutes ?? ""}
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
                      value={entry.note || ""}
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

        {/* Timer Panel */}
        <section className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-lg font-semibold">⏱️ Bộ đếm thời gian</h2>
          {subjects.length === 0 ? (
            <p className="mt-2 text-slate-600">
              Thêm môn trước khi bấm giờ.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {!activeTimer ? (
                <>
                  <div className="flex items-center gap-2">
                    <select
                      className="px-3 py-2 rounded-xl bg-slate-50 border flex-1"
                      value={timerSubjectId || ""}
                      onChange={(e) => setTimerSubjectId(e.target.value)}
                    >
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      className="w-24 px-3 py-2 rounded-xl bg-slate-50 border"
                      value={timerDurationMin}
                      onChange={(e) =>
                        setTimerDurationMin(Number(e.target.value) || 25)
                      }
                      title="Thời lượng (phút)"
                    />
                    <button
                      onClick={startTimer}
                      className="px-3 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                    >
                      Bắt đầu
                    </button>
                  </div>
                  <div className="flex gap-2">
                    {[25, 30, 45, 60].map((m) => (
                      <button
                        key={m}
                        onClick={() => setTimerDurationMin(m)}
                        className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm"
                      >
                        {m}′
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-slate-600">
                      Môn:&nbsp;
                      <b>
                        {subjects.find((x) => x.id === activeTimer.subjectId)
                          ?.name || "—"}
                      </b>
                      &nbsp;•&nbsp; Ngày:&nbsp;
                      <b>
                        {DATE_FMT.toLabel(
                          DATE_FMT.fromKey(activeTimer.dateKey)
                        )}
                      </b>
                    </div>
                    <div className="text-3xl font-mono font-bold">
                      {formatMMSS(remainingSec(activeTimer))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {activeTimer.isRunning ? (
                      <button
                        onClick={pauseTimer}
                        className="px-3 py-2 rounded-xl bg-amber-500 text-white hover:bg-amber-600"
                      >
                        Tạm dừng
                      </button>
                    ) : (
                      <button
                        onClick={resumeTimer}
                        className="px-3 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                      >
                        Tiếp tục
                      </button>
                    )}
                    <button
                      onClick={() => stopTimer(true)}
                      className="px-3 py-2 rounded-xl bg-slate-900 text-white hover:bg-black"
                      title="Kết thúc và cộng phút đã học (làm tròn xuống phút)"
                    >
                      Kết thúc & cộng phút
                    </button>
                    <button
                      onClick={() => stopTimer(false)}
                      className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200"
                      title="Hủy timer không cộng phút"
                    >
                      Hủy
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">
                    Mẹo: Đóng/trở lại trang vẫn giữ đồng hồ. Hết thời lượng sẽ tự
                    cộng phút và dừng.
                  </p>
                </>
              )}
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
                className="color-input w-14 h-10 rounded-xl border p-0"
              />
            <input
              type="number"
              min={0}
              className="w-24 px-3 py-2 rounded-xl bg-slate-50 border"
              value={newTarget}
              onChange={(e) => setNewTarget(Number(e.target.value) || 0)}
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
              {subjects.map((s: Subject) => (
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
                    className="color-input w-14 h-10 rounded-xl border p-0"
                  />
                  <input
                    type="number"
                    min={0}
                    className="w-24 px-2 py-1 rounded-lg bg-slate-50 border"
                    value={s.targetMin || 0}
                    onChange={(e) =>
                      retargetSubject(s.id, Number(e.target.value) || 0)
                    }
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
              {subjects.map((s: Subject) => (
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

      {/* Tips */}
      <div className="mt-6 text-xs text-slate-500">
        <p>
          Gợi ý: Nhấn vào mỗi ô để chuyển trạng thái (— → • → ½ → ✓). Khi có
          phút học, ô sẽ hiển thị số phút và tự tô màu theo mục tiêu.
        </p>
        <p className="mt-1">
          Dữ liệu lưu cục bộ (localStorage). Có thể Nhập/Xuất để sao lưu hoặc
          chuyển máy.
        </p>
      </div>
    </div>
  </div>
);
}