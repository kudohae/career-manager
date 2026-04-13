import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  BookOpen, Award, Calendar, LayoutDashboard, Plus, Trash2,
  Upload, ChevronLeft, ChevronRight, X, Edit2, Check,
  Clock, FileText, Image, File, FolderOpen, AlertCircle,
  GraduationCap, Zap, LogOut, Cloud, CloudOff, RefreshCw,
  Eye, Loader2, Menu
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// GOOGLE API CONFIG
// ─────────────────────────────────────────────────────────────
const CLIENT_ID = "406294571592-ufr5l29p3vvv4nfobec3ktosb8euj7gj.apps.googleusercontent.com";
const SCOPES = ["https://www.googleapis.com/auth/drive.appdata","https://www.googleapis.com/auth/drive.file"].join(" ");
const DATA_FILE_NAME = "career_data.json";
const FOLDER_NAME = "CareerKit Files";
const TOKEN_KEY = "career_gapi_token";
const TOKEN_EXPIRY_KEY = "career_gapi_expiry";

// ─────────────────────────────────────────────────────────────
// GOOGLE API
// ─────────────────────────────────────────────────────────────
function loadScript(src, check) {
  return new Promise(resolve => {
    if (check()) { resolve(); return; }
    const s = document.createElement("script"); s.src = src; s.onload = resolve;
    document.head.appendChild(s);
  });
}
async function initGapi() {
  await loadScript("https://apis.google.com/js/api.js", () => !!window.gapi);
  await new Promise(r => window.gapi.load("client", r));
  await window.gapi.client.init({ discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"] });
}
async function initGis() {
  await loadScript("https://accounts.google.com/gsi/client", () => !!window.google?.accounts);
}
function saveToken(token) {
  const expiry = Date.now() + (token.expires_in - 60) * 1000;
  localStorage.setItem(TOKEN_KEY, token.access_token);
  localStorage.setItem(TOKEN_EXPIRY_KEY, String(expiry));
  window.gapi.client.setToken(token);
}
function loadCachedToken() {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiry = Number(localStorage.getItem(TOKEN_EXPIRY_KEY));
  if (token && expiry && Date.now() < expiry) { window.gapi.client.setToken({ access_token: token }); return true; }
  return false;
}
function clearToken() {
  localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_EXPIRY_KEY);
  window.gapi.client.setToken(null);
}
async function findFile(name, spaces = "appDataFolder") {
  const res = await window.gapi.client.drive.files.list({ spaces, q: `name='${name}' and trashed=false`, fields: "files(id,name)" });
  return res.result.files?.[0] || null;
}
async function readJsonFile(fileId) {
  const res = await window.gapi.client.drive.files.get({ fileId, alt: "media" });
  return typeof res.result === "string" ? JSON.parse(res.result) : res.result;
}
async function createJsonFile(name, data, parents = ["appDataFolder"]) {
  const b = "ck_b";
  const body = [`--${b}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify({ name, parents }), `--${b}`, "Content-Type: application/json", "", JSON.stringify(data), `--${b}--`].join("\r\n");
  const res = await window.gapi.client.request({ path: "https://www.googleapis.com/upload/drive/v3/files", method: "POST", params: { uploadType: "multipart", fields: "id" }, headers: { "Content-Type": `multipart/related; boundary=${b}` }, body });
  return res.result.id;
}
async function updateJsonFile(fileId, data) {
  await window.gapi.client.request({ path: `https://www.googleapis.com/upload/drive/v3/files/${fileId}`, method: "PATCH", params: { uploadType: "media" }, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
}
async function getOrCreateFolder() {
  const existing = await findFile(FOLDER_NAME, "drive");
  if (existing) return existing.id;
  const res = await window.gapi.client.drive.files.create({ resource: { name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }, fields: "id" });
  return res.result.id;
}
async function uploadFileToDrive(file, folderId) {
  const token = window.gapi.client.getToken()?.access_token;
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify({ name: file.name, parents: [folderId] })], { type: "application/json" }));
  form.append("file", file);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,webViewLink", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) throw new Error("Upload failed");
  return await res.json();
}
async function deleteFileFromDrive(fileId) {
  await window.gapi.client.drive.files.delete({ fileId });
}

// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }
function today() { return new Date().toISOString().split("T")[0]; }
function diffDays(d) { const t = new Date(d); t.setHours(0,0,0,0); const n = new Date(); n.setHours(0,0,0,0); return Math.round((t-n)/86400000); }
function formatDate(d) { if (!d) return "-"; return new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" }); }
function formatBytes(b) { if (!b) return ""; if (b < 1024) return b+"B"; if (b < 1048576) return (b/1024).toFixed(1)+"KB"; return (b/1048576).toFixed(1)+"MB"; }
function dDayLabel(d) { if (d===0) return "D-Day"; return d>0?`D-${d}`:`D+${Math.abs(d)}`; }

const C = {
  bg:       "#080c14",
  surface:  "#0f1521",
  surface2: "#161e2e",
  surface3: "#1c2640",
  border:   "rgba(255,255,255,0.06)",
  border2:  "rgba(255,255,255,0.10)",
  accent:   "#818cf8",
  text1:    "#f1f5f9",
  text2:    "#8892a4",
  text3:    "#4a5568",
  danger:   "#f87171",
  success:  "#34d399",
  warning:  "#fbbf24",
};

const SECTION_COLORS = ["#818cf8","#38bdf8","#34d399","#fbbf24","#f87171","#c084fc","#f472b6","#2dd4bf"];
const CERT_COLORS    = ["#1e293b","#1e3a5f","#14532d","#7c2d12","#312e81","#4a1942","#064e3b","#334155"];
const EVENT_TYPES = {
  exam:  { label: "\uC2DC\uD5D8",       color: "#f87171" },
  study: { label: "\uD559\uC2B5",       color: "#818cf8" },
  cert:  { label: "\uC790\uACA9\uC99D", color: "#34d399" },
  other: { label: "\uAE30\uD0C0",       color: "#8892a4" },
};
const WEEKDAYS = ["\uC77C","\uC6D4","\uD654","\uC218","\uBAA9","\uAE08","\uD1A0"];
const EMPTY_DATA = { library: [], certs: [], events: [] };

// ─────────────────────────────────────────────────────────────
// STYLE HELPERS
// ─────────────────────────────────────────────────────────────
const S = {
  card: { background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 16 },
  input: { background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 10, color: C.text1, padding: "8px 12px", fontSize: 13, width: "100%", outline: "none", boxSizing: "border-box" },
  label: { fontSize: 11, fontWeight: 500, color: C.text2, marginBottom: 4, display: "block" },
  row: { display: "flex", alignItems: "center", gap: 8 },
  col: { display: "flex", flexDirection: "column", gap: 6 },
};

// ─────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  useEffect(() => { const fn = e => e.key==="Escape"&&onClose(); window.addEventListener("keydown",fn); return ()=>window.removeEventListener("keydown",fn); }, [onClose]);
  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{ position:"fixed", inset:0, zIndex:50, display:"flex", alignItems:"center", justifyContent:"center", padding:16, background:"rgba(0,0,0,0.7)", backdropFilter:"blur(8px)" }}>
      <div style={{ width:"100%", maxWidth:480, borderRadius:20, overflow:"hidden", background:C.surface2, border:`1px solid ${C.border2}`, boxShadow:"0 25px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 24px", borderBottom:`1px solid ${C.border}` }}>
          <span style={{ fontSize:14, fontWeight:600, color:C.text1 }}>{title}</span>
          <button onClick={onClose} style={{ background:"transparent", border:"none", cursor:"pointer", padding:4, borderRadius:8, color:C.text2, display:"flex" }}><X size={14}/></button>
        </div>
        <div style={{ padding:24 }}>{children}</div>
      </div>
    </div>
  );
}

