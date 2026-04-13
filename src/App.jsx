import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  BookOpen, Award, Calendar, LayoutDashboard, Plus, Trash2,
  Upload, ChevronLeft, ChevronRight, X, Edit2, Check,
  Clock, FileText, Image, File, FolderOpen, AlertCircle,
  GraduationCap, Zap, LogOut, Cloud, CloudOff, RefreshCw,
  Download, Eye, Loader2, Menu
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// GOOGLE API CONFIG
// ─────────────────────────────────────────────────────────────
const CLIENT_ID = "406294571592-ufr5l29p3vvv4nfobec3ktosb8euj7gj.apps.googleusercontent.com";
const SCOPES = [
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");
const DATA_FILE_NAME = "career_data.json";
const FOLDER_NAME = "CareerKit Files";
const TOKEN_KEY = "career_gapi_token";
const TOKEN_EXPIRY_KEY = "career_gapi_expiry";

// ─────────────────────────────────────────────────────────────
// GOOGLE API LOADERS
// ─────────────────────────────────────────────────────────────
function loadScript(src, check) {
  return new Promise((resolve) => {
    if (check()) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = resolve;
    document.head.appendChild(s);
  });
}

async function initGapi() {
  await loadScript("https://apis.google.com/js/api.js", () => !!window.gapi);
  await new Promise((resolve) => window.gapi.load("client", resolve));
  await window.gapi.client.init({
    discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
  });
}

async function initGis() {
  await loadScript("https://accounts.google.com/gsi/client", () => !!window.google?.accounts);
}

// ─────────────────────────────────────────────────────────────
// TOKEN MANAGEMENT
// ─────────────────────────────────────────────────────────────
function saveToken(token) {
  const expiry = Date.now() + (token.expires_in - 60) * 1000;
  localStorage.setItem(TOKEN_KEY, token.access_token);
  localStorage.setItem(TOKEN_EXPIRY_KEY, String(expiry));
  window.gapi.client.setToken(token);
}

function loadCachedToken() {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiry = Number(localStorage.getItem(TOKEN_EXPIRY_KEY));
  if (token && expiry && Date.now() < expiry) {
    window.gapi.client.setToken({ access_token: token });
    return true;
  }
  return false;
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
  window.gapi.client.setToken(null);
}

// ─────────────────────────────────────────────────────────────
// DRIVE HELPERS — DATA FILE
// ─────────────────────────────────────────────────────────────
async function findFile(name, spaces = "appDataFolder") {
  const res = await window.gapi.client.drive.files.list({
    spaces, q: `name = '${name}' and trashed = false`, fields: "files(id,name)",
  });
  return res.result.files?.[0] || null;
}

async function readJsonFile(fileId) {
  const res = await window.gapi.client.drive.files.get({ fileId, alt: "media" });
  return typeof res.result === "string" ? JSON.parse(res.result) : res.result;
}

async function createJsonFile(name, data, parents = ["appDataFolder"]) {
  const boundary = "ck_boundary";
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({ name, parents }),
    `--${boundary}`,
    "Content-Type: application/json",
    "",
    JSON.stringify(data),
    `--${boundary}--`,
  ].join("\r\n");
  const res = await window.gapi.client.request({
    path: "https://www.googleapis.com/upload/drive/v3/files",
    method: "POST",
    params: { uploadType: "multipart", fields: "id" },
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return res.result.id;
}

async function updateJsonFile(fileId, data) {
  await window.gapi.client.request({
    path: `https://www.googleapis.com/upload/drive/v3/files/${fileId}`,
    method: "PATCH",
    params: { uploadType: "media" },
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

// ─────────────────────────────────────────────────────────────
// DRIVE HELPERS — REAL FILE UPLOAD
// ─────────────────────────────────────────────────────────────
async function getOrCreateFolder() {
  const existing = await findFile(FOLDER_NAME, "drive");
  if (existing) return existing.id;
  const res = await window.gapi.client.drive.files.create({
    resource: { name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" },
    fields: "id",
  });
  return res.result.id;
}

async function uploadFileToDrive(file, folderId) {
  const token = window.gapi.client.getToken()?.access_token;
  const metadata = { name: file.name, parents: [folderId] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,webViewLink",
    { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }
  );
  if (!res.ok) throw new Error("Upload failed: " + res.status);
  return await res.json();
}

async function deleteFileFromDrive(fileId) {
  await window.gapi.client.drive.files.delete({ fileId });
}

// ─────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }
function today() { return new Date().toISOString().split("T")[0]; }
function diffDays(dateStr) {
  const t = new Date(dateStr); t.setHours(0, 0, 0, 0);
  const n = new Date(); n.setHours(0, 0, 0, 0);
  return Math.round((t - n) / 86400000);
}
function formatDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}
function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}
function dDayLabel(diff) {
  if (diff === 0) return "D-Day";
  return diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
}

const SECTION_COLORS = ["#6366f1","#0ea5e9","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#14b8a6"];
const CERT_COLORS    = ["#1e293b","#1e3a5f","#14532d","#7c2d12","#312e81","#4a1942","#064e3b","#334155"];
const EVENT_TYPES = {
  exam:  { label: "\uC2DC\uD5D8",       color: "#ef4444" },
  study: { label: "\uD559\uC2B5",       color: "#6366f1" },
  cert:  { label: "\uC790\uACA9\uC99D", color: "#10b981" },
  other: { label: "\uAE30\uD0C0",       color: "#94a3b8" },
};
const WEEKDAYS = ["\uC77C","\uC6D4","\uD654","\uC218","\uBAA9","\uAE08","\uD1A0"];
const EMPTY_DATA = { library: [], certs: [], events: [] };

// ─────────────────────────────────────────────────────────────
// THEME / CSS VARS
// ─────────────────────────────────────────────────────────────
const THEME = {
  "--bg":           "#080c14",
  "--surface":      "#0f1521",
  "--surface-2":    "#161e2e",
  "--surface-3":    "#1c2640",
  "--border":       "#ffffff0f",
  "--border-2":     "#ffffff18",
  "--accent":       "#818cf8",
  "--accent-dim":   "#818cf818",
  "--accent-mid":   "#818cf830",
  "--text-1":       "#f1f5f9",
  "--text-2":       "#8892a4",
  "--text-3":       "#4a5568",
  "--danger":       "#f87171",
  "--success":      "#34d399",
  "--warning":      "#fbbf24",
  "--input-bg":     "#0f1521",
  "--font-sans":    "'Pretendard', 'Noto Sans KR', system-ui, sans-serif",
  "--font-display": "'DM Serif Display', Georgia, serif",
  "--radius":       "12px",
};

// ─────────────────────────────────────────────────────────────
// PRIMITIVE UI COMPONENTS
// ─────────────────────────────────────────────────────────────
function Modal({ title, onClose, width = "max-w-lg", children }) {
  useEffect(() => {
    const fn = e => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`relative w-full ${width} rounded-2xl shadow-2xl overflow-hidden`}
        style={{ background: "var(--surface-2)", border: "1px solid var(--border-2)" }}>
        <div className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}>
          <span className="font-semibold text-sm" style={{ color: "var(--text-1)" }}>{title}</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X size={14} style={{ color: "var(--text-2)" }} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>{label}</label>}
      {children}
    </div>
  );
}

const inputStyle = {
  background: "var(--input-bg)", border: "1px solid var(--border-2)",
  color: "var(--text-1)", borderRadius: "10px",
};

function Input({ label, ...props }) {
  return (
    <Field label={label}>
      <input {...props} className="w-full px-3 py-2 text-sm outline-none focus:border-indigo-500 transition-colors"
        style={inputStyle} />
    </Field>
  );
}
function Textarea({ label, ...props }) {
  return (
    <Field label={label}>
      <textarea {...props} rows={3} className="w-full px-3 py-2 text-sm outline-none resize-none focus:border-indigo-500 transition-colors"
        style={inputStyle} />
    </Field>
  );
}
function Select({ label, children, ...props }) {
  return (
    <Field label={label}>
      <select {...props} className="w-full px-3 py-2 text-sm outline-none"
        style={inputStyle}>
        {children}
      </select>
    </Field>
  );
}

function Btn({ variant = "primary", size = "md", icon: Icon, children, loading, ...props }) {
  const base = "inline-flex items-center justify-center gap-2 font-medium transition-all cursor-pointer disabled:opacity-40 rounded-xl select-none";
  const sz   = size === "sm" ? "px-3 py-1.5 text-xs" : size === "lg" ? "px-6 py-3 text-sm" : "px-4 py-2 text-sm";
  const variants = {
    primary: { background: "var(--accent)", color: "#fff", border: "none" },
    ghost:   { background: "transparent", color: "var(--text-2)", border: "1px solid var(--border-2)" },
    danger:  { background: "#ef444422", color: "var(--danger)", border: "1px solid #ef444430" },
  };
  return (
    <button {...props} disabled={loading || props.disabled} className={`${base} ${sz} hover:opacity-85 active:scale-[0.97]`}
      style={{ ...variants[variant], ...(props.style || {}) }}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : Icon ? <Icon size={14} /> : null}
      {children}
    </button>
  );
}

function Badge({ color, children }) {
  return (
    <span className="text-xs rounded-full px-2 py-0.5 font-medium"
      style={{ background: color + "22", color }}>
      {children}
    </span>
  );
}

function EmptyState({ icon: Icon, title, sub, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 rounded-2xl"
      style={{ border: "1.5px dashed var(--border-2)" }}>
      <div className="rounded-2xl p-4 mb-4" style={{ background: "var(--surface-3)" }}>
        <Icon size={28} style={{ color: "var(--text-3)" }} />
      </div>
      <p className="text-sm font-medium mb-1" style={{ color: "var(--text-2)" }}>{title}</p>
      {sub && <p className="text-xs mb-4" style={{ color: "var(--text-3)" }}>{sub}</p>}
      {action}
    </div>
  );
}

function PageHeader({ title, sub, action }) {
  return (
    <div className="flex items-start justify-between mb-8">
      <div>
        <h2 className="text-xl font-bold" style={{ color: "var(--text-1)", fontFamily: "var(--font-display)" }}>{title}</h2>
        {sub && <p className="text-sm mt-0.5" style={{ color: "var(--text-2)" }}>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

function SyncIndicator({ status }) {
  const map = {
    synced:  { icon: Cloud,     color: "var(--success)", label: "Drive \uB3D9\uAE30\uD654\uB428" },
    syncing: { icon: RefreshCw, color: "var(--accent)",  label: "\uC800\uC7A5 \uC911..." },
    error:   { icon: CloudOff,  color: "var(--danger)",  label: "\uB3D9\uAE30\uD654 \uC624\uB958" },
  };
  const s = map[status];
  if (!s) return null;
  const Icon = s.icon;
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
      style={{ background: s.color + "12", border: "1px solid " + s.color + "20" }}>
      <Icon size={12} style={{ color: s.color }} className={status === "syncing" ? "animate-spin" : ""} />
      <span className="text-xs font-medium" style={{ color: s.color }}>{s.label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LOGIN SCREEN
// ─────────────────────────────────────────────────────────────
function LoginScreen({ onSignIn, loading }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-sm">
        <div className="rounded-3xl p-8 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border-2)" }}>
          <div className="inline-flex rounded-2xl p-4 mb-6" style={{ background: "var(--accent-dim)", border: "1px solid var(--accent-mid)" }}>
            <GraduationCap size={32} style={{ color: "var(--accent)" }} />
          </div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--text-1)", fontFamily: "var(--font-display)" }}>
            CareerKit
          </h1>
          <p className="text-sm mb-8" style={{ color: "var(--text-2)" }}>
            {"\uCEE4\uB9AC\uC5B4 \uAD00\uB9AC \uD50C\uB7AB\uD3FC\uC5D0 \uC624\uC2E0 \uAC78 \uD658\uC601\uD569\uB2C8\uB2E4"}
          </p>
          <Btn size="lg" onClick={onSignIn} loading={loading} className="w-full"
            style={{ width: "100%", background: "var(--accent)" }}>
            <svg width="16" height="16" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
              <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.2 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1L37 9.8C33.7 6.8 29.1 5 24 5 12.9 5 4 13.9 4 25s8.9 20 20 20 20-8.9 20-20c0-1.3-.2-2.7-.4-4z"/>
              <path fill="#FF3D00" d="M6.3 15.7l6.6 4.8C14.7 17 19 14 24 14c3.1 0 5.8 1.2 7.9 3.1L37 9.8C33.7 6.8 29.1 5 24 5c-7.7 0-14.4 4.2-17.7 10.7z"/>
              <path fill="#4CAF50" d="M24 45c5.1 0 9.7-1.8 13.2-4.7l-6.1-5.2C29.3 36.6 26.8 37 24 37c-5.3 0-9.7-2.9-11.3-7.2l-6.5 5C9.5 40.7 16.3 45 24 45z"/>
              <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.4-2.3 4.3-4.3 5.6l6.1 5.2C40.8 35.6 44 31 44 25c0-1.3-.2-2.7-.4-4z"/>
            </svg>
            Google\uB85C \uB85C\uADF8\uC778
          </Btn>
          <p className="text-xs mt-6" style={{ color: "var(--text-3)" }}>
            {"\ub370\uc774\ud130\ub294 \uACF5\uc720 \ub4dc\ub77c\uc774\ube0c\uc5d0\ub9cc \uc800\uc7a5\ub418\uba70\n\uc81c3\uc790\uc5d0\uac8c \uacf5\uc720\ub418\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4"}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// COUNTDOWN BANNER
// ─────────────────────────────────────────────────────────────
function CountdownBanner({ events }) {
  const upcoming = useMemo(() =>
    events.filter(e => e.isDday)
      .map(e => ({ ...e, diff: diffDays(e.date) }))
      .filter(e => e.diff >= 0)
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 3), [events]);
  if (!upcoming.length) return null;
  return (
    <div className="flex gap-3 flex-wrap mb-6">
      {upcoming.map(e => (
        <div key={e.id} className="flex items-center gap-3 rounded-xl px-4 py-3 flex-1 min-w-[190px]"
          style={{ background: "var(--surface)", border: "1px solid var(--border-2)" }}>
          <div className="rounded-lg p-2" style={{ background: EVENT_TYPES[e.type]?.color + "20" }}>
            <Zap size={13} style={{ color: EVENT_TYPES[e.type]?.color }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate" style={{ color: "var(--text-1)" }}>{e.title}</div>
            <div className="text-xs mt-0.5" style={{ color: "var(--text-2)" }}>{formatDate(e.date)}</div>
          </div>
          <span className="text-base font-black tabular-nums"
            style={{ color: e.diff === 0 ? "var(--danger)" : "var(--accent)" }}>
            {dDayLabel(e.diff)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────
function Dashboard({ library, certs, events, setPage, userInfo }) {
  const totalFiles = library.reduce((a, s) => a + s.files.length, 0);
  const nextExam = events
    .filter(e => e.isDday && diffDays(e.date) >= 0)
    .sort((a, b) => diffDays(a.date) - diffDays(b.date))[0];
  const upcomingEvents = [...events]
    .filter(e => diffDays(e.date) >= 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 5);

  const stats = [
    { icon: BookOpen, label: "\uAC15\uC758 \uC139\uC158",       value: library.length, color: "#818cf8", page: "library" },
    { icon: FileText, label: "\uD559\uC2B5 \uC790\uB8CC",       value: totalFiles,     color: "#38bdf8", page: "library" },
    { icon: Award,    label: "\uBCF4\uC720 \uC790\uACA9\uC99D", value: certs.length,   color: "#34d399", page: "certs" },
    { icon: Calendar, label: "\uB4F1\uB85D \uC77C\uC815",       value: events.length,  color: "#fbbf24", page: "scheduler" },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-8">
        {userInfo?.picture && (
          <img src={userInfo.picture} alt="" className="w-10 h-10 rounded-full" style={{ border: "2px solid var(--border-2)" }} />
        )}
        <div>
          <h2 className="text-xl font-bold" style={{ color: "var(--text-1)", fontFamily: "var(--font-display)" }}>
            {userInfo?.name ? `\uC548\uB155\uD558\uC138\uC694, ${userInfo.name.split(" ")[0]}\uB2D8` : "\uB300\uC2DC\uBCF4\uB4DC"}
          </h2>
          <p className="text-xs" style={{ color: "var(--text-2)" }}>
            {new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-6 lg:grid-cols-4">
        {stats.map(s => (
          <button key={s.label} onClick={() => setPage(s.page)}
            className="rounded-2xl p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: "var(--surface)", border: "1px solid var(--border-2)" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="rounded-xl p-2" style={{ background: s.color + "18" }}>
                <s.icon size={15} style={{ color: s.color }} />
              </div>
              <span className="text-2xl font-black tabular-nums" style={{ color: "var(--text-1)" }}>{s.value}</span>
            </div>
            <div className="text-xs" style={{ color: "var(--text-2)" }}>{s.label}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Next D-Day */}
        <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border-2)" }}>
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle size={13} style={{ color: "var(--danger)" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>{"\uB2E4\uC74C D-Day"}</span>
          </div>
          {nextExam ? (
            <div className="flex items-center gap-4">
              <div className="rounded-2xl px-4 py-3 text-center min-w-[72px]"
                style={{ background: "var(--accent-dim)", border: "1px solid var(--accent-mid)" }}>
                <div className="text-2xl font-black tabular-nums" style={{ color: "var(--accent)" }}>
                  {dDayLabel(diffDays(nextExam.date))}
                </div>
              </div>
              <div>
                <div className="font-semibold text-sm" style={{ color: "var(--text-1)" }}>{nextExam.title}</div>
                <div className="text-xs mt-1" style={{ color: "var(--text-2)" }}>{formatDate(nextExam.date)}</div>
                <Badge color={EVENT_TYPES[nextExam.type]?.color} className="mt-2">
                  {EVENT_TYPES[nextExam.type]?.label}
                </Badge>
              </div>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-2)" }}>{"\uB4F1\uB85D\uB41C D-Day\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."}</p>
          )}
        </div>

        {/* Upcoming */}
        <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border-2)" }}>
          <div className="flex items-center gap-2 mb-4">
            <Clock size={13} style={{ color: "var(--accent)" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>{"\uC608\uC815 \uC77C\uC815"}</span>
          </div>
          {upcomingEvents.length ? (
            <ul className="flex flex-col gap-2">
              {upcomingEvents.map(e => (
                <li key={e.id} className="flex items-center gap-2.5">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: EVENT_TYPES[e.type]?.color }} />
                  <span className="text-sm flex-1 truncate" style={{ color: "var(--text-2)" }}>{e.title}</span>
                  <span className="text-xs tabular-nums flex-shrink-0" style={{ color: "var(--text-3)" }}>{formatDate(e.date)}</span>
                  {e.isDday && <span className="text-xs font-bold tabular-nums" style={{ color: "var(--accent)" }}>{dDayLabel(diffDays(e.date))}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-2)" }}>{"\uC608\uC815\uB41C \uC77C\uC815\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LIBRARY
// ─────────────────────────────────────────────────────────────
function Library({ library, onChange, folderId }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newSection, setNewSection] = useState({ subject: "", color: SECTION_COLORS[0] });
  const [uploadTarget, setUploadTarget] = useState(null); // section id
  const [uploading, setUploading] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");
  const [deletingFile, setDeletingFile] = useState(null);
  const fileInputRef = useRef(null);

  function addSection() {
    if (!newSection.subject.trim()) return;
    onChange([...library, { id: uid(), subject: newSection.subject.trim(), color: newSection.color, files: [] }]);
    setNewSection({ subject: "", color: SECTION_COLORS[0] });
    setShowAdd(false);
  }
  function deleteSection(id) {
    onChange(library.filter(s => s.id !== id));
  }
  function saveEdit(id) {
    if (!editName.trim()) { setEditId(null); return; }
    onChange(library.map(s => s.id !== id ? s : { ...s, subject: editName.trim() }));
    setEditId(null);
  }

  async function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    if (!files.length || !folderId) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(files.map(f => uploadFileToDrive(f, folderId)));
      const newFiles = uploaded.map(r => ({
        id: uid(), driveId: r.id, name: r.name,
        size: formatBytes(r.size), date: today(), webViewLink: r.webViewLink,
      }));
      onChange(library.map(s => s.id !== uploadTarget ? s : {
        ...s, files: [...s.files, ...newFiles]
      }));
    } catch (err) {
      console.error(err);
      alert("\uC5C5\uB85C\uB4DC \uC2E4\uD328: " + err.message);
    } finally {
      setUploading(false);
      setUploadTarget(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function deleteFile(sectionId, file) {
    setDeletingFile(file.id);
    try {
      if (file.driveId) await deleteFileFromDrive(file.driveId);
      onChange(library.map(s => s.id !== sectionId ? s : {
        ...s, files: s.files.filter(f => f.id !== file.id)
      }));
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingFile(null);
    }
  }

  function openUpload(sectionId) {
    setUploadTarget(sectionId);
    setTimeout(() => fileInputRef.current?.click(), 50);
  }

  function getIcon(name = "") {
    const ext = name.split(".").pop()?.toLowerCase();
    if (["jpg","jpeg","png","gif","webp","svg"].includes(ext)) return Image;
    if (["pdf"].includes(ext)) return FileText;
    return File;
  }

  return (
    <div>
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
      <PageHeader
        title={"\uAC15\uC758 \uC790\uB8CC\uC2E4"}
        sub={"\uACFC\uBAA9\uBCC4\uB85C \uC139\uC158\uC744 \uB098\uB204\uACE0 \uD30C\uC77C\uC744 \uAD6C\uAE00 \uB4DC\uB77C\uC774\uBE0C\uC5D0 \uC800\uC7A5\uD569\uB2C8\uB2E4"}
        action={<Btn icon={Plus} onClick={() => setShowAdd(true)}>{"\uC0C8 \uC139\uC158"}</Btn>}
      />

      {library.length === 0 && (
        <EmptyState icon={FolderOpen}
          title={"\uAC15\uC758 \uC139\uC158\uC774 \uC5C6\uC2B5\uB2C8\uB2E4"}
          sub={"\uC0C8 \uC139\uC158\uC744 \uCD94\uAC00\uD574\uC11C \uAC15\uC758 \uC790\uB8CC\uB97C \uAD00\uB9AC\uD574\uBCF4\uC138\uC694"}
          action={<Btn icon={Plus} size="sm" onClick={() => setShowAdd(true)}>{"\uC139\uC158 \uCD94\uAC00"}</Btn>}
        />
      )}

      <div className="flex flex-col gap-4">
        {library.map(section => (
          <div key={section.id} className="rounded-2xl overflow-hidden"
            style={{ border: "1px solid var(--border-2)", background: "var(--surface)" }}>
            {/* Section Header */}
            <div className="flex items-center gap-3 px-5 py-4"
              style={{ borderBottom: "1px solid var(--border)", borderLeft: `3px solid ${section.color}` }}>
              {editId === section.id ? (
                <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveEdit(section.id); if (e.key === "Escape") setEditId(null); }}
                  className="flex-1 bg-transparent text-sm font-semibold outline-none"
                  style={{ color: "var(--text-1)", borderBottom: `1px solid ${section.color}` }} />
              ) : (
                <span className="flex-1 text-sm font-semibold" style={{ color: "var(--text-1)" }}>{section.subject}</span>
              )}
              <span className="text-xs mr-1" style={{ color: "var(--text-3)" }}>{section.files.length}{"\uAC1C"}</span>
              {editId === section.id
                ? <button onClick={() => saveEdit(section.id)} className="p-1.5 rounded-lg hover:bg-white/10"><Check size={12} style={{ color: section.color }} /></button>
                : <button onClick={() => { setEditId(section.id); setEditName(section.subject); }} className="p-1.5 rounded-lg hover:bg-white/10"><Edit2 size={12} style={{ color: "var(--text-2)" }} /></button>
              }
              <button onClick={() => openUpload(section.id)} disabled={uploading && uploadTarget === section.id}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all hover:opacity-80"
                style={{ background: section.color + "20", color: section.color }}>
                {uploading && uploadTarget === section.id
                  ? <Loader2 size={11} className="animate-spin" />
                  : <Upload size={11} />}
                {"\uD30C\uC77C \uC5C5\uB85C\uB4DC"}
              </button>
              <button onClick={() => deleteSection(section.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors">
                <Trash2 size={12} style={{ color: "var(--danger)" }} />
              </button>
            </div>

            {/* Files */}
            {section.files.length === 0 ? (
              <div className="px-5 py-4 text-xs" style={{ color: "var(--text-3)" }}>
                {"\uD30C\uC77C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uC704\uC758 \uBC84\uD2BC\uC73C\uB85C \uC5C5\uB85C\uB4DC\uD558\uC138\uC694."}
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                {section.files.map(f => {
                  const FIcon = getIcon(f.name);
                  return (
                    <div key={f.id} className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.03] transition-colors group">
                      <div className="rounded-lg p-1.5 flex-shrink-0" style={{ background: section.color + "18" }}>
                        <FIcon size={13} style={{ color: section.color }} />
                      </div>
                      <span className="flex-1 text-sm truncate" style={{ color: "var(--text-2)" }}>{f.name}</span>
                      <span className="text-xs flex-shrink-0" style={{ color: "var(--text-3)" }}>{f.size}</span>
                      <span className="text-xs flex-shrink-0" style={{ color: "var(--text-3)" }}>{formatDate(f.date)}</span>
                      {f.webViewLink && (
                        <a href={f.webViewLink} target="_blank" rel="noreferrer"
                          className="p-1.5 rounded-lg hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all">
                          <Eye size={12} style={{ color: "var(--accent)" }} />
                        </a>
                      )}
                      <button onClick={() => deleteFile(section.id, f)} disabled={deletingFile === f.id}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all">
                        {deletingFile === f.id
                          ? <Loader2 size={12} className="animate-spin" style={{ color: "var(--danger)" }} />
                          : <Trash2 size={12} style={{ color: "var(--danger)" }} />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {showAdd && (
        <Modal title={"\uC0C8 \uC139\uC158 \uCD94\uAC00"} onClose={() => setShowAdd(false)}>
          <div className="flex flex-col gap-4">
            <Input label={"\uACFC\uBAA9\uBA85"} value={newSection.subject}
              onChange={e => setNewSection(p => ({ ...p, subject: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && addSection()}
              placeholder="NCS \uC9C1\uC5C5\uAE30\uCD08\uB2A5\uB825, TOEIC, \uACBD\uC81C\uD559 ..." />
            <Field label={"\uC139\uC158 \uC0C9\uC0C1"}>
              <div className="flex gap-2 flex-wrap">
                {SECTION_COLORS.map(c => (
                  <button key={c} onClick={() => setNewSection(p => ({ ...p, color: c }))}
                    className="w-7 h-7 rounded-full transition-all hover:scale-110 active:scale-95"
                    style={{ background: c, outline: newSection.color === c ? `3px solid ${c}` : "none", outlineOffset: "2px", opacity: newSection.color === c ? 1 : 0.5 }} />
                ))}
              </div>
            </Field>
            <div className="flex gap-2 justify-end pt-1">
              <Btn variant="ghost" onClick={() => setShowAdd(false)}>{"\uCDE8\uC18C"}</Btn>
              <Btn onClick={addSection}>{"\uCD94\uAC00"}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// CERTIFICATES
// ─────────────────────────────────────────────────────────────
function Certificates({ certs, onChange }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", issuer: "", date: "", expiry: "", score: "", note: "", color: CERT_COLORS[0] });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  function addCert() {
    if (!form.name.trim()) return;
    onChange([...certs, { ...form, id: uid() }]);
    setForm({ name: "", issuer: "", date: "", expiry: "", score: "", note: "", color: CERT_COLORS[0] });
    setShowAdd(false);
  }
  function deleteCert(id) { onChange(certs.filter(c => c.id !== id)); setConfirmDelete(null); }

  function expiryStatus(expiry) {
    if (!expiry) return null;
    const diff = diffDays(expiry);
    if (diff < 0)  return { text: "\uB9CC\uB8CC\uB428",               color: "var(--danger)" };
    if (diff < 90) return { text: `${diff}\uC77C \uD6C4 \uB9CC\uB8CC`, color: "var(--warning)" };
    return           { text: "\uC720\uD6A8",                           color: "var(--success)" };
  }

  return (
    <div>
      <PageHeader
        title={"\uC790\uACA9\uC99D \uBCF4\uAD00\uD568"}
        sub={"\uCDE8\uB4DD\uD55C \uC790\uACA9\uC99D\uC744 \uAD00\uB9AC\uD558\uACE0 \uB9CC\uB8CC\uC77C\uC744 \uCD94\uC801\uD569\uB2C8\uB2E4"}
        action={<Btn icon={Plus} onClick={() => setShowAdd(true)}>{"\uC790\uACA9\uC99D \uCD94\uAC00"}</Btn>}
      />

      {certs.length === 0 && (
        <EmptyState icon={Award}
          title={"\uBCF4\uC720\uD55C \uC790\uACA9\uC99D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4"}
          sub={"\uCDE8\uB4DD\uD55C \uC790\uACA9\uC99D\uC744 \uCD94\uAC00\uD574\uBCF4\uC138\uC694"}
          action={<Btn icon={Plus} size="sm" onClick={() => setShowAdd(true)}>{"\uC790\uACA9\uC99D \uCD94\uAC00"}</Btn>}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {certs.map(cert => {
          const status = expiryStatus(cert.expiry);
          return (
            <div key={cert.id} className="rounded-2xl overflow-hidden group relative transition-all hover:-translate-y-0.5 hover:shadow-2xl"
              style={{ background: cert.color, border: "1px solid " + cert.color + "88" }}>
              {/* Delete btn */}
              <button onClick={() => setConfirmDelete(cert.id)}
                className="absolute top-3 right-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                style={{ background: "rgba(0,0,0,0.3)" }}>
                <Trash2 size={12} style={{ color: "rgba(255,255,255,0.8)" }} />
              </button>

              <div className="p-5">
                <div className="inline-flex rounded-xl p-2.5 mb-4" style={{ background: "rgba(255,255,255,0.12)" }}>
                  <Award size={18} style={{ color: "rgba(255,255,255,0.9)" }} />
                </div>
                <h3 className="text-base font-bold mb-0.5 pr-6" style={{ color: "rgba(255,255,255,0.95)" }}>{cert.name}</h3>
                {cert.issuer && <p className="text-xs" style={{ color: "rgba(255,255,255,0.55)" }}>{cert.issuer}</p>}
                {cert.score && (
                  <div className="mt-3 inline-block text-sm font-bold px-3 py-1 rounded-full"
                    style={{ background: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.9)" }}>
                    {cert.score}
                  </div>
                )}
              </div>

              <div className="px-5 py-3 flex items-center justify-between"
                style={{ background: "rgba(0,0,0,0.25)", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <span className="text-xs" style={{ color: "rgba(255,255,255,0.55)" }}>
                  {cert.date ? formatDate(cert.date) : "\uB0A0\uC9DC \uBBF8\uC785\uB825"}
                </span>
                {status && (
                  <span className="text-xs font-medium rounded-full px-2 py-0.5"
                    style={{ background: status.color + "25", color: status.color }}>
                    {status.text}
                  </span>
                )}
              </div>
              {cert.note && (
                <div className="px-5 py-2 text-xs" style={{ color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.2)" }}>
                  {cert.note}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showAdd && (
        <Modal title={"\uC790\uACA9\uC99D \uCD94\uAC00"} onClose={() => setShowAdd(false)}>
          <div className="flex flex-col gap-3">
            <Input label={"\uC790\uACA9\uC99D\uBA85 *"} value={form.name} onChange={f("name")} placeholder="TOEIC, OPIc, \uC815\uBCF4\uCC98\uB9AC\uAE30\uC0AC ..." />
            <div className="grid grid-cols-2 gap-3">
              <Input label={"\uBC1C\uAE09 \uAE30\uAD00"} value={form.issuer} onChange={f("issuer")} placeholder="ETS, \uC0B0\uC5C5\uC778\uB825\uACF5\uB2E8 ..." />
              <Input label={"\uC810\uC218/\uB4F1\uAE09"} value={form.score} onChange={f("score")} placeholder="900, IM2 ..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label={"\uCDE8\uB4DD\uC77C"} type="date" value={form.date} onChange={f("date")} />
              <Input label={"\uB9CC\uB8CC\uC77C"} type="date" value={form.expiry} onChange={f("expiry")} />
            </div>
            <Textarea label={"\uBA54\uBAA8"} value={form.note} onChange={f("note")} placeholder="\uAC31\uC2E0 \uC694\uAC74, \uC81C\uCD9C\uCC98 \uB4F1 ..." />
            <Field label={"\uCE74\uB4DC \uC0C9\uC0C1"}>
              <div className="flex gap-2 flex-wrap">
                {CERT_COLORS.map(c => (
                  <button key={c} onClick={() => setForm(p => ({ ...p, color: c }))}
                    className="w-7 h-7 rounded-full border-2 transition-all hover:scale-110"
                    style={{ background: c, borderColor: form.color === c ? "white" : "transparent" }} />
                ))}
              </div>
            </Field>
            <div className="flex gap-2 justify-end pt-1">
              <Btn variant="ghost" onClick={() => setShowAdd(false)}>{"\uCDE8\uC18C"}</Btn>
              <Btn onClick={addCert}>{"\uCD94\uAC00"}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title={"\uC0AD\uC81C \uD655\uC778"} onClose={() => setConfirmDelete(null)}>
          <p className="text-sm mb-5" style={{ color: "var(--text-2)" }}>
            {"\uC774 \uC790\uACA9\uC99D\uC744 \uC0AD\uC81C\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C? \uB418\uB3CC\uB9B4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4."}
          </p>
          <div className="flex gap-2 justify-end">
            <Btn variant="ghost" onClick={() => setConfirmDelete(null)}>{"\uCDE8\uC18C"}</Btn>
            <Btn variant="danger" onClick={() => deleteCert(confirmDelete)}>{"\uC0AD\uC81C"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCHEDULER
// ─────────────────────────────────────────────────────────────
function Scheduler({ events, onChange }) {
  const [view, setView] = useState("month");
  const [cursor, setCursor] = useState(new Date());
  const [showAdd, setShowAdd] = useState(false);
  const [prefillDate, setPrefillDate] = useState(today());
  const [form, setForm] = useState({ title: "", date: today(), type: "exam", note: "", isDday: true });
  const fld = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  function openAdd(date = today()) {
    setPrefillDate(date);
    setForm(p => ({ ...p, date }));
    setShowAdd(true);
  }
  function addEvent() {
    if (!form.title.trim() || !form.date) return;
    onChange([...events, { ...form, id: uid(), isDday: form.isDday }]);
    setForm({ title: "", date: today(), type: "exam", note: "", isDday: true });
    setShowAdd(false);
  }
  function deleteEvent(id) { onChange(events.filter(e => e.id !== id)); }

  function getMonthGrid(d) {
    const y = d.getFullYear(), m = d.getMonth();
    const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(null);
    for (let n = 1; n <= last.getDate(); n++) cells.push(new Date(y, m, n));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }
  function eventsOn(d) {
    if (!d) return [];
    return events.filter(e => e.date === d.toISOString().split("T")[0]);
  }
  function getWeekDates(d) {
    const base = new Date(d); base.setDate(d.getDate() - d.getDay());
    return Array.from({ length: 7 }, (_, i) => { const x = new Date(base); x.setDate(base.getDate() + i); return x; });
  }
  function navMonth(dir) { setCursor(p => new Date(p.getFullYear(), p.getMonth() + dir, 1)); }
  function navWeek(dir)  { setCursor(p => { const d = new Date(p); d.setDate(d.getDate() + dir * 7); return d; }); }

  const todayStr = today();
  const monthGrid = getMonthGrid(cursor);
  const weekDates = getWeekDates(cursor);

  return (
    <div>
      <PageHeader
        title={"\uD559\uC2B5 \uC2A4\uCF00\uC904\uB7EC"}
        sub={"\uC2DC\uD5D8 \uC77C\uC815\uACFC D-Day\uB97C \uAD00\uB9AC\uD569\uB2C8\uB2E4"}
        action={
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-2)" }}>
              {["month","week"].map(v => (
                <button key={v} onClick={() => setView(v)} className="px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{ background: view === v ? "var(--accent)" : "transparent", color: view === v ? "white" : "var(--text-2)" }}>
                  {v === "month" ? "\uC6D4\uAC04" : "\uC8FC\uAC04"}
                </button>
              ))}
            </div>
            <Btn icon={Plus} onClick={() => openAdd()}>{"\uC77C\uC815 \uCD94\uAC00"}</Btn>
          </div>
        }
      />

      {/* Calendar Nav */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => view === "month" ? navMonth(-1) : navWeek(-1)}
          className="p-2 rounded-xl hover:bg-white/10 transition-colors">
          <ChevronLeft size={15} style={{ color: "var(--text-2)" }} />
        </button>
        <span className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
          {view === "month"
            ? cursor.toLocaleDateString("ko-KR", { year: "numeric", month: "long" })
            : `${weekDates[0].toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} \u2013 ${weekDates[6].toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}`}
        </span>
        <button onClick={() => view === "month" ? navMonth(1) : navWeek(1)}
          className="p-2 rounded-xl hover:bg-white/10 transition-colors">
          <ChevronRight size={15} style={{ color: "var(--text-2)" }} />
        </button>
      </div>

      {/* Month View */}
      {view === "month" && (
        <div className="rounded-2xl overflow-hidden mb-6" style={{ border: "1px solid var(--border-2)" }}>
          <div className="grid grid-cols-7" style={{ background: "var(--surface)" }}>
            {WEEKDAYS.map((d, i) => (
              <div key={d} className="py-2.5 text-center text-xs font-semibold"
                style={{ color: i===0?"var(--danger)":i===6?"var(--accent)":"var(--text-3)", borderBottom: "1px solid var(--border)" }}>
                {d}
              </div>
            ))}
            {monthGrid.map((day, i) => {
              const evs = eventsOn(day);
              const ds = day?.toISOString().split("T")[0];
              const isToday = ds === todayStr;
              const isWeekend = day && (day.getDay() === 0 || day.getDay() === 6);
              return (
                <div key={i} onClick={() => day && openAdd(ds)}
                  className="min-h-[88px] p-1.5 cursor-pointer hover:bg-white/[0.03] transition-colors"
                  style={{
                    background: day ? "transparent" : "var(--surface-2)",
                    borderRight: (i+1) % 7 !== 0 ? "1px solid var(--border)" : "none",
                    borderBottom: i < monthGrid.length - 7 ? "1px solid var(--border)" : "none",
                  }}>
                  {day && (
                    <>
                      <div className="flex justify-end mb-0.5">
                        <span className="text-xs w-6 h-6 flex items-center justify-center rounded-full font-medium"
                          style={{
                            background: isToday ? "var(--accent)" : "transparent",
                            color: isToday ? "white" : isWeekend ? (day.getDay()===0 ? "var(--danger)" : "var(--accent)") : "var(--text-2)",
                          }}>
                          {day.getDate()}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        {evs.slice(0, 2).map(e => (
                          <div key={e.id} onClick={ev => { ev.stopPropagation(); deleteEvent(e.id); }}
                            className="text-xs rounded-md px-1.5 py-0.5 truncate cursor-pointer hover:opacity-70 transition-opacity"
                            style={{ background: EVENT_TYPES[e.type]?.color + "22", color: EVENT_TYPES[e.type]?.color }}>
                            {e.isDday && "\u2605 "}{e.title}
                          </div>
                        ))}
                        {evs.length > 2 && (
                          <div className="text-xs px-1" style={{ color: "var(--text-3)" }}>+{evs.length - 2}</div>
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
        <div className="rounded-2xl overflow-hidden mb-6" style={{ border: "1px solid var(--border-2)" }}>
          <div className="grid grid-cols-7">
            {weekDates.map((day, i) => {
              const ds = day.toISOString().split("T")[0];
              const isToday = ds === todayStr;
              const evs = eventsOn(day);
              return (
                <div key={i} style={{ borderRight: i < 6 ? "1px solid var(--border)" : "none" }}>
                  <div className="py-3 text-center cursor-pointer hover:bg-white/[0.03]" onClick={() => openAdd(ds)}
                    style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
                    <div className="text-xs mb-1" style={{ color: i===0?"var(--danger)":i===6?"var(--accent)":"var(--text-3)" }}>{WEEKDAYS[i]}</div>
                    <div className="text-lg font-bold mx-auto w-8 h-8 flex items-center justify-center rounded-full"
                      style={{ background: isToday ? "var(--accent)" : "transparent", color: isToday ? "white" : "var(--text-1)" }}>
                      {day.getDate()}
                    </div>
                  </div>
                  <div className="p-1 min-h-[140px] flex flex-col gap-1">
                    {evs.map(e => (
                      <div key={e.id} onClick={() => deleteEvent(e.id)}
                        className="text-xs rounded-lg px-2 py-1.5 cursor-pointer hover:opacity-70 transition-opacity"
                        style={{ background: EVENT_TYPES[e.type]?.color + "22", color: EVENT_TYPES[e.type]?.color }}>
                        <div className="font-medium truncate">{e.isDday && "\u2605 "}{e.title}</div>
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
      <div>
        <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-1)" }}>
          {"\uC804\uCCB4 \uC77C\uC815"} <span style={{ color: "var(--text-3)" }}>({events.length})</span>
        </h3>
        {events.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-2)" }}>{"\uC77C\uC815\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {[...events].sort((a, b) => new Date(a.date) - new Date(b.date)).map(e => {
              const diff = diffDays(e.date);
              return (
                <div key={e.id} className="flex items-center gap-3 px-4 py-3 rounded-xl group"
                  style={{ background: "var(--surface)", border: "1px solid var(--border-2)" }}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: EVENT_TYPES[e.type]?.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>
                      {e.isDday && <span className="mr-1" style={{ color: "var(--accent)" }}>★</span>}
                      {e.title}
                    </div>
                    {e.note && <div className="text-xs truncate mt-0.5" style={{ color: "var(--text-3)" }}>{e.note}</div>}
                  </div>
                  <span className="text-xs flex-shrink-0" style={{ color: "var(--text-3)" }}>{formatDate(e.date)}</span>
                  {e.isDday && (
                    <span className="text-xs font-bold tabular-nums flex-shrink-0 px-2 py-0.5 rounded-full"
                      style={{
                        background: diff < 0 ? "#94a3b815" : diff === 0 ? "var(--danger)20" : "var(--accent-dim)",
                        color: diff < 0 ? "var(--text-3)" : diff === 0 ? "var(--danger)" : "var(--accent)",
                      }}>
                      {dDayLabel(diff)}
                    </span>
                  )}
                  <button onClick={() => deleteEvent(e.id)}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                    <Trash2 size={12} style={{ color: "var(--danger)" }} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showAdd && (
        <Modal title={"\uC77C\uC815 \uCD94\uAC00"} onClose={() => setShowAdd(false)}>
          <div className="flex flex-col gap-3">
            <Input label={"\uC81C\uBAA9 *"} value={form.title} onChange={fld("title")}
              onKeyDown={e => e.key === "Enter" && addEvent()}
              placeholder="TOEIC \uC2DC\uD5D8, NCS \uBAA8\uC758\uACE0\uC0AC ..." />
            <div className="grid grid-cols-2 gap-3">
              <Input label={"\uB0A0\uC9DC *"} type="date" value={form.date} onChange={fld("date")} />
              <Select label={"\uC720\uD615"} value={form.type} onChange={fld("type")}>
                {Object.entries(EVENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </Select>
            </div>
            <Textarea label={"\uBA54\uBAA8"} value={form.note} onChange={fld("note")} placeholder="\uC7A5\uC18C, \uC900\uBE44\uBB3C \uB4F1 ..." />
            <label className="flex items-center gap-2.5 cursor-pointer py-1">
              <div className="relative">
                <input type="checkbox" className="sr-only" checked={form.isDday}
                  onChange={e => setForm(p => ({ ...p, isDday: e.target.checked }))} />
                <div className="w-10 h-5 rounded-full transition-colors"
                  style={{ background: form.isDday ? "var(--accent)" : "var(--surface-3)" }} />
                <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform"
                  style={{ transform: form.isDday ? "translateX(20px)" : "translateX(0)" }} />
              </div>
              <span className="text-sm" style={{ color: "var(--text-2)" }}>D-Day \uCE74\uC6B4\uD2B8\uB2E4\uC6B4 \uD45C\uC2DC</span>
            </label>
            <div className="flex gap-2 justify-end pt-1">
              <Btn variant="ghost" onClick={() => setShowAdd(false)}>{"\uCDE8\uC18C"}</Btn>
              <Btn onClick={addEvent}>{"\uCD94\uAC00"}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SIDEBAR
// ─────────────────────────────────────────────────────────────
function Sidebar({ page, setPage, certs, events, syncStatus, onSignOut, userInfo }) {
  const upcoming = events.filter(e => e.isDday && diffDays(e.date) >= 0).length;
  const navItems = [
    { id: "dashboard", label: "\uB300\uC2DC\uBCF4\uB4DC",           icon: LayoutDashboard },
    { id: "library",   label: "\uAC15\uC758 \uC790\uB8CC\uC2E4",    icon: BookOpen },
    { id: "certs",     label: "\uC790\uACA9\uC99D \uBCF4\uAD00\uD568", icon: Award, badge: certs.length },
    { id: "scheduler", label: "\uD559\uC2B5 \uC2A4\uCF00\uC904\uB7EC", icon: Calendar, badge: upcoming || null },
  ];
  return (
    <nav className="flex flex-col h-full select-none" style={{ width: "220px", minWidth: "220px" }}>
      {/* Logo */}
      <div className="px-5 py-5 mb-1">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl p-2" style={{ background: "var(--accent-dim)", border: "1px solid var(--accent-mid)" }}>
            <GraduationCap size={16} style={{ color: "var(--accent)" }} />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight" style={{ color: "var(--text-1)", fontFamily: "var(--font-display)" }}>CareerKit</div>
            <SyncIndicator status={syncStatus} />
          </div>
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 flex flex-col gap-0.5 px-3 overflow-y-auto">
        {navItems.map(item => {
          const active = page === item.id;
          return (
            <button key={item.id} onClick={() => setPage(item.id)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-left w-full transition-all"
              style={{
                background: active ? "var(--accent-dim)" : "transparent",
                color: active ? "var(--accent)" : "var(--text-2)",
                border: active ? "1px solid var(--accent-mid)" : "1px solid transparent",
              }}>
              <item.icon size={15} style={{ flexShrink: 0 }} />
              <span className="flex-1 text-sm font-medium">{item.label}</span>
              {item.badge > 0 && (
                <span className="text-xs font-bold rounded-full px-1.5 min-w-[20px] text-center py-0.5"
                  style={{ background: active ? "var(--accent)" : "var(--surface-3)", color: active ? "white" : "var(--text-2)" }}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* User */}
      <div className="px-4 py-4 mt-2" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2.5 mb-3">
          {userInfo?.picture
            ? <img src={userInfo.picture} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
            : <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "var(--surface-3)" }}>
                <GraduationCap size={14} style={{ color: "var(--text-2)" }} />
              </div>
          }
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold truncate" style={{ color: "var(--text-1)" }}>{userInfo?.name || "User"}</div>
            <div className="text-xs truncate" style={{ color: "var(--text-3)" }}>{userInfo?.email || ""}</div>
          </div>
        </div>
        <button onClick={onSignOut}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs font-medium transition-colors hover:bg-white/5"
          style={{ color: "var(--text-3)", border: "1px solid var(--border)" }}>
          <LogOut size={12} />
          {"\uB85C\uADF8\uC544\uC6C3"}
        </button>
      </div>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [authState, setAuthState] = useState("loading"); // loading | login | app
  const [page, setPage] = useState("dashboard");
  const [data, setData] = useState(EMPTY_DATA);
  const [syncStatus, setSyncStatus] = useState("synced");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userInfo, setUserInfo] = useState(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const dataFileIdRef = useRef(null);
  const folderIdRef   = useRef(null);
  const tokenClientRef = useRef(null);
  const saveTimerRef   = useRef(null);

  // ── Init ──
  useEffect(() => {
    (async () => {
      await Promise.all([initGapi(), initGis()]);
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: handleTokenResponse,
      });
      // Try cached token
      if (loadCachedToken()) {
        try {
          await bootstrapApp();
          setAuthState("app");
        } catch {
          clearToken();
          setAuthState("login");
        }
      } else {
        setAuthState("login");
      }
    })();
  }, []);

  async function handleTokenResponse(resp) {
    if (resp.error) { setLoginLoading(false); return; }
    saveToken(resp);
    await bootstrapApp();
    setAuthState("app");
    setLoginLoading(false);
  }

  async function bootstrapApp() {
    // Get user info
    const uRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${window.gapi.client.getToken().access_token}` }
    });
    const uData = await uRes.json();
    setUserInfo({ name: uData.name, email: uData.email, picture: uData.picture });

    // Get or create data file
    const existing = await findFile(DATA_FILE_NAME);
    if (existing) {
      dataFileIdRef.current = existing.id;
      const loaded = await readJsonFile(existing.id);
      setData({ library: loaded.library||[], certs: loaded.certs||[], events: loaded.events||[] });
    } else {
      const newId = await createJsonFile(DATA_FILE_NAME, EMPTY_DATA);
      dataFileIdRef.current = newId;
    }

    // Get or create upload folder
    const folder = await findFile(FOLDER_NAME, "drive");
    folderIdRef.current = folder ? folder.id : await getOrCreateFolder();
  }

  function handleSignIn() {
    setLoginLoading(true);
    tokenClientRef.current?.requestAccessToken({ prompt: "consent" });
  }
  function handleSignOut() {
    const token = window.gapi.client.getToken();
    if (token) window.google.accounts.oauth2.revoke(token.access_token);
    clearToken();
    setData(EMPTY_DATA);
    setUserInfo(null);
    dataFileIdRef.current = null;
    folderIdRef.current = null;
    setAuthState("login");
  }

  // ── Save (debounced 1.5s) ──
  function scheduleSave(newData) {
    if (!dataFileIdRef.current) return;
    setSyncStatus("syncing");
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await updateJsonFile(dataFileIdRef.current, newData);
        setSyncStatus("synced");
      } catch (e) {
        console.error(e);
        setSyncStatus("error");
      }
    }, 1500);
  }

  const updateLibrary = useCallback((library) => {
    const d = { ...data, library }; setData(d); scheduleSave(d);
  }, [data]);
  const updateCerts = useCallback((certs) => {
    const d = { ...data, certs }; setData(d); scheduleSave(d);
  }, [data]);
  const updateEvents = useCallback((events) => {
    const d = { ...data, events }; setData(d); scheduleSave(d);
  }, [data]);

  // ── Render ──
  if (authState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div style={{ ...THEME }}>
          <Loader2 size={32} className="animate-spin" style={{ color: "var(--accent)" }} />
        </div>
      </div>
    );
  }

  if (authState === "login") {
    return (
      <div style={THEME}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap');
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: var(--bg); }
          @keyframes spin { to { transform: rotate(360deg); } }
          .animate-spin { animation: spin 1s linear infinite; }
        `}</style>
        <LoginScreen onSignIn={handleSignIn} loading={loginLoading} />
      </div>
    );
  }

  const pages = {
    dashboard: <Dashboard library={data.library} certs={data.certs} events={data.events} setPage={setPage} userInfo={userInfo} />,
    library:   <Library   library={data.library} onChange={updateLibrary} folderId={folderIdRef.current} />,
    certs:     <Certificates certs={data.certs} onChange={updateCerts} />,
    scheduler: <Scheduler events={data.events} onChange={updateEvents} />,
  };

  return (
    <div style={THEME}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: var(--bg); }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #ffffff14; border-radius: 99px; }
        input[type=date]::-webkit-calendar-picker-indicator { filter: invert(0.4); }
        select option { background: #161e2e; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>
      <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)", fontFamily: "var(--font-sans)" }}>

        {/* Sidebar — desktop */}
        <div className="hidden md:flex flex-col py-3 flex-shrink-0"
          style={{ borderRight: "1px solid var(--border)", background: "var(--surface)" }}>
          <Sidebar page={page} setPage={setPage} certs={data.certs} events={data.events}
            syncStatus={syncStatus} onSignOut={handleSignOut} userInfo={userInfo} />
        </div>

        {/* Sidebar — mobile overlay */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setSidebarOpen(false)}>
            <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
            <div className="absolute left-0 top-0 bottom-0 flex flex-col py-3 z-10" onClick={e => e.stopPropagation()}
              style={{ background: "var(--surface)", borderRight: "1px solid var(--border-2)", width: "240px" }}>
              <Sidebar page={page} setPage={p => { setPage(p); setSidebarOpen(false); }} certs={data.certs} events={data.events}
                syncStatus={syncStatus} onSignOut={handleSignOut} userInfo={userInfo} />
            </div>
          </div>
        )}

        {/* Main */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Mobile topbar */}
          <div className="md:hidden flex items-center justify-between px-4 py-3"
            style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
            <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-xl hover:bg-white/10">
              <Menu size={16} style={{ color: "var(--text-2)" }} />
            </button>
            <span className="text-sm font-bold" style={{ color: "var(--text-1)", fontFamily: "var(--font-display)" }}>CareerKit</span>
            <SyncIndicator status={syncStatus} />
          </div>

          {/* Page content */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-4xl mx-auto px-6 py-8">
              <CountdownBanner events={data.events} />
              {pages[page]}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
