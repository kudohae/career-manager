/**
 * CareerManager.jsx
 * 
 * 커리어 관리 웹앱 — 단일 파일, 컴포넌트 분리 구조
 * 
 * 컴포넌트 구조:
 *  <App>
 *    <Sidebar />          — 네비게이션
 *    <CountdownBanner />  — 최근 D-Day 카운트다운
 *    <Dashboard />        — 홈 요약
 *    <Library />          — 강의 자료실
 *    <Certificates />     — 자격증 보관함
 *    <Scheduler />        — 학습 스케줄러 (주간/월간)
 *
 * LocalStorage 키:
 *   career_library       — 강의 자료 (Section[], File[])
 *   career_certs         — 자격증 카드 (Cert[])
 *   career_events        — 일정/시험 (Event[])
 *
 * JSON 스키마:
 *   Section: { id, subject, color, files: [{ id, name, date, size, type }] }
 *   Cert:    { id, name, issuer, date, expiry, note, color }
 *   Event:   { id, title, date (YYYY-MM-DD), type, note, isDday }
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  BookOpen, Award, Calendar, LayoutDashboard, Plus, Trash2,
  Upload, ChevronLeft, ChevronRight, X, Edit2, Check,
  Clock, FileText, Image, File, FolderOpen, AlertCircle,
  GraduationCap, TrendingUp, Zap
} from "lucide-react";

// ─────────────────────────────────────────────
// 1. STORAGE HELPERS
// ─────────────────────────────────────────────
const KEYS = {
  library: "career_library",
  certs: "career_certs",
  events: "career_events",
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

// ─────────────────────────────────────────────
// 2. UTILITIES
// ─────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function today() {
  return new Date().toISOString().split("T")[0];
}
function diffDays(dateStr) {
  const t = new Date(dateStr);
  t.setHours(0, 0, 0, 0);
  const n = new Date();
  n.setHours(0, 0, 0, 0);
  return Math.round((t - n) / 86400000);
}
function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}
function dDayLabel(diff) {
  if (diff === 0) return "D-Day";
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

const SECTION_COLORS = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b",
  "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"
];
const CERT_COLORS = [
  "#1e293b", "#1e3a5f", "#14532d", "#7c2d12",
  "#312e81", "#4a1942", "#064e3b", "#1c1917"
];
const EVENT_TYPES = {
  exam: { label: "시험", color: "#ef4444" },
  study: { label: "학습", color: "#6366f1" },
  cert: { label: "자격증", color: "#10b981" },
  other: { label: "기타", color: "#94a3b8" },
};

// ─────────────────────────────────────────────
// 3. SHARED UI PRIMITIVES
// ─────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}>
      <div className="relative w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: "var(--border)" }}>
          <span className="font-semibold text-base" style={{ color: "var(--text-primary)" }}>{title}</span>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 transition-colors">
            <X size={16} style={{ color: "var(--text-muted)" }} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function Input({ label, ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>{label}</label>}
      <input
        {...props}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none transition-all"
        style={{
          background: "var(--input-bg)",
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
        }}
      />
    </div>
  );
}

function Textarea({ label, ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>{label}</label>}
      <textarea
        {...props}
        rows={3}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
        style={{
          background: "var(--input-bg)",
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
        }}
      />
    </div>
  );
}

function Select({ label, children, ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>{label}</label>}
      <select
        {...props}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
        style={{
          background: "var(--input-bg)",
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
        }}
      >
        {children}
      </select>
    </div>
  );
}

function Btn({ variant = "primary", size = "md", children, ...props }) {
  const base = "inline-flex items-center gap-2 rounded-lg font-medium transition-all cursor-pointer disabled:opacity-40";
  const sz = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  const v = variant === "primary"
    ? "text-white shadow-sm hover:opacity-90"
    : variant === "ghost"
      ? "hover:bg-white/10"
      : "border hover:bg-white/5";
  return (
    <button
      {...props}
      className={`${base} ${sz} ${v}`}
      style={
        variant === "primary"
          ? { background: "var(--accent)", ...(props.style || {}) }
          : { borderColor: "var(--border)", color: "var(--text-secondary)", ...(props.style || {}) }
      }
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────
// 4. COUNTDOWN BANNER
// ─────────────────────────────────────────────
function CountdownBanner({ events }) {
  const upcoming = useMemo(() => {
    return events
      .filter(e => e.isDday)
      .map(e => ({ ...e, diff: diffDays(e.date) }))
      .filter(e => e.diff >= 0)
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 3);
  }, [events]);

  if (!upcoming.length) return null;

  return (
    <div className="flex gap-3 flex-wrap mb-6">
      {upcoming.map(e => (
        <div key={e.id}
          className="flex items-center gap-3 rounded-xl px-4 py-3 flex-1 min-w-[200px]"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="rounded-lg p-2"
            style={{ background: EVENT_TYPES[e.type]?.color + "22" }}>
            <Zap size={14} style={{ color: EVENT_TYPES[e.type]?.color }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{e.title}</div>
            <div className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{formatDate(e.date)}</div>
          </div>
          <div className="text-lg font-bold tabular-nums"
            style={{ color: e.diff === 0 ? "#ef4444" : "var(--accent)" }}>
            {dDayLabel(e.diff)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// 5. DASHBOARD
// ─────────────────────────────────────────────
function Dashboard({ library, certs, events, setPage }) {
  const totalFiles = library.reduce((a, s) => a + s.files.length, 0);
  const nextExam = events
    .filter(e => e.isDday && diffDays(e.date) >= 0)
    .sort((a, b) => diffDays(a.date) - diffDays(b.date))[0];
  const recentEvents = [...events]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 4);

  const stats = [
    { icon: BookOpen, label: "강의 섹션", value: library.length, color: "#6366f1", page: "library" },
    { icon: FileText, label: "학습 자료", value: totalFiles, color: "#0ea5e9", page: "library" },
    { icon: Award, label: "보유 자격증", value: certs.length, color: "#10b981", page: "certs" },
    { icon: Calendar, label: "등록 일정", value: events.length, color: "#f59e0b", page: "scheduler" },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
        대시보드
      </h2>
      <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
        {new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}
      </p>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-6 lg:grid-cols-4">
        {stats.map(s => (
          <button key={s.label} onClick={() => setPage(s.page)}
            className="rounded-xl p-4 text-left transition-all hover:scale-[1.02] hover:shadow-lg cursor-pointer"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="rounded-lg p-2" style={{ background: s.color + "22" }}>
                <s.icon size={16} style={{ color: s.color }} />
              </div>
              <span className="text-2xl font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>{s.value}</span>
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{s.label}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Next Exam */}
        <div className="rounded-xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle size={14} style={{ color: "#ef4444" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>다음 D-Day</span>
          </div>
          {nextExam ? (
            <div className="flex items-center gap-4">
              <div className="rounded-xl px-4 py-3 text-center min-w-[80px]"
                style={{ background: "var(--accent)" + "22", border: "1px solid var(--accent)" + "44" }}>
                <div className="text-3xl font-black tabular-nums" style={{ color: "var(--accent)" }}>
                  {dDayLabel(diffDays(nextExam.date))}
                </div>
              </div>
              <div>
                <div className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{nextExam.title}</div>
                <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{formatDate(nextExam.date)}</div>
                <div className="text-xs mt-1 rounded px-2 py-0.5 inline-block"
                  style={{ background: EVENT_TYPES[nextExam.type]?.color + "22", color: EVENT_TYPES[nextExam.type]?.color }}>
                  {EVENT_TYPES[nextExam.type]?.label}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>등록된 D-Day 일정이 없습니다.</p>
          )}
        </div>

        {/* Recent Events */}
        <div className="rounded-xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 mb-4">
            <Clock size={14} style={{ color: "var(--accent)" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>최근 일정</span>
          </div>
          {recentEvents.length ? (
            <ul className="flex flex-col gap-2">
              {recentEvents.map(e => (
                <li key={e.id} className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: EVENT_TYPES[e.type]?.color }} />
                  <span className="text-sm flex-1 truncate" style={{ color: "var(--text-secondary)" }}>{e.title}</span>
                  <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>{formatDate(e.date)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>등록된 일정이 없습니다.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 6. LIBRARY — 강의 자료실
// ─────────────────────────────────────────────
function getFileIcon(name = "") {
  const ext = name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext)) return Image;
  if (["pdf"].includes(ext)) return FileText;
  return File;
}

function Library({ library, setLibrary }) {
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSection, setNewSection] = useState({ subject: "", color: SECTION_COLORS[0] });
  const [uploadTarget, setUploadTarget] = useState(null); // sectionId
  const [uploadName, setUploadName] = useState("");
  const [uploadType, setUploadType] = useState("pdf");
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");

  function addSection() {
    if (!newSection.subject.trim()) return;
    const updated = [...library, { id: uid(), subject: newSection.subject.trim(), color: newSection.color, files: [] }];
    setLibrary(updated);
    save(KEYS.library, updated);
    setNewSection({ subject: "", color: SECTION_COLORS[0] });
    setShowAddSection(false);
  }

  function deleteSection(id) {
    const updated = library.filter(s => s.id !== id);
    setLibrary(updated);
    save(KEYS.library, updated);
  }

  function addFile(sectionId) {
    if (!uploadName.trim()) return;
    const updated = library.map(s => s.id !== sectionId ? s : {
      ...s,
      files: [...s.files, {
        id: uid(), name: uploadName.trim() + "." + uploadType,
        date: today(), size: Math.floor(Math.random() * 4096 + 128) + "KB", type: uploadType
      }]
    });
    setLibrary(updated);
    save(KEYS.library, updated);
    setUploadTarget(null);
    setUploadName("");
    setUploadType("pdf");
  }

  function deleteFile(sectionId, fileId) {
    const updated = library.map(s => s.id !== sectionId ? s : {
      ...s, files: s.files.filter(f => f.id !== fileId)
    });
    setLibrary(updated);
    save(KEYS.library, updated);
  }

  function startEdit(s) { setEditId(s.id); setEditName(s.subject); }
  function saveEdit(id) {
    if (!editName.trim()) { setEditId(null); return; }
    const updated = library.map(s => s.id !== id ? s : { ...s, subject: editName.trim() });
    setLibrary(updated);
    save(KEYS.library, updated);
    setEditId(null);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>강의 자료실</h2>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>과목별 섹션으로 학습 자료를 관리합니다</p>
        </div>
        <Btn onClick={() => setShowAddSection(true)}><Plus size={14} />새 섹션</Btn>
      </div>

      {library.length === 0 && (
        <div className="rounded-xl p-12 text-center" style={{ border: "1.5px dashed var(--border)" }}>
          <FolderOpen size={36} className="mx-auto mb-3 opacity-30" style={{ color: "var(--text-muted)" }} />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>섹션이 없습니다. 새 섹션을 추가해보세요.</p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {library.map(section => {
          const Icon = getFileIcon;
          return (
            <div key={section.id} className="rounded-xl overflow-hidden"
              style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>
              {/* Section Header */}
              <div className="flex items-center gap-3 px-5 py-3.5"
                style={{ borderBottom: "1px solid var(--border)", borderLeft: `3px solid ${section.color}` }}>
                <div className="w-2 h-2 rounded-full" style={{ background: section.color }} />
                {editId === section.id ? (
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && saveEdit(section.id)}
                    className="flex-1 bg-transparent text-sm font-semibold outline-none border-b"
                    style={{ color: "var(--text-primary)", borderColor: section.color }}
                    autoFocus
                  />
                ) : (
                  <span className="flex-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{section.subject}</span>
                )}
                <span className="text-xs mr-2" style={{ color: "var(--text-muted)" }}>{section.files.length}개 파일</span>
                {editId === section.id ? (
                  <button onClick={() => saveEdit(section.id)} className="p-1 hover:opacity-70">
                    <Check size={13} style={{ color: section.color }} />
                  </button>
                ) : (
                  <button onClick={() => startEdit(section)} className="p-1 hover:opacity-70">
                    <Edit2 size={13} style={{ color: "var(--text-muted)" }} />
                  </button>
                )}
                <button onClick={() => setUploadTarget(section.id)}
                  className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg hover:opacity-80 transition-all"
                  style={{ background: section.color + "22", color: section.color }}>
                  <Upload size={11} />파일 추가
                </button>
                <button onClick={() => deleteSection(section.id)} className="p-1 hover:opacity-70">
                  <Trash2 size={13} style={{ color: "#ef4444" }} />
                </button>
              </div>

              {/* Files */}
              {section.files.length === 0 ? (
                <div className="px-5 py-4 text-xs" style={{ color: "var(--text-muted)" }}>
                  파일이 없습니다. 위 버튼으로 추가하세요.
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: "var(--border)" + "66" }}>
                  {section.files.map(f => {
                    const FIcon = getFileIcon(f.name);
                    return (
                      <div key={f.id} className="flex items-center gap-3 px-5 py-3 hover:bg-white/5 transition-colors">
                        <FIcon size={15} style={{ color: section.color, flexShrink: 0 }} />
                        <span className="flex-1 text-sm truncate" style={{ color: "var(--text-secondary)" }}>{f.name}</span>
                        <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>{f.size}</span>
                        <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>{formatDate(f.date)}</span>
                        <button onClick={() => deleteFile(section.id, f.id)} className="p-1 hover:opacity-70">
                          <Trash2 size={12} style={{ color: "#ef4444" }} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Section Modal */}
      {showAddSection && (
        <Modal title="새 섹션 추가" onClose={() => setShowAddSection(false)}>
          <div className="flex flex-col gap-4">
            <Input label="과목명" value={newSection.subject}
              onChange={e => setNewSection(p => ({ ...p, subject: e.target.value }))}
              placeholder="예: NCS 직업기초능력, 영어, 경제학 원론" />
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>색상</label>
              <div className="flex gap-2 flex-wrap">
                {SECTION_COLORS.map(c => (
                  <button key={c} onClick={() => setNewSection(p => ({ ...p, color: c }))}
                    className="w-7 h-7 rounded-full transition-all hover:scale-110"
                    style={{ background: c, outline: newSection.color === c ? `2px solid white` : "none", outlineOffset: "2px" }} />
                ))}
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Btn variant="outline" onClick={() => setShowAddSection(false)}>취소</Btn>
              <Btn onClick={addSection}>추가</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Upload File Modal */}
      {uploadTarget && (
        <Modal title="파일 추가 (시뮬레이션)" onClose={() => setUploadTarget(null)}>
          <div className="flex flex-col gap-4">
            <div className="rounded-lg p-3 text-xs" style={{ background: "var(--accent)" + "11", color: "var(--accent)", border: "1px solid " + "var(--accent)" + "33" }}>
              실제 파일 저장 없이 파일명과 날짜만 기록됩니다.
            </div>
            <Input label="파일명 (확장자 제외)" value={uploadName}
              onChange={e => setUploadName(e.target.value)}
              placeholder="예: 1주차 강의노트" />
            <Select label="파일 형식" value={uploadType} onChange={e => setUploadType(e.target.value)}>
              <option value="pdf">PDF</option>
              <option value="docx">DOCX</option>
              <option value="pptx">PPTX</option>
              <option value="xlsx">XLSX</option>
              <option value="mp4">MP4</option>
              <option value="jpg">JPG</option>
              <option value="png">PNG</option>
              <option value="zip">ZIP</option>
            </Select>
            <div className="flex gap-2 justify-end pt-2">
              <Btn variant="outline" onClick={() => setUploadTarget(null)}>취소</Btn>
              <Btn onClick={() => addFile(uploadTarget)}><Upload size={13} />추가</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 7. CERTIFICATES — 자격증 보관함
// ─────────────────────────────────────────────
function Certificates({ certs, setCerts }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", issuer: "", date: "", expiry: "", note: "", color: CERT_COLORS[0] });
  const [deleteId, setDeleteId] = useState(null);

  function f(k) { return e => setForm(p => ({ ...p, [k]: e.target.value })); }

  function addCert() {
    if (!form.name.trim()) return;
    const updated = [...certs, { ...form, id: uid(), name: form.name.trim() }];
    setCerts(updated);
    save(KEYS.certs, updated);
    setForm({ name: "", issuer: "", date: "", expiry: "", note: "", color: CERT_COLORS[0] });
    setShowAdd(false);
  }

  function deleteCert(id) {
    const updated = certs.filter(c => c.id !== id);
    setCerts(updated);
    save(KEYS.certs, updated);
    setDeleteId(null);
  }

  function expiryStatus(expiry) {
    if (!expiry) return null;
    const diff = diffDays(expiry);
    if (diff < 0) return { text: "만료됨", color: "#ef4444" };
    if (diff < 90) return { text: `${diff}일 후 만료`, color: "#f59e0b" };
    return { text: `유효 (${formatDate(expiry)}까지)`, color: "#10b981" };
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>자격증 보관함</h2>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>취득한 자격증을 카드로 관리합니다</p>
        </div>
        <Btn onClick={() => setShowAdd(true)}><Plus size={14} />자격증 추가</Btn>
      </div>

      {certs.length === 0 && (
        <div className="rounded-xl p-12 text-center" style={{ border: "1.5px dashed var(--border)" }}>
          <Award size={36} className="mx-auto mb-3 opacity-30" style={{ color: "var(--text-muted)" }} />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>자격증이 없습니다. 추가해보세요.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {certs.map(cert => {
          const status = expiryStatus(cert.expiry);
          return (
            <div key={cert.id}
              className="rounded-xl overflow-hidden relative group transition-all hover:scale-[1.02] hover:shadow-xl"
              style={{ background: cert.color, border: "1px solid " + cert.color }}>
              {/* Card top */}
              <div className="p-5 pb-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.12)" }}>
                    <Award size={18} style={{ color: "rgba(255,255,255,0.9)" }} />
                  </div>
                  <button onClick={() => setDeleteId(cert.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.15)" }}>
                    <Trash2 size={13} style={{ color: "rgba(255,255,255,0.8)" }} />
                  </button>
                </div>
                <h3 className="mt-4 text-base font-bold leading-tight" style={{ color: "rgba(255,255,255,0.95)" }}>
                  {cert.name}
                </h3>
                {cert.issuer && (
                  <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.6)" }}>{cert.issuer}</p>
                )}
              </div>
              {/* Card bottom */}
              <div className="px-5 py-3 flex items-center justify-between"
                style={{ background: "rgba(0,0,0,0.2)" }}>
                <span className="text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>
                  취득: {formatDate(cert.date) || "-"}
                </span>
                {status && (
                  <span className="text-xs rounded-full px-2 py-0.5"
                    style={{ background: status.color + "33", color: status.color }}>
                    {status.text}
                  </span>
                )}
              </div>
              {cert.note && (
                <div className="px-5 py-2 text-xs" style={{ color: "rgba(255,255,255,0.5)", background: "rgba(0,0,0,0.15)" }}>
                  {cert.note}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Modal */}
      {showAdd && (
        <Modal title="자격증 추가" onClose={() => setShowAdd(false)}>
          <div className="flex flex-col gap-3">
            <Input label="자격증명 *" value={form.name} onChange={f("name")} placeholder="예: TOEIC 900, 정보처리기사" />
            <Input label="발급 기관" value={form.issuer} onChange={f("issuer")} placeholder="예: ETS, 한국산업인력공단" />
            <div className="grid grid-cols-2 gap-3">
              <Input label="취득일" type="date" value={form.date} onChange={f("date")} />
              <Input label="만료일" type="date" value={form.expiry} onChange={f("expiry")} />
            </div>
            <Textarea label="메모" value={form.note} onChange={f("note")} placeholder="점수, 갱신 요건 등" />
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>카드 색상</label>
              <div className="flex gap-2 flex-wrap">
                {CERT_COLORS.map(c => (
                  <button key={c} onClick={() => setForm(p => ({ ...p, color: c }))}
                    className="w-7 h-7 rounded-full border-2 transition-all hover:scale-110"
                    style={{ background: c, borderColor: form.color === c ? "white" : "transparent" }} />
                ))}
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Btn variant="outline" onClick={() => setShowAdd(false)}>취소</Btn>
              <Btn onClick={addCert}>추가</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirm Modal */}
      {deleteId && (
        <Modal title="삭제 확인" onClose={() => setDeleteId(null)}>
          <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
            이 자격증을 삭제하시겠습니까?
          </p>
          <div className="flex gap-2 justify-end">
            <Btn variant="outline" onClick={() => setDeleteId(null)}>취소</Btn>
            <Btn onClick={() => deleteCert(deleteId)} style={{ background: "#ef4444" }}>삭제</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 8. SCHEDULER — 주간/월간 캘린더 + D-Day
// ─────────────────────────────────────────────
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function Scheduler({ events, setEvents }) {
  const [view, setView] = useState("month"); // "week" | "month"
  const [cursor, setCursor] = useState(new Date());
  const [showAdd, setShowAdd] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [form, setForm] = useState({ title: "", date: today(), type: "exam", note: "", isDday: true });

  function f(k) { return e => setForm(p => ({ ...p, [k]: e.target.value })); }
  function fBool(k) { return e => setForm(p => ({ ...p, [k]: e.target.checked })); }

  function addEvent() {
    if (!form.title.trim() || !form.date) return;
    const updated = [...events, { ...form, id: uid(), title: form.title.trim() }];
    setEvents(updated);
    save(KEYS.events, updated);
    setForm({ title: "", date: today(), type: "exam", note: "", isDday: true });
    setShowAdd(false);
  }

  function deleteEvent(id) {
    const updated = events.filter(e => e.id !== id);
    setEvents(updated);
    save(KEYS.events, updated);
  }

  // ── Month View ──
  function getMonthGrid(date) {
    const year = date.getFullYear(), month = date.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(null);
    for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  function eventsOnDate(date) {
    if (!date) return [];
    const ds = date.toISOString().split("T")[0];
    return events.filter(e => e.date === ds);
  }

  function navMonth(dir) {
    setCursor(prev => new Date(prev.getFullYear(), prev.getMonth() + dir, 1));
  }

  // ── Week View ──
  function getWeekDates(date) {
    const d = new Date(date);
    const day = d.getDay();
    const sun = new Date(d);
    sun.setDate(d.getDate() - day);
    return Array.from({ length: 7 }, (_, i) => {
      const x = new Date(sun);
      x.setDate(sun.getDate() + i);
      return x;
    });
  }

  function navWeek(dir) {
    setCursor(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() + dir * 7);
      return d;
    });
  }

  const todayStr = today();
  const monthGrid = getMonthGrid(cursor);
  const weekDates = getWeekDates(cursor);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>학습 스케줄러</h2>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>시험 일정 및 D-Day 관리</p>
        </div>
        <div className="flex gap-2">
          {/* View Toggle */}
          <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            {["month", "week"].map(v => (
              <button key={v}
                onClick={() => setView(v)}
                className="px-3 py-1.5 text-xs font-medium transition-all"
                style={{
                  background: view === v ? "var(--accent)" : "transparent",
                  color: view === v ? "white" : "var(--text-muted)"
                }}>
                {v === "month" ? "월간" : "주간"}
              </button>
            ))}
          </div>
          <Btn onClick={() => { setSelectedDate(today()); setForm(p => ({ ...p, date: today() })); setShowAdd(true); }}>
            <Plus size={14} />일정 추가
          </Btn>
        </div>
      </div>

      {/* Nav */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => view === "month" ? navMonth(-1) : navWeek(-1)}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
          <ChevronLeft size={16} style={{ color: "var(--text-muted)" }} />
        </button>
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {view === "month"
            ? cursor.toLocaleDateString("ko-KR", { year: "numeric", month: "long" })
            : `${weekDates[0].toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} – ${weekDates[6].toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}`
          }
        </span>
        <button onClick={() => view === "month" ? navMonth(1) : navWeek(1)}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
          <ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
        </button>
      </div>

      {/* Month View */}
      {view === "month" && (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div className="grid grid-cols-7">
            {WEEKDAYS.map((d, i) => (
              <div key={d} className="py-2 text-center text-xs font-medium"
                style={{
                  color: i === 0 ? "#ef4444" : i === 6 ? "#6366f1" : "var(--text-muted)",
                  background: "var(--surface)",
                  borderBottom: "1px solid var(--border)"
                }}>
                {d}
              </div>
            ))}
            {monthGrid.map((day, i) => {
              const dayEvents = eventsOnDate(day);
              const ds = day?.toISOString().split("T")[0];
              const isToday = ds === todayStr;
              const isWeekend = day && (day.getDay() === 0 || day.getDay() === 6);
              return (
                <div key={i}
                  onClick={() => {
                    if (day) {
                      setSelectedDate(ds);
                      setForm(p => ({ ...p, date: ds }));
                      setShowAdd(true);
                    }
                  }}
                  className="min-h-[80px] p-1.5 cursor-pointer hover:bg-white/5 transition-colors"
                  style={{
                    background: day ? "transparent" : "var(--surface)" + "44",
                    borderRight: (i + 1) % 7 !== 0 ? "1px solid var(--border)" : "none",
                    borderBottom: i < monthGrid.length - 7 ? "1px solid var(--border)" : "none",
                  }}>
                  {day && (
                    <>
                      <div className="flex justify-end">
                        <span className={`text-xs w-6 h-6 flex items-center justify-center rounded-full font-medium`}
                          style={{
                            background: isToday ? "var(--accent)" : "transparent",
                            color: isToday ? "white" : isWeekend ? (day.getDay() === 0 ? "#ef4444" : "#6366f1") : "var(--text-muted)"
                          }}>
                          {day.getDate()}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5 mt-0.5">
                        {dayEvents.slice(0, 2).map(e => (
                          <div key={e.id}
                            onClick={ev => { ev.stopPropagation(); }}
                            className="text-xs rounded px-1 py-0.5 truncate flex items-center justify-between group"
                            style={{ background: EVENT_TYPES[e.type]?.color + "22", color: EVENT_TYPES[e.type]?.color }}>
                            <span className="truncate">{e.isDday && "★ "}{e.title}</span>
                            <button onClick={ev => { ev.stopPropagation(); deleteEvent(e.id); }}
                              className="opacity-0 group-hover:opacity-100 ml-1 flex-shrink-0">
                              <X size={9} />
                            </button>
                          </div>
                        ))}
                        {dayEvents.length > 2 && (
                          <div className="text-xs px-1" style={{ color: "var(--text-muted)" }}>+{dayEvents.length - 2}개</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Week View */}
      {view === "week" && (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div className="grid grid-cols-7">
            {weekDates.map((day, i) => {
              const ds = day.toISOString().split("T")[0];
              const isToday = ds === todayStr;
              const dayEvents = eventsOnDate(day);
              return (
                <div key={i}
                  className="cursor-pointer hover:bg-white/5 transition-colors"
                  onClick={() => { setSelectedDate(ds); setForm(p => ({ ...p, date: ds })); setShowAdd(true); }}
                  style={{ borderRight: i < 6 ? "1px solid var(--border)" : "none" }}>
                  <div className="py-2 text-center"
                    style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
                    <div className="text-xs mb-1" style={{ color: i === 0 ? "#ef4444" : i === 6 ? "#6366f1" : "var(--text-muted)" }}>
                      {WEEKDAYS[i]}
                    </div>
                    <div className={`text-base font-bold mx-auto w-8 h-8 flex items-center justify-center rounded-full`}
                      style={{
                        background: isToday ? "var(--accent)" : "transparent",
                        color: isToday ? "white" : "var(--text-primary)"
                      }}>
                      {day.getDate()}
                    </div>
                  </div>
                  <div className="p-1 min-h-[120px] flex flex-col gap-1">
                    {dayEvents.map(e => (
                      <div key={e.id}
                        onClick={ev => ev.stopPropagation()}
                        className="text-xs rounded px-1.5 py-1 group flex items-start justify-between"
                        style={{ background: EVENT_TYPES[e.type]?.color + "22", color: EVENT_TYPES[e.type]?.color }}>
                        <span className="truncate leading-tight">{e.isDday && "★ "}{e.title}</span>
                        <button onClick={ev => { ev.stopPropagation(); deleteEvent(e.id); }}
                          className="opacity-0 group-hover:opacity-100 flex-shrink-0 ml-1">
                          <X size={9} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Event List */}
      <div className="mt-6">
        <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>등록된 일정 ({events.length})</h3>
        {events.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>일정이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {[...events].sort((a, b) => new Date(a.date) - new Date(b.date)).map(e => {
              const diff = diffDays(e.date);
              return (
                <div key={e.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: EVENT_TYPES[e.type]?.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                      {e.isDday && <span className="mr-1" style={{ color: "var(--accent)" }}>★</span>}{e.title}
                    </div>
                    {e.note && <div className="text-xs truncate mt-0.5" style={{ color: "var(--text-muted)" }}>{e.note}</div>}
                  </div>
                  <div className="text-xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>{formatDate(e.date)}</div>
                  {e.isDday && (
                    <div className="text-xs font-bold tabular-nums flex-shrink-0 px-2 py-0.5 rounded-full"
                      style={{
                        background: diff < 0 ? "#94a3b822" : diff === 0 ? "#ef444422" : "var(--accent)" + "22",
                        color: diff < 0 ? "#94a3b8" : diff === 0 ? "#ef4444" : "var(--accent)"
                      }}>
                      {dDayLabel(diff)}
                    </div>
                  )}
                  <button onClick={() => deleteEvent(e.id)} className="p-1 hover:opacity-70 flex-shrink-0">
                    <Trash2 size={12} style={{ color: "#ef4444" }} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Event Modal */}
      {showAdd && (
        <Modal title="일정 추가" onClose={() => setShowAdd(false)}>
          <div className="flex flex-col gap-3">
            <Input label="제목 *" value={form.title} onChange={f("title")} placeholder="예: TOEIC 시험, NCS 모의고사" />
            <Input label="날짜 *" type="date" value={form.date} onChange={f("date")} />
            <Select label="유형" value={form.type} onChange={f("type")}>
              {Object.entries(EVENT_TYPES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
            <Textarea label="메모" value={form.note} onChange={f("note")} placeholder="장소, 준비물 등" />
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isDday} onChange={fBool("isDday")}
                className="w-4 h-4 rounded" />
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>D-Day 카운트다운 표시</span>
            </label>
            <div className="flex gap-2 justify-end pt-2">
              <Btn variant="outline" onClick={() => setShowAdd(false)}>취소</Btn>
              <Btn onClick={addEvent}><Plus size={13} />추가</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 9. SIDEBAR
// ─────────────────────────────────────────────
function Sidebar({ page, setPage, certs, events }) {
  const upcoming = events.filter(e => e.isDday && diffDays(e.date) >= 0).length;
  const navItems = [
    { id: "dashboard", label: "대시보드", icon: LayoutDashboard },
    { id: "library", label: "강의 자료실", icon: BookOpen },
    { id: "certs", label: "자격증 보관함", icon: Award, badge: certs.length },
    { id: "scheduler", label: "학습 스케줄러", icon: Calendar, badge: upcoming || null },
  ];

  return (
    <nav className="flex flex-col h-full" style={{ width: "220px", minWidth: "220px" }}>
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-2.5 mb-2">
        <div className="rounded-xl p-2" style={{ background: "var(--accent)" }}>
          <GraduationCap size={16} style={{ color: "white" }} />
        </div>
        <div>
          <div className="text-sm font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)", letterSpacing: "-0.01em" }}>
            CareerKit
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>커리어 관리</div>
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 flex flex-col gap-0.5 px-3">
        {navItems.map(item => (
          <button key={item.id}
            onClick={() => setPage(item.id)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all w-full"
            style={{
              background: page === item.id ? "var(--accent)" + "18" : "transparent",
              color: page === item.id ? "var(--accent)" : "var(--text-secondary)",
              border: page === item.id ? "1px solid " + "var(--accent)" + "30" : "1px solid transparent",
            }}>
            <item.icon size={16} style={{ flexShrink: 0 }} />
            <span className="flex-1 text-sm font-medium">{item.label}</span>
            {item.badge > 0 && (
              <span className="text-xs rounded-full px-1.5 py-0.5 font-bold"
                style={{ background: "var(--accent)", color: "white", minWidth: "18px", textAlign: "center" }}>
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="px-5 py-4 mt-auto">
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          <TrendingUp size={11} className="inline mr-1" />
          데이터: 로컬 저장
        </div>
      </div>
    </nav>
  );
}

// ─────────────────────────────────────────────
// 10. ROOT APP
// ─────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("dashboard");
  const [library, setLibrary] = useState(() => load(KEYS.library, []));
  const [certs, setCerts] = useState(() => load(KEYS.certs, []));
  const [events, setEvents] = useState(() => load(KEYS.events, []));
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const theme = {
    "--bg": "#0b0f17",
    "--surface": "#141925",
    "--surface-2": "#1c2333",
    "--border": "#ffffff12",
    "--accent": "#6366f1",
    "--text-primary": "#f1f5f9",
    "--text-secondary": "#94a3b8",
    "--text-muted": "#4b5563",
    "--input-bg": "#1c2333",
    "--font-display": "'DM Serif Display', Georgia, serif",
  };

  const pageComponents = {
    dashboard: <Dashboard library={library} certs={certs} events={events} setPage={setPage} />,
    library: <Library library={library} setLibrary={setLibrary} />,
    certs: <Certificates certs={certs} setCerts={setCerts} />,
    scheduler: <Scheduler events={events} setEvents={setEvents} />,
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0b0f17; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #ffffff18; border-radius: 10px; }
        input[type=date]::-webkit-calendar-picker-indicator { filter: invert(0.5); }
        select option { background: #1c2333; }
      `}</style>
      <div style={{ ...theme, background: "var(--bg)", minHeight: "100vh", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
        <div className="flex h-screen overflow-hidden">
          {/* Sidebar — desktop */}
          <div className="hidden md:flex flex-col flex-shrink-0 py-2"
            style={{ borderRight: "1px solid var(--border)", background: "var(--surface)" }}>
            <Sidebar page={page} setPage={setPage} certs={certs} events={events} />
          </div>

          {/* Mobile overlay */}
          {sidebarOpen && (
            <div className="fixed inset-0 z-40 md:hidden">
              <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }}
                onClick={() => setSidebarOpen(false)} />
              <div className="absolute left-0 top-0 bottom-0 flex flex-col py-2"
                style={{ background: "var(--surface)", borderRight: "1px solid var(--border)", width: "240px" }}>
                <Sidebar page={page} setPage={(p) => { setPage(p); setSidebarOpen(false); }} certs={certs} events={events} />
              </div>
            </div>
          )}

          {/* Main */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Mobile topbar */}
            <div className="md:hidden flex items-center justify-between px-4 py-3"
              style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
              <button onClick={() => setSidebarOpen(true)} className="p-1.5 rounded-lg hover:bg-white/10">
                <LayoutDashboard size={18} style={{ color: "var(--text-muted)" }} />
              </button>
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>CareerKit</span>
              <div className="w-8" />
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <CountdownBanner events={events} />
              {pageComponents[page]}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}