function Btn({ variant="primary", children, icon:Icon, loading, style:ext={}, ...props }) {
  const base = { display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6, padding:"8px 16px", borderRadius:12, fontSize:13, fontWeight:500, cursor:"pointer", border:"none", transition:"opacity 0.15s", fontFamily:"inherit" };
  const variants = {
    primary: { background:C.accent, color:"#fff" },
    ghost:   { background:"transparent", color:C.text2, border:`1px solid ${C.border2}` },
    danger:  { background:"rgba(248,113,113,0.12)", color:C.danger, border:"1px solid rgba(248,113,113,0.2)" },
    text:    { background:"transparent", color:C.text2, padding:"4px 8px" },
  };
  return (
    <button {...props} style={{ ...base, ...variants[variant], ...ext }} onMouseEnter={e=>e.currentTarget.style.opacity="0.8"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
      {loading ? <Loader2 size={13} style={{ animation:"spin 1s linear infinite" }}/> : Icon ? <Icon size={13}/> : null}
      {children}
    </button>
  );
}

function Field({ label, children, style:ext={} }) {
  return <div style={{ ...S.col, ...ext }}>{label&&<label style={S.label}>{label}</label>}{children}</div>;
}
function Input({ label, style:ext={}, ...props }) {
  return <Field label={label}><input {...props} style={{ ...S.input, ...ext }}/></Field>;
}
function Textarea({ label, ...props }) {
  return <Field label={label}><textarea {...props} rows={3} style={{ ...S.input, resize:"none" }}/></Field>;
}
function SelectInput({ label, children, ...props }) {
  return <Field label={label}><select {...props} style={{ ...S.input }}>{children}</select></Field>;
}

function SyncDot({ status }) {
  const map = { synced:C.success, syncing:C.accent, error:C.danger };
  const color = map[status] || C.text3;
  return <div style={{ width:7, height:7, borderRadius:"50%", background:color, flexShrink:0, animation: status==="syncing"?"pulse 1s infinite":undefined }}/>;
}

function EmptyState({ icon:Icon, title, sub, action }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"64px 24px", border:`1.5px dashed ${C.border2}`, borderRadius:20, textAlign:"center" }}>
      <div style={{ background:C.surface2, borderRadius:16, padding:16, marginBottom:16 }}><Icon size={28} color={C.text3}/></div>
      <p style={{ fontSize:14, color:C.text2, fontWeight:500, marginBottom:6 }}>{title}</p>
      {sub&&<p style={{ fontSize:12, color:C.text3, marginBottom:16 }}>{sub}</p>}
      {action}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LOGIN SCREEN
// ─────────────────────────────────────────────────────────────
function LoginScreen({ onSignIn, loading }) {
  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:C.bg, padding:24, fontFamily:"system-ui,sans-serif" }}>
      <div style={{ width:"100%", maxWidth:360 }}>
        <div style={{ ...S.card, padding:40, textAlign:"center" }}>
          <div style={{ display:"inline-flex", borderRadius:20, padding:16, marginBottom:24, background:`${C.accent}18`, border:`1px solid ${C.accent}30` }}>
            <GraduationCap size={36} color={C.accent}/>
          </div>
          <h1 style={{ fontSize:28, fontWeight:700, color:C.text1, marginBottom:8, fontFamily:"Georgia,serif" }}>CareerKit</h1>
          <p style={{ fontSize:13, color:C.text2, marginBottom:32, lineHeight:1.6 }}>
            {"\uCEE4\uB9AC\uC5B4 \uAD00\uB9AC \uD50C\uB7AB\uD3FC\uC5D0 \uC624\uC2E0 \uAC83\uC744 \uD658\uC601\uD569\uB2C8\uB2E4"}
          </p>
          <button onClick={onSignIn} disabled={loading} style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:10, padding:"12px 24px", borderRadius:12, border:`1px solid ${C.border2}`, background:C.surface2, color:C.text1, fontSize:14, fontWeight:500, cursor:"pointer", fontFamily:"inherit" }}>
            {loading
              ? <Loader2 size={16} style={{ animation:"spin 1s linear infinite" }}/>
              : <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.2 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1L37 9.8C33.7 6.8 29.1 5 24 5 12.9 5 4 13.9 4 25s8.9 20 20 20 20-8.9 20-20c0-1.3-.2-2.7-.4-4z"/><path fill="#FF3D00" d="M6.3 15.7l6.6 4.8C14.7 17 19 14 24 14c3.1 0 5.8 1.2 7.9 3.1L37 9.8C33.7 6.8 29.1 5 24 5c-7.7 0-14.4 4.2-17.7 10.7z"/><path fill="#4CAF50" d="M24 45c5.1 0 9.7-1.8 13.2-4.7l-6.1-5.2C29.3 36.6 26.8 37 24 37c-5.3 0-9.7-2.9-11.3-7.2l-6.5 5C9.5 40.7 16.3 45 24 45z"/><path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.4-2.3 4.3-4.3 5.6l6.1 5.2C40.8 35.6 44 31 44 25c0-1.3-.2-2.7-.4-4z"/></svg>
            }
            Google{"\uB85C \uB85C\uADF8\uC778"}
          </button>
          <p style={{ fontSize:11, color:C.text3, marginTop:20, lineHeight:1.7 }}>
            {"\ub370\uc774\ud130\ub294 \uBCF8\uC778\uc758 Google Drive\uc5d0\ub9cc \uc800\uc7a5\ub429\ub2c8\ub2e4"}
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
    events.filter(e=>e.isDday).map(e=>({...e,diff:diffDays(e.date)})).filter(e=>e.diff>=0).sort((a,b)=>a.diff-b.diff).slice(0,3),[events]);
  if (!upcoming.length) return null;
  return (
    <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:24 }}>
      {upcoming.map(e=>(
        <div key={e.id} style={{ display:"flex", alignItems:"center", gap:12, ...S.card, padding:"12px 16px", flex:1, minWidth:180 }}>
          <div style={{ borderRadius:10, padding:8, background:EVENT_TYPES[e.type]?.color+"22" }}><Zap size={13} color={EVENT_TYPES[e.type]?.color}/></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:12, fontWeight:500, color:C.text1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.title}</div>
            <div style={{ fontSize:11, color:C.text2, marginTop:2 }}>{formatDate(e.date)}</div>
          </div>
          <span style={{ fontSize:16, fontWeight:900, color:e.diff===0?C.danger:C.accent, fontVariantNumeric:"tabular-nums" }}>{dDayLabel(e.diff)}</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────
function Dashboard({ library, certs, events, setPage, userInfo }) {
  const totalFiles = library.reduce((a,s)=>a+s.files.length,0);
  const nextExam = events.filter(e=>e.isDday&&diffDays(e.date)>=0).sort((a,b)=>diffDays(a.date)-diffDays(b.date))[0];
  const upcomingEvents = [...events].filter(e=>diffDays(e.date)>=0).sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,5);
  const stats = [
    { icon:BookOpen, label:"\uAC15\uC758 \uC139\uC158",       value:library.length, color:"#818cf8", page:"library" },
    { icon:FileText, label:"\uD559\uC2B5 \uC790\uB8CC",       value:totalFiles,     color:"#38bdf8", page:"library" },
    { icon:Award,    label:"\uBCF4\uC720 \uC790\uACA9\uC99D", value:certs.length,   color:"#34d399", page:"certs" },
    { icon:Calendar, label:"\uB4F1\uB85D \uC77C\uC815",       value:events.length,  color:"#fbbf24", page:"scheduler" },
  ];
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:32 }}>
        {userInfo?.picture && <img src={userInfo.picture} alt="" style={{ width:44, height:44, borderRadius:"50%", border:`2px solid ${C.border2}` }}/>}
        <div>
          <h2 style={{ fontSize:20, fontWeight:700, color:C.text1, fontFamily:"Georgia,serif" }}>
            {userInfo?.name ? `\uC548\uB155\uD558\uC138\uC694, ${userInfo.name.split(" ")[0]}\uB2D8` : "\uB300\uC2DC\uBCF4\uB4DC"}
          </h2>
          <p style={{ fontSize:12, color:C.text2 }}>{new Date().toLocaleDateString("ko-KR",{year:"numeric",month:"long",day:"numeric",weekday:"long"})}</p>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:12, marginBottom:24 }}>
        {stats.map(s=>(
          <button key={s.label} onClick={()=>setPage(s.page)} style={{ ...S.card, padding:16, textAlign:"left", cursor:"pointer", fontFamily:"inherit", transition:"transform 0.15s" }} onMouseEnter={e=>e.currentTarget.style.transform="scale(1.02)"} onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
              <div style={{ borderRadius:10, padding:8, background:s.color+"18" }}><s.icon size={15} color={s.color}/></div>
              <span style={{ fontSize:24, fontWeight:900, color:C.text1, fontVariantNumeric:"tabular-nums" }}>{s.value}</span>
            </div>
            <div style={{ fontSize:11, color:C.text2 }}>{s.label}</div>
          </button>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        <div style={{ ...S.card, padding:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:16 }}>
            <AlertCircle size={13} color={C.danger}/>
            <span style={{ fontSize:13, fontWeight:600, color:C.text1 }}>{"\uB2E4\uC74C D-Day"}</span>
          </div>
          {nextExam ? (
            <div style={{ display:"flex", alignItems:"center", gap:16 }}>
              <div style={{ borderRadius:14, padding:"12px 16px", textAlign:"center", background:`${C.accent}18`, border:`1px solid ${C.accent}30`, minWidth:72 }}>
                <div style={{ fontSize:22, fontWeight:900, color:C.accent, fontVariantNumeric:"tabular-nums" }}>{dDayLabel(diffDays(nextExam.date))}</div>
              </div>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:C.text1 }}>{nextExam.title}</div>
                <div style={{ fontSize:11, color:C.text2, marginTop:4 }}>{formatDate(nextExam.date)}</div>
                <div style={{ fontSize:11, marginTop:6, display:"inline-block", padding:"2px 8px", borderRadius:99, background:EVENT_TYPES[nextExam.type]?.color+"22", color:EVENT_TYPES[nextExam.type]?.color }}>{EVENT_TYPES[nextExam.type]?.label}</div>
              </div>
            </div>
          ) : <p style={{ fontSize:13, color:C.text2 }}>{"\uB4F1\uB85D\uB41C D-Day\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."}</p>}
        </div>

        <div style={{ ...S.card, padding:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:16 }}>
            <Clock size={13} color={C.accent}/>
            <span style={{ fontSize:13, fontWeight:600, color:C.text1 }}>{"\uC608\uC815 \uC77C\uC815"}</span>
          </div>
          {upcomingEvents.length ? (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {upcomingEvents.map(e=>(
                <div key={e.id} style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:6, height:6, borderRadius:"50%", background:EVENT_TYPES[e.type]?.color, flexShrink:0 }}/>
                  <span style={{ fontSize:12, flex:1, color:C.text2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.title}</span>
                  <span style={{ fontSize:11, color:C.text3, flexShrink:0 }}>{formatDate(e.date)}</span>
                </div>
              ))}
            </div>
          ) : <p style={{ fontSize:13, color:C.text2 }}>{"\uC608\uC815\uB41C \uC77C\uC815\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</p>}
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
  const [newSection, setNewSection] = useState({ subject:"", color:SECTION_COLORS[0] });
  const [uploadTarget, setUploadTarget] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");
  const [deletingFile, setDeletingFile] = useState(null);
  const fileInputRef = useRef(null);

  function addSection() {
    if (!newSection.subject.trim()) return;
    onChange([...library, { id:uid(), subject:newSection.subject.trim(), color:newSection.color, files:[] }]);
    setNewSection({ subject:"", color:SECTION_COLORS[0] }); setShowAdd(false);
  }
  function deleteSection(id) { onChange(library.filter(s=>s.id!==id)); }
  function saveEdit(id) {
    if (!editName.trim()) { setEditId(null); return; }
    onChange(library.map(s=>s.id!==id?s:{...s,subject:editName.trim()})); setEditId(null);
  }
  async function handleFileSelect(e) {
    const files = Array.from(e.target.files); if (!files.length||!folderId) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(files.map(f=>uploadFileToDrive(f,folderId)));
      const newFiles = uploaded.map(r=>({ id:uid(), driveId:r.id, name:r.name, size:formatBytes(r.size), date:today(), webViewLink:r.webViewLink }));
      onChange(library.map(s=>s.id!==uploadTarget?s:{...s,files:[...s.files,...newFiles]}));
    } catch(err) { alert("\uC5C5\uB85C\uB4DC \uC2E4\uD328: "+err.message); }
    finally { setUploading(false); setUploadTarget(null); if(fileInputRef.current) fileInputRef.current.value=""; }
  }
  async function deleteFile(sectionId, file) {
    setDeletingFile(file.id);
    try { if(file.driveId) await deleteFileFromDrive(file.driveId); onChange(library.map(s=>s.id!==sectionId?s:{...s,files:s.files.filter(f=>f.id!==file.id)})); }
    catch(err) { console.error(err); } finally { setDeletingFile(null); }
  }
  function openUpload(sectionId) { setUploadTarget(sectionId); setTimeout(()=>fileInputRef.current?.click(),50); }
  function getIcon(name="") { const ext=name.split(".").pop()?.toLowerCase(); if(["jpg","jpeg","png","gif","webp"].includes(ext)) return Image; if(ext==="pdf") return FileText; return File; }

  return (
    <div>
      <input ref={fileInputRef} type="file" multiple style={{ display:"none" }} onChange={handleFileSelect}/>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:32 }}>
        <div>
          <h2 style={{ fontSize:20, fontWeight:700, color:C.text1, fontFamily:"Georgia,serif" }}>{"\uAC15\uC758 \uC790\uB8CC\uC2E4"}</h2>
          <p style={{ fontSize:13, color:C.text2, marginTop:4 }}>{"\uACFC\uBAA9\uBCC4 \uC139\uC158\uC73C\uB85C \uD30C\uC77C\uC744 Drive\uC5D0 \uC800\uC7A5\uD569\uB2C8\uB2E4"}</p>
        </div>
        <Btn icon={Plus} onClick={()=>setShowAdd(true)}>{"\uC0C8 \uC139\uC158"}</Btn>
      </div>

      {library.length===0 && <EmptyState icon={FolderOpen} title={"\uAC15\uC758 \uC139\uC158\uC774 \uC5C6\uC2B5\uB2C8\uB2E4"} sub={"\uC0C8 \uC139\uC158\uC744 \uCD94\uAC00\uD558\uC138\uC694"} action={<Btn icon={Plus} onClick={()=>setShowAdd(true)}>{"\uC139\uC158 \uCD94\uAC00"}</Btn>}/>}

      <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
        {library.map(section=>(
          <div key={section.id} style={{ ...S.card, overflow:"hidden" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 20px", borderBottom:`1px solid ${C.border}`, borderLeft:`3px solid ${section.color}` }}>
              {editId===section.id
                ? <input autoFocus value={editName} onChange={e=>setEditName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveEdit(section.id);if(e.key==="Escape")setEditId(null);}} style={{ flex:1, background:"transparent", border:"none", borderBottom:`1px solid ${section.color}`, color:C.text1, fontSize:13, fontWeight:600, outline:"none", fontFamily:"inherit" }}/>
                : <span style={{ flex:1, fontSize:13, fontWeight:600, color:C.text1 }}>{section.subject}</span>
              }
              <span style={{ fontSize:11, color:C.text3 }}>{section.files.length}{"\uAC1C"}</span>
              {editId===section.id
                ? <button onClick={()=>saveEdit(section.id)} style={{ background:"transparent", border:"none", cursor:"pointer", padding:4, color:section.color, display:"flex" }}><Check size={12}/></button>
                : <button onClick={()=>{setEditId(section.id);setEditName(section.subject);}} style={{ background:"transparent", border:"none", cursor:"pointer", padding:4, color:C.text2, display:"flex" }}><Edit2 size={12}/></button>
              }
              <button onClick={()=>openUpload(section.id)} disabled={uploading&&uploadTarget===section.id} style={{ display:"flex", alignItems:"center", gap:4, fontSize:11, fontWeight:500, padding:"5px 10px", borderRadius:8, background:section.color+"20", color:section.color, border:"none", cursor:"pointer", fontFamily:"inherit" }}>
                {uploading&&uploadTarget===section.id?<Loader2 size={10} style={{ animation:"spin 1s linear infinite" }}/>:<Upload size={10}/>}
                {"\uD30C\uC77C \uC5C5\uB85C\uB4DC"}
              </button>
              <button onClick={()=>deleteSection(section.id)} style={{ background:"transparent", border:"none", cursor:"pointer", padding:4, color:C.danger, display:"flex" }}><Trash2 size={12}/></button>
            </div>
            {section.files.length===0
              ? <div style={{ padding:"14px 20px", fontSize:12, color:C.text3 }}>{"\uD30C\uC77C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</div>
              : section.files.map(f=>{
                  const FIcon=getIcon(f.name);
                  return (
                    <div key={f.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 20px", borderBottom:`1px solid ${C.border}` }}>
                      <div style={{ borderRadius:8, padding:6, background:section.color+"18", flexShrink:0 }}><FIcon size={12} color={section.color}/></div>
                      <span style={{ flex:1, fontSize:12, color:C.text2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</span>
                      <span style={{ fontSize:11, color:C.text3, flexShrink:0 }}>{f.size}</span>
                      <span style={{ fontSize:11, color:C.text3, flexShrink:0 }}>{formatDate(f.date)}</span>
                      {f.webViewLink && <a href={f.webViewLink} target="_blank" rel="noreferrer" style={{ color:C.accent, display:"flex", padding:4 }}><Eye size={12}/></a>}
                      <button onClick={()=>deleteFile(section.id,f)} disabled={deletingFile===f.id} style={{ background:"transparent", border:"none", cursor:"pointer", padding:4, color:C.danger, display:"flex" }}>
                        {deletingFile===f.id?<Loader2 size={12} style={{ animation:"spin 1s linear infinite" }}/>:<Trash2 size={12}/>}
                      </button>
                    </div>
                  );
                })
            }
          </div>
        ))}
      </div>

      {showAdd && (
        <Modal title={"\uC0C8 \uC139\uC158 \uCD94\uAC00"} onClose={()=>setShowAdd(false)}>
          <div style={{ ...S.col, gap:16 }}>
            <Input label={"\uACFC\uBAA9\uBA85"} value={newSection.subject} onChange={e=>setNewSection(p=>({...p,subject:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addSection()} placeholder="NCS \uC9C1\uC5C5\uAE30\uCD08\uB2A5\uB825, TOEIC ..."/>
            <Field label={"\uC0C9\uC0C1"}>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {SECTION_COLORS.map(c=>(
                  <button key={c} onClick={()=>setNewSection(p=>({...p,color:c}))} style={{ width:28, height:28, borderRadius:"50%", background:c, border: newSection.color===c?"3px solid white":"3px solid transparent", cursor:"pointer", outline:"none", opacity: newSection.color===c?1:0.5 }}/>
                ))}
              </div>
            </Field>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <Btn variant="ghost" onClick={()=>setShowAdd(false)}>{"\uCDE8\uC18C"}</Btn>
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
function Certificates({ certs, onChange, folderId }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name:"", issuer:"", date:"", expiry:"", score:"", note:"", color:CERT_COLORS[0] });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [uploadingCert, setUploadingCert] = useState(null);
  const [deletingFile, setDeletingFile] = useState(null);
  const fileInputRef = useRef(null);
  const uploadTargetRef = useRef(null);
  const f = k => e => setForm(p=>({...p,[k]:e.target.value}));

  function addCert() {
    if (!form.name.trim()) return;
    onChange([...certs, { ...form, id:uid(), files:[] }]);
    setForm({ name:"", issuer:"", date:"", expiry:"", score:"", note:"", color:CERT_COLORS[0] }); setShowAdd(false);
  }
  function deleteCert(id) { onChange(certs.filter(c=>c.id!==id)); setConfirmDelete(null); }

  function openUpload(certId) { uploadTargetRef.current=certId; setTimeout(()=>fileInputRef.current?.click(),50); }

  async function handleFileSelect(e) {
    const files=Array.from(e.target.files); if(!files.length||!folderId) return;
    const certId=uploadTargetRef.current;
    setUploadingCert(certId);
    try {
      const uploaded=await Promise.all(files.map(f=>uploadFileToDrive(f,folderId)));
      const newFiles=uploaded.map(r=>({ id:uid(), driveId:r.id, name:r.name, size:formatBytes(r.size), date:today(), webViewLink:r.webViewLink }));
      onChange(certs.map(c=>c.id!==certId?c:{...c,files:[...(c.files||[]),...newFiles]}));
    } catch(err) { alert("\uC5C5\uB85C\uB4DC \uC2E4\uD328: "+err.message); }
    finally { setUploadingCert(null); uploadTargetRef.current=null; if(fileInputRef.current) fileInputRef.current.value=""; }
  }

  async function deleteFile(certId, file) {
    setDeletingFile(file.id);
    try { if(file.driveId) await deleteFileFromDrive(file.driveId); onChange(certs.map(c=>c.id!==certId?c:{...c,files:(c.files||[]).filter(f=>f.id!==file.id)})); }
    catch(err) { console.error(err); } finally { setDeletingFile(null); }
  }

  function expiryStatus(expiry) {
    if (!expiry) return null;
    const diff=diffDays(expiry);
    if (diff<0)  return { text:"\uB9CC\uB8CC\uB428", color:C.danger };
    if (diff<90) return { text:`${diff}\uC77C \uD6C4 \uB9CC\uB8CC`, color:C.warning };
    return { text:"\uC720\uD6A8", color:C.success };
  }

  return (
    <div>
      <input ref={fileInputRef} type="file" multiple style={{ display:"none" }} onChange={handleFileSelect}/>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:32 }}>
        <div>
          <h2 style={{ fontSize:20, fontWeight:700, color:C.text1, fontFamily:"Georgia,serif" }}>{"\uC790\uACA9\uC99D \uBCF4\uAD00\uD568"}</h2>
          <p style={{ fontSize:13, color:C.text2, marginTop:4 }}>{"\uCDE8\uB4DD\uD55C \uC790\uACA9\uC99D\uC744 \uAD00\uB9AC\uD558\uACE0 \uAD00\uB828 \uD30C\uC77C\uC744 \uBCF4\uAD00\uD569\uB2C8\uB2E4"}</p>
        </div>
        <Btn icon={Plus} onClick={()=>setShowAdd(true)}>{"\uC790\uACA9\uC99D \uCD94\uAC00"}</Btn>
      </div>

      {certs.length===0 && <EmptyState icon={Award} title={"\uBCF4\uC720\uD55C \uC790\uACA9\uC99D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4"} sub={"\uCDE8\uB4DD\uD55C \uC790\uACA9\uC99D\uC744 \uCD94\uAC00\uD558\uC138\uC694"} action={<Btn icon={Plus} onClick={()=>setShowAdd(true)}>{"\uC790\uACA9\uC99D \uCD94\uAC00"}</Btn>}/>}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:16 }}>
        {certs.map(cert=>{
          const status=expiryStatus(cert.expiry);
          return (
            <div key={cert.id} style={{ borderRadius:16, overflow:"hidden", background:cert.color, border:`1px solid ${cert.color}88` }}>
              <div style={{ padding:20, paddingBottom:16 }}>
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:16 }}>
                  <div style={{ borderRadius:12, padding:10, background:"rgba(255,255,255,0.12)" }}><Award size={18} color="rgba(255,255,255,0.9)"/></div>
                  <div style={{ display:"flex", gap:4 }}>
                    <button onClick={()=>openUpload(cert.id)} disabled={uploadingCert===cert.id} style={{ background:"rgba(255,255,255,0.15)", border:"none", cursor:"pointer", padding:6, borderRadius:8, display:"flex", color:"rgba(255,255,255,0.8)" }}>
                      {uploadingCert===cert.id?<Loader2 size={12} style={{ animation:"spin 1s linear infinite" }}/>:<Upload size={12}/>}
                    </button>
                    <button onClick={()=>setConfirmDelete(cert.id)} style={{ background:"rgba(255,255,255,0.15)", border:"none", cursor:"pointer", padding:6, borderRadius:8, display:"flex", color:"rgba(255,255,255,0.8)" }}><Trash2 size={12}/></button>
                  </div>
                </div>
                <h3 style={{ fontSize:15, fontWeight:700, color:"rgba(255,255,255,0.95)", marginBottom:4 }}>{cert.name}</h3>
                {cert.issuer&&<p style={{ fontSize:12, color:"rgba(255,255,255,0.55)" }}>{cert.issuer}</p>}
                {cert.score&&<div style={{ marginTop:10, display:"inline-block", fontSize:13, fontWeight:700, padding:"4px 12px", borderRadius:99, background:"rgba(255,255,255,0.15)", color:"rgba(255,255,255,0.9)" }}>{cert.score}</div>}
              </div>
              <div style={{ padding:"10px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", background:"rgba(0,0,0,0.2)", borderTop:"1px solid rgba(255,255,255,0.08)" }}>
                <span style={{ fontSize:11, color:"rgba(255,255,255,0.55)" }}>{cert.date?formatDate(cert.date):"\uB0A0\uC9DC \uBBF8\uC785\uB825"}</span>
                {status&&<span style={{ fontSize:11, fontWeight:500, padding:"2px 8px", borderRadius:99, background:status.color+"25", color:status.color }}>{status.text}</span>}
              </div>
              {(cert.files||[]).length>0&&(
                <div style={{ background:"rgba(0,0,0,0.15)", borderTop:"1px solid rgba(255,255,255,0.06)" }}>
                  {(cert.files||[]).map(f=>(
                    <div key={f.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 16px", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                      <FileText size={11} color="rgba(255,255,255,0.5)"/>
                      <span style={{ flex:1, fontSize:11, color:"rgba(255,255,255,0.6)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</span>
                      {f.webViewLink&&<a href={f.webViewLink} target="_blank" rel="noreferrer" style={{ color:"rgba(255,255,255,0.5)", display:"flex" }}><Eye size={11}/></a>}
                      <button onClick={()=>deleteFile(cert.id,f)} disabled={deletingFile===f.id} style={{ background:"transparent", border:"none", cursor:"pointer", display:"flex", color:"rgba(255,255,255,0.4)", padding:2 }}>
                        {deletingFile===f.id?<Loader2 size={10} style={{ animation:"spin 1s linear infinite" }}/>:<Trash2 size={10}/>}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {cert.note&&<div style={{ padding:"8px 20px", fontSize:11, color:"rgba(255,255,255,0.4)", background:"rgba(0,0,0,0.15)" }}>{cert.note}</div>}
            </div>
          );
        })}
      </div>

      {showAdd&&(
        <Modal title={"\uC790\uACA9\uC99D \uCD94\uAC00"} onClose={()=>setShowAdd(false)}>
          <div style={{ ...S.col, gap:12 }}>
            <Input label={"\uC790\uACA9\uC99D\uBA85 *"} value={form.name} onChange={f("name")} placeholder="TOEIC, OPIc, \uC815\uBCF4\uCC98\uB9AC\uAE30\uC0AC ..."/>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <Input label={"\uBC1C\uAE09 \uAE30\uAD00"} value={form.issuer} onChange={f("issuer")} placeholder="ETS ..."/>
              <Input label={"\uC810\uC218/\uB4F1\uAE09"} value={form.score} onChange={f("score")} placeholder="900, IM2 ..."/>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <Input label={"\uCDE8\uB4DD\uC77C"} type="date" value={form.date} onChange={f("date")}/>
              <Input label={"\uB9CC\uB8CC\uC77C"} type="date" value={form.expiry} onChange={f("expiry")}/>
            </div>
            <Textarea label={"\uBA54\uBAA8"} value={form.note} onChange={f("note")} placeholder="\uAC31\uC2E0 \uC694\uAC74, \uC81C\uCD9C\uCC98 \uB4F1 ..."/>
            <Field label={"\uCE74\uB4DC \uC0C9\uC0C1"}>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {CERT_COLORS.map(c=>(<button key={c} onClick={()=>setForm(p=>({...p,color:c}))} style={{ width:28, height:28, borderRadius:"50%", background:c, border: form.color===c?"3px solid white":"3px solid transparent", cursor:"pointer", outline:"none" }}/>))}
              </div>
            </Field>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:4 }}>
              <Btn variant="ghost" onClick={()=>setShowAdd(false)}>{"\uCDE8\uC18C"}</Btn>
              <Btn onClick={addCert}>{"\uCD94\uAC00"}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {confirmDelete&&(
        <Modal title={"\uC0AD\uC81C \uD655\uC778"} onClose={()=>setConfirmDelete(null)}>
          <p style={{ fontSize:13, color:C.text2, marginBottom:20 }}>{"\uC774 \uC790\uACA9\uC99D\uC744 \uC0AD\uC81C\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?"}</p>
          <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
            <Btn variant="ghost" onClick={()=>setConfirmDelete(null)}>{"\uCDE8\uC18C"}</Btn>
            <Btn variant="danger" onClick={()=>deleteCert(confirmDelete)}>{"\uC0AD\uC81C"}</Btn>
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
  const [form, setForm] = useState({ title:"", date:today(), type:"exam", note:"", isDday:true });
  const fld = k => e => setForm(p=>({...p,[k]:e.target.value}));

  function openAdd(date=today()) { setForm(p=>({...p,date})); setShowAdd(true); }
  function addEvent() {
    if (!form.title.trim()||!form.date) return;
    onChange([...events,{...form,id:uid(),isDday:form.isDday}]);
    setForm({ title:"", date:today(), type:"exam", note:"", isDday:true }); setShowAdd(false);
  }
  function deleteEvent(id) { onChange(events.filter(e=>e.id!==id)); }

  function getMonthGrid(d) {
    const y=d.getFullYear(),m=d.getMonth(),first=new Date(y,m,1),last=new Date(y,m+1,0),cells=[];
    for(let i=0;i<first.getDay();i++) cells.push(null);
    for(let n=1;n<=last.getDate();n++) cells.push(new Date(y,m,n));
    while(cells.length%7!==0) cells.push(null);
    return cells;
  }
  function eventsOn(d) { if(!d) return []; return events.filter(e=>e.date===d.toISOString().split("T")[0]); }
  function getWeekDates(d) { const b=new Date(d); b.setDate(d.getDate()-d.getDay()); return Array.from({length:7},(_,i)=>{ const x=new Date(b); x.setDate(b.getDate()+i); return x; }); }

  const todayStr=today(),monthGrid=getMonthGrid(cursor),weekDates=getWeekDates(cursor);

  return (
    <div>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:32 }}>
        <div>
          <h2 style={{ fontSize:20, fontWeight:700, color:C.text1, fontFamily:"Georgia,serif" }}>{"\uD559\uC2B5 \uC2A4\uCF00\uC904\uB7EC"}</h2>
          <p style={{ fontSize:13, color:C.text2, marginTop:4 }}>{"\uC2DC\uD5D8 \uC77C\uC815\uACFC D-Day\uB97C \uAD00\uB9AC\uD569\uB2C8\uB2E4"}</p>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <div style={{ display:"flex", borderRadius:10, overflow:"hidden", border:`1px solid ${C.border2}` }}>
            {["month","week"].map(v=>(
              <button key={v} onClick={()=>setView(v)} style={{ padding:"7px 14px", fontSize:12, fontWeight:500, background:view===v?C.accent:"transparent", color:view===v?"white":C.text2, border:"none", cursor:"pointer", fontFamily:"inherit" }}>
                {v==="month"?"\uC6D4\uAC04":"\uC8FC\uAC04"}
              </button>
            ))}
          </div>
          <Btn icon={Plus} onClick={()=>openAdd()}>{"\uC77C\uC815 \uCD94\uAC00"}</Btn>
        </div>
      </div>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
        <button onClick={()=>view==="month"?setCursor(p=>new Date(p.getFullYear(),p.getMonth()-1,1)):setCursor(p=>{const d=new Date(p);d.setDate(d.getDate()-7);return d;})} style={{ background:"transparent", border:"none", cursor:"pointer", padding:6, color:C.text2, display:"flex", borderRadius:8 }}><ChevronLeft size={15}/></button>
        <span style={{ fontSize:14, fontWeight:600, color:C.text1 }}>
          {view==="month"?cursor.toLocaleDateString("ko-KR",{year:"numeric",month:"long"}):`${weekDates[0].toLocaleDateString("ko-KR",{month:"short",day:"numeric"})} – ${weekDates[6].toLocaleDateString("ko-KR",{month:"short",day:"numeric"})}`}
        </span>
        <button onClick={()=>view==="month"?setCursor(p=>new Date(p.getFullYear(),p.getMonth()+1,1)):setCursor(p=>{const d=new Date(p);d.setDate(d.getDate()+7);return d;})} style={{ background:"transparent", border:"none", cursor:"pointer", padding:6, color:C.text2, display:"flex", borderRadius:8 }}><ChevronRight size={15}/></button>
      </div>

      {view==="month"&&(
        <div style={{ ...S.card, overflow:"hidden", marginBottom:24 }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)" }}>
            {WEEKDAYS.map((d,i)=>(
              <div key={d} style={{ padding:"10px 0", textAlign:"center", fontSize:11, fontWeight:600, color:i===0?C.danger:i===6?C.accent:C.text3, background:C.surface, borderBottom:`1px solid ${C.border}` }}>{d}</div>
            ))}
            {monthGrid.map((day,i)=>{
              const evs=eventsOn(day),ds=day?.toISOString().split("T")[0],isToday=ds===todayStr,isWeekend=day&&(day.getDay()===0||day.getDay()===6);
              return (
                <div key={i} onClick={()=>day&&openAdd(ds)} style={{ minHeight:80, padding:6, cursor:day?"pointer":"default", background:day?"transparent":C.surface2, borderRight:(i+1)%7!==0?`1px solid ${C.border}`:"none", borderBottom:i<monthGrid.length-7?`1px solid ${C.border}`:"none" }}>
                  {day&&(
                    <>
                      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:2 }}>
                        <span style={{ fontSize:11, width:22, height:22, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:"50%", fontWeight:500, background:isToday?C.accent:"transparent", color:isToday?"white":isWeekend?(day.getDay()===0?C.danger:C.accent):C.text2 }}>{day.getDate()}</span>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                        {evs.slice(0,2).map(e=>(
                          <div key={e.id} onClick={ev=>{ev.stopPropagation();deleteEvent(e.id);}} style={{ fontSize:10, borderRadius:4, padding:"1px 4px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", background:EVENT_TYPES[e.type]?.color+"22", color:EVENT_TYPES[e.type]?.color, cursor:"pointer" }}>
                            {e.isDday&&"\u2605 "}{e.title}
                          </div>
                        ))}
                        {evs.length>2&&<div style={{ fontSize:10, color:C.text3, paddingLeft:4 }}>+{evs.length-2}</div>}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view==="week"&&(
        <div style={{ ...S.card, overflow:"hidden", marginBottom:24 }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)" }}>
            {weekDates.map((day,i)=>{
              const ds=day.toISOString().split("T")[0],isToday=ds===todayStr,evs=eventsOn(day);
              return (
                <div key={i} style={{ borderRight:i<6?`1px solid ${C.border}`:"none" }}>
                  <div onClick={()=>openAdd(ds)} style={{ padding:"10px 0", textAlign:"center", cursor:"pointer", background:C.surface, borderBottom:`1px solid ${C.border}` }}>
                    <div style={{ fontSize:11, color:i===0?C.danger:i===6?C.accent:C.text3, marginBottom:4 }}>{WEEKDAYS[i]}</div>
                    <div style={{ fontSize:16, fontWeight:700, width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:"50%", margin:"0 auto", background:isToday?C.accent:"transparent", color:isToday?"white":C.text1 }}>{day.getDate()}</div>
                  </div>
                  <div style={{ padding:4, minHeight:120, display:"flex", flexDirection:"column", gap:4 }}>
                    {evs.map(e=>(
                      <div key={e.id} onClick={()=>deleteEvent(e.id)} style={{ fontSize:11, borderRadius:6, padding:"4px 6px", background:EVENT_TYPES[e.type]?.color+"22", color:EVENT_TYPES[e.type]?.color, cursor:"pointer", fontWeight:500 }}>
                        {e.isDday&&"\u2605 "}{e.title}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h3 style={{ fontSize:13, fontWeight:600, color:C.text1, marginBottom:12 }}>{"\uC804\uCCB4 \uC77C\uC815"} <span style={{ color:C.text3 }}>({events.length})</span></h3>
        {events.length===0
          ? <p style={{ fontSize:13, color:C.text2 }}>{"\uC77C\uC815\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</p>
          : <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {[...events].sort((a,b)=>new Date(a.date)-new Date(b.date)).map(e=>{
                const diff=diffDays(e.date);
                return (
                  <div key={e.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 16px", ...S.card }}>
                    <div style={{ width:8, height:8, borderRadius:"50%", background:EVENT_TYPES[e.type]?.color, flexShrink:0 }}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:500, color:C.text1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {e.isDday&&<span style={{ color:C.accent, marginRight:4 }}>★</span>}{e.title}
                      </div>
                      {e.note&&<div style={{ fontSize:11, color:C.text3, marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.note}</div>}
                    </div>
                    <span style={{ fontSize:11, color:C.text3, flexShrink:0 }}>{formatDate(e.date)}</span>
                    {e.isDday&&<span style={{ fontSize:11, fontWeight:700, fontVariantNumeric:"tabular-nums", flexShrink:0, padding:"2px 8px", borderRadius:99, background:diff<0?"rgba(148,163,184,0.1)":diff===0?C.danger+"20":C.accent+"18", color:diff<0?C.text3:diff===0?C.danger:C.accent }}>{dDayLabel(diff)}</span>}
                    <button onClick={()=>deleteEvent(e.id)} style={{ background:"transparent", border:"none", cursor:"pointer", padding:4, color:C.danger, display:"flex", flexShrink:0 }}><Trash2 size={12}/></button>
                  </div>
                );
              })}
            </div>
        }
      </div>

      {showAdd&&(
        <Modal title={"\uC77C\uC815 \uCD94\uAC00"} onClose={()=>setShowAdd(false)}>
          <div style={{ ...S.col, gap:12 }}>
            <Input label={"\uC81C\uBAA9 *"} value={form.title} onChange={fld("title")} onKeyDown={e=>e.key==="Enter"&&addEvent()} placeholder="TOEIC \uC2DC\uD5D8 ..."/>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <Input label={"\uB0A0\uC9DC *"} type="date" value={form.date} onChange={fld("date")}/>
              <SelectInput label={"\uC720\uD615"} value={form.type} onChange={fld("type")}>
                {Object.entries(EVENT_TYPES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
              </SelectInput>
            </div>
            <Textarea label={"\uBA54\uBAA8"} value={form.note} onChange={fld("note")} placeholder="\uC7A5\uC18C, \uC900\uBE44\uBB3C \uB4F1 ..."/>
            <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
              <div style={{ position:"relative", width:40, height:22, flexShrink:0 }} onClick={()=>setForm(p=>({...p,isDday:!p.isDday}))}>
                <div style={{ position:"absolute", inset:0, borderRadius:99, background:form.isDday?C.accent:C.surface3, transition:"background 0.2s" }}/>
                <div style={{ position:"absolute", top:2, left:form.isDday?20:2, width:18, height:18, borderRadius:"50%", background:"white", transition:"left 0.2s" }}/>
              </div>
              <span style={{ fontSize:13, color:C.text2 }}>D-Day \uCE74\uC6B4\uD2B8\uB2E4\uC6B4 \uD45C\uC2DC</span>
            </label>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:4 }}>
              <Btn variant="ghost" onClick={()=>setShowAdd(false)}>{"\uCDE8\uC18C"}</Btn>
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
  const upcoming=events.filter(e=>e.isDday&&diffDays(e.date)>=0).length;
  const navItems=[
    { id:"dashboard", label:"\uB300\uC2DC\uBCF4\uB4DC",           icon:LayoutDashboard },
    { id:"library",   label:"\uAC15\uC758 \uC790\uB8CC\uC2E4",    icon:BookOpen },
    { id:"certs",     label:"\uC790\uACA9\uC99D \uBCF4\uAD00\uD568", icon:Award, badge:certs.length },
    { id:"scheduler", label:"\uD559\uC2B5 \uC2A4\uCF00\uC904\uB7EC", icon:Calendar, badge:upcoming||null },
  ];
  return (
    <nav style={{ width:220, minWidth:220, display:"flex", flexDirection:"column", height:"100%" }}>
      <div style={{ padding:"20px 20px 12px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ borderRadius:12, padding:8, background:`${C.accent}18`, border:`1px solid ${C.accent}30` }}><GraduationCap size={16} color={C.accent}/></div>
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:C.text1, fontFamily:"Georgia,serif", letterSpacing:"-0.3px" }}>CareerKit</div>
            <div style={{ display:"flex", alignItems:"center", gap:5, marginTop:2 }}>
              <SyncDot status={syncStatus}/>
              <span style={{ fontSize:10, color:C.text3 }}>{syncStatus==="synced"?"Drive \uB3D9\uAE30\uD654":syncStatus==="syncing"?"\uC800\uC7A5 \uC911...":"\uC624\uB958"}</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex:1, padding:"4px 12px", overflowY:"auto" }}>
        {navItems.map(item=>{
          const active=page===item.id;
          return (
            <button key={item.id} onClick={()=>setPage(item.id)} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:12, width:"100%", textAlign:"left", cursor:"pointer", fontFamily:"inherit", marginBottom:2, background:active?`${C.accent}18`:"transparent", color:active?C.accent:C.text2, border:active?`1px solid ${C.accent}30`:"1px solid transparent", transition:"all 0.15s" }}>
              <item.icon size={15} style={{ flexShrink:0 }}/>
              <span style={{ flex:1, fontSize:13, fontWeight:500 }}>{item.label}</span>
              {item.badge>0&&<span style={{ fontSize:10, fontWeight:700, padding:"1px 6px", borderRadius:99, background:active?C.accent:C.surface3, color:active?"white":C.text2 }}>{item.badge}</span>}
            </button>
          );
        })}
      </div>

      <div style={{ padding:"12px 16px", borderTop:`1px solid ${C.border}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
          {userInfo?.picture
            ? <img src={userInfo.picture} alt="" style={{ width:32, height:32, borderRadius:"50%", border:`2px solid ${C.border2}`, flexShrink:0 }}/>
            : <div style={{ width:32, height:32, borderRadius:"50%", background:C.surface3, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><GraduationCap size={14} color={C.text2}/></div>
          }
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:12, fontWeight:600, color:C.text1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{userInfo?.name||"User"}</div>
            <div style={{ fontSize:10, color:C.text3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{userInfo?.email||""}</div>
          </div>
        </div>
        <button onClick={onSignOut} style={{ display:"flex", alignItems:"center", gap:6, width:"100%", padding:"7px 12px", borderRadius:10, background:"transparent", border:`1px solid ${C.border}`, color:C.text3, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
          <LogOut size={12}/>{"\uB85C\uADF8\uC544\uC6C3"}
        </button>
      </div>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [authState, setAuthState] = useState("loading");
  const [page, setPage] = useState("dashboard");
  const [data, setData] = useState(EMPTY_DATA);
  const [syncStatus, setSyncStatus] = useState("synced");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userInfo, setUserInfo] = useState(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const dataFileIdRef=useRef(null), folderIdRef=useRef(null), tokenClientRef=useRef(null), saveTimerRef=useRef(null);

  useEffect(()=>{
    (async()=>{
      await Promise.all([initGapi(),initGis()]);
      tokenClientRef.current=window.google.accounts.oauth2.initTokenClient({ client_id:CLIENT_ID, scope:SCOPES, callback:handleTokenResponse });
      if (loadCachedToken()) { try { await bootstrapApp(); setAuthState("app"); } catch { clearToken(); setAuthState("login"); } }
      else setAuthState("login");
    })();
  },[]);

  async function handleTokenResponse(resp) {
    if (resp.error) { setLoginLoading(false); return; }
    saveToken(resp); await bootstrapApp(); setAuthState("app"); setLoginLoading(false);
  }

  async function bootstrapApp() {
    const uRes=await fetch("https://www.googleapis.com/oauth2/v3/userinfo",{ headers:{ Authorization:`Bearer ${window.gapi.client.getToken().access_token}` } });
    const u=await uRes.json(); setUserInfo({ name:u.name, email:u.email, picture:u.picture });
    const existing=await findFile(DATA_FILE_NAME);
    if (existing) { dataFileIdRef.current=existing.id; const loaded=await readJsonFile(existing.id); setData({ library:loaded.library||[], certs:loaded.certs||[], events:loaded.events||[] }); }
    else { dataFileIdRef.current=await createJsonFile(DATA_FILE_NAME,EMPTY_DATA); }
    const folder=await findFile(FOLDER_NAME,"drive");
    folderIdRef.current=folder?folder.id:await getOrCreateFolder();
  }

  function handleSignIn() { setLoginLoading(true); tokenClientRef.current?.requestAccessToken({ prompt:"consent" }); }
  function handleSignOut() {
    const token=window.gapi.client.getToken(); if(token) window.google.accounts.oauth2.revoke(token.access_token);
    clearToken(); setData(EMPTY_DATA); setUserInfo(null); dataFileIdRef.current=null; folderIdRef.current=null; setAuthState("login");
  }

  function scheduleSave(newData) {
    if (!dataFileIdRef.current) return; setSyncStatus("syncing");
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current=setTimeout(async()=>{ try { await updateJsonFile(dataFileIdRef.current,newData); setSyncStatus("synced"); } catch(e) { console.error(e); setSyncStatus("error"); } },1500);
  }

  const updateLibrary=useCallback(library=>{ const d={...data,library}; setData(d); scheduleSave(d); },[data]);
  const updateCerts=useCallback(certs=>{ const d={...data,certs}; setData(d); scheduleSave(d); },[data]);
  const updateEvents=useCallback(events=>{ const d={...data,events}; setData(d); scheduleSave(d); },[data]);

  const globalStyle = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #root { height: 100%; }
    body { background: ${C.bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
    ::-webkit-scrollbar { width: 4px; height: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 99px; }
    input, select, textarea, button { font-family: inherit; }
    input[type=date]::-webkit-calendar-picker-indicator { filter: invert(0.4); }
    select option { background: ${C.surface2}; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
    a { text-decoration: none; }
  `;

  if (authState==="loading") return (
    <>
      <style>{globalStyle}</style>
      <div style={{ height:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:C.bg }}>
        <Loader2 size={32} color={C.accent} style={{ animation:"spin 1s linear infinite" }}/>
      </div>
    </>
  );

  if (authState==="login") return (
    <>
      <style>{globalStyle}</style>
      <LoginScreen onSignIn={handleSignIn} loading={loginLoading}/>
    </>
  );

  const pages = {
    dashboard: <Dashboard library={data.library} certs={data.certs} events={data.events} setPage={setPage} userInfo={userInfo}/>,
    library:   <Library   library={data.library} onChange={updateLibrary} folderId={folderIdRef.current}/>,
    certs:     <Certificates certs={data.certs} onChange={updateCerts} folderId={folderIdRef.current}/>,
    scheduler: <Scheduler events={data.events} onChange={updateEvents}/>,
  };

  return (
    <>
      <style>{globalStyle}</style>
      <div style={{ display:"flex", height:"100vh", overflow:"hidden", background:C.bg }}>
        {/* Sidebar desktop */}
        <div style={{ display:"none", flexShrink:0, background:C.surface, borderRight:`1px solid ${C.border}` }} className="sidebar-desktop">
          <Sidebar page={page} setPage={setPage} certs={data.certs} events={data.events} syncStatus={syncStatus} onSignOut={handleSignOut} userInfo={userInfo}/>
        </div>

        {/* Sidebar always visible on wide screen via extra style */}
        <style>{`@media(min-width:768px){.sidebar-desktop{display:flex!important;flex-direction:column;}}`}</style>

        {/* Mobile overlay */}
        {sidebarOpen&&(
          <div onClick={()=>setSidebarOpen(false)} style={{ position:"fixed", inset:0, zIndex:40, background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)" }}>
            <div onClick={e=>e.stopPropagation()} style={{ position:"absolute", left:0, top:0, bottom:0, width:240, background:C.surface, borderRight:`1px solid ${C.border2}`, display:"flex", flexDirection:"column" }}>
              <Sidebar page={page} setPage={p=>{setPage(p);setSidebarOpen(false);}} certs={data.certs} events={data.events} syncStatus={syncStatus} onSignOut={handleSignOut} userInfo={userInfo}/>
            </div>
          </div>
        )}

        {/* Main */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {/* Mobile topbar */}
          <div style={{ display:"flex" }} className="mobile-topbar">
            <style>{`@media(min-width:768px){.mobile-topbar{display:none!important;}}`}</style>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 16px", background:C.surface, borderBottom:`1px solid ${C.border}`, width:"100%" }}>
              <button onClick={()=>setSidebarOpen(true)} style={{ background:"transparent", border:"none", cursor:"pointer", padding:6, color:C.text2, display:"flex", borderRadius:8 }}><Menu size={16}/></button>
              <span style={{ fontSize:14, fontWeight:700, color:C.text1, fontFamily:"Georgia,serif" }}>CareerKit</span>
              <SyncDot status={syncStatus}/>
            </div>
          </div>

          <div style={{ flex:1, overflowY:"auto" }}>
            <div style={{ maxWidth:900, margin:"0 auto", padding:"32px 24px" }}>
              <CountdownBanner events={data.events}/>
              {pages[page]}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
