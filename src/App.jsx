import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  BookOpen, Award, Calendar, LayoutDashboard, Plus, Trash2,
  Upload, ChevronLeft, ChevronRight, X, Edit2, Check,
  Clock, FileText, Image, File, FolderOpen, Folder, AlertCircle,
  GraduationCap, Zap, LogOut, Cloud, CloudOff, RefreshCw,
  Eye, Loader2, Menu, ChevronDown, ChevronRight as CR
} from "lucide-react";

const CLIENT_ID = "406294571592-ufr5l29p3vvv4nfobec3ktosb8euj7gj.apps.googleusercontent.com";
const SCOPES = ["https://www.googleapis.com/auth/drive.appdata","https://www.googleapis.com/auth/drive.file"].join(" ");
const DATA_FILE_NAME = "career_data.json";
const FOLDER_NAME = "CareerKit Files";
const TOKEN_KEY = "career_gapi_token";
const TOKEN_EXPIRY_KEY = "career_gapi_expiry";

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
  localStorage.setItem(TOKEN_KEY, token.access_token);
  localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + (token.expires_in - 60) * 1000));
  window.gapi.client.setToken(token);
}
function loadCachedToken() {
  const token = localStorage.getItem(TOKEN_KEY), expiry = Number(localStorage.getItem(TOKEN_EXPIRY_KEY));
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

function uid() { return Math.random().toString(36).slice(2, 10); }
function today() { return new Date().toISOString().split("T")[0]; }
function diffDays(d) { const t = new Date(d); t.setHours(0,0,0,0); const n = new Date(); n.setHours(0,0,0,0); return Math.round((t-n)/86400000); }
function formatDate(d) { if (!d) return "-"; return new Date(d).toLocaleDateString("ko-KR", { year:"numeric", month:"short", day:"numeric" }); }
function formatBytes(b) { if (!b) return ""; if (b<1024) return b+"B"; if (b<1048576) return (b/1024).toFixed(1)+"KB"; return (b/1048576).toFixed(1)+"MB"; }
function dDayLabel(d) { if (d===0) return "D-Day"; return d>0?`D-${d}`:`D+${Math.abs(d)}`; }

const C = {
  bg:"#080c14", surface:"#0f1521", surface2:"#161e2e", surface3:"#1c2640",
  border:"rgba(255,255,255,0.06)", border2:"rgba(255,255,255,0.10)",
  accent:"#818cf8", text1:"#f1f5f9", text2:"#8892a4", text3:"#4a5568",
  danger:"#f87171", success:"#34d399", warning:"#fbbf24",
};
const SECTION_COLORS = ["#818cf8","#38bdf8","#34d399","#fbbf24","#f87171","#c084fc","#f472b6","#2dd4bf"];
const CERT_COLORS    = ["#1e293b","#1e3a5f","#14532d","#7c2d12","#312e81","#4a1942","#064e3b","#334155"];
const EVENT_TYPES = {
  exam:  { label:"\uC2DC\uD5D8",       color:"#f87171" },
  study: { label:"\uD559\uC2B5",       color:"#818cf8" },
  cert:  { label:"\uC790\uACA9\uC99D", color:"#34d399" },
  other: { label:"\uAE30\uD0C0",       color:"#8892a4" },
};
const WEEKDAYS = ["\uC77C","\uC6D4","\uD654","\uC218","\uBAA9","\uAE08","\uD1A0"];
const EMPTY_DATA = { library:[], certCategories:[], events:[] };

// ─── JSON Schema ───────────────────────────────────────────
// Section: { id, subject, color, folders:[{ id, name, files:[File] }], files:[File] }
// File: { id, driveId, name, size, date, webViewLink }
// CertCategory: { id, name, color, certs:[Cert] }
// Cert: { id, name, issuer, date, expiry, score, note, color, files:[File] }

const S = {
  card: { background:C.surface, border:`1px solid ${C.border2}`, borderRadius:16 },
  input: { background:C.surface, border:`1px solid ${C.border2}`, borderRadius:10, color:C.text1, padding:"8px 12px", fontSize:13, width:"100%", outline:"none", boxSizing:"border-box" },
  label: { fontSize:11, fontWeight:500, color:C.text2, marginBottom:4, display:"block" },
  col: { display:"flex", flexDirection:"column", gap:6 },
};

// ─── PRIMITIVES ────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  useEffect(() => { const fn = e => e.key==="Escape"&&onClose(); window.addEventListener("keydown",fn); return ()=>window.removeEventListener("keydown",fn); },[onClose]);
  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{ position:"fixed",inset:0,zIndex:50,display:"flex",alignItems:"center",justifyContent:"center",padding:16,background:"rgba(0,0,0,0.7)",backdropFilter:"blur(8px)" }}>
      <div style={{ width:"100%",maxWidth:480,borderRadius:20,overflow:"hidden",background:C.surface2,border:`1px solid ${C.border2}`,boxShadow:"0 25px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 24px",borderBottom:`1px solid ${C.border}` }}>
          <span style={{ fontSize:14,fontWeight:600,color:C.text1 }}>{title}</span>
          <button onClick={onClose} style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,borderRadius:8,color:C.text2,display:"flex" }}><X size={14}/></button>
        </div>
        <div style={{ padding:24 }}>{children}</div>
      </div>
    </div>
  );
}
function Btn({ variant="primary", children, icon:Icon, loading, style:ext={}, size:sz="md", ...props }) {
  const base = { display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,borderRadius:12,fontSize:sz==="sm"?11:13,fontWeight:500,cursor:"pointer",border:"none",transition:"opacity 0.15s",fontFamily:"inherit",padding:sz==="sm"?"5px 10px":"8px 16px" };
  const variants = { primary:{background:C.accent,color:"#fff"}, ghost:{background:"transparent",color:C.text2,border:`1px solid ${C.border2}`}, danger:{background:"rgba(248,113,113,0.12)",color:C.danger,border:"1px solid rgba(248,113,113,0.2)"} };
  return (
    <button {...props} style={{ ...base,...variants[variant],...ext }} onMouseEnter={e=>e.currentTarget.style.opacity="0.8"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
      {loading?<Loader2 size={13} style={{ animation:"spin 1s linear infinite" }}/>:Icon?<Icon size={sz==="sm"?11:13}/>:null}
      {children}
    </button>
  );
}
function Field({ label, children, style:ext={} }) {
  return <div style={{ ...S.col,...ext }}>{label&&<label style={S.label}>{label}</label>}{children}</div>;
}
function Input({ label, style:ext={}, ...props }) {
  return <Field label={label}><input {...props} style={{ ...S.input,...ext }}/></Field>;
}
function Textarea({ label, ...props }) {
  return <Field label={label}><textarea {...props} rows={3} style={{ ...S.input,resize:"none" }}/></Field>;
}
function SelectInput({ label, children, ...props }) {
  return <Field label={label}><select {...props} style={{ ...S.input }}>{children}</select></Field>;
}
function SyncDot({ status }) {
  const map = { synced:C.success, syncing:C.accent, error:C.danger };
  return <div style={{ width:7,height:7,borderRadius:"50%",background:map[status]||C.text3,flexShrink:0,animation:status==="syncing"?"pulse 1s infinite":undefined }}/>;
}
function EmptyState({ icon:Icon, title, sub, action }) {
  return (
    <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"64px 24px",border:`1.5px dashed ${C.border2}`,borderRadius:20,textAlign:"center" }}>
      <div style={{ background:C.surface2,borderRadius:16,padding:16,marginBottom:16 }}><Icon size={28} color={C.text3}/></div>
      <p style={{ fontSize:14,color:C.text2,fontWeight:500,marginBottom:6 }}>{title}</p>
      {sub&&<p style={{ fontSize:12,color:C.text3,marginBottom:16 }}>{sub}</p>}
      {action}
    </div>
  );
}
function PageHeader({ title, sub, action }) {
  return (
    <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:32 }}>
      <div>
        <h2 style={{ fontSize:20,fontWeight:700,color:C.text1,fontFamily:"Georgia,serif" }}>{title}</h2>
        {sub&&<p style={{ fontSize:13,color:C.text2,marginTop:4 }}>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

// ─── LOGIN ─────────────────────────────────────────────────
function LoginScreen({ onSignIn, loading }) {
  return (
    <div style={{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:C.bg,padding:24 }}>
      <div style={{ width:"100%",maxWidth:360 }}>
        <div style={{ ...S.card,padding:40,textAlign:"center" }}>
          <div style={{ display:"inline-flex",borderRadius:20,padding:16,marginBottom:24,background:`${C.accent}18`,border:`1px solid ${C.accent}30` }}>
            <GraduationCap size={36} color={C.accent}/>
          </div>
          <h1 style={{ fontSize:28,fontWeight:700,color:C.text1,marginBottom:8,fontFamily:"Georgia,serif" }}>CareerKit</h1>
          <p style={{ fontSize:13,color:C.text2,marginBottom:32,lineHeight:1.6 }}>{"\uCEE4\uB9AC\uC5B4 \uAD00\uB9AC \uD50C\uB7AB\uD3FC"}</p>
          <button onClick={onSignIn} disabled={loading} style={{ width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:"12px 24px",borderRadius:12,border:`1px solid ${C.border2}`,background:C.surface2,color:C.text1,fontSize:14,fontWeight:500,cursor:"pointer",fontFamily:"inherit" }}>
            {loading?<Loader2 size={16} style={{ animation:"spin 1s linear infinite" }}/>:
              <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.2 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1L37 9.8C33.7 6.8 29.1 5 24 5 12.9 5 4 13.9 4 25s8.9 20 20 20 20-8.9 20-20c0-1.3-.2-2.7-.4-4z"/><path fill="#FF3D00" d="M6.3 15.7l6.6 4.8C14.7 17 19 14 24 14c3.1 0 5.8 1.2 7.9 3.1L37 9.8C33.7 6.8 29.1 5 24 5c-7.7 0-14.4 4.2-17.7 10.7z"/><path fill="#4CAF50" d="M24 45c5.1 0 9.7-1.8 13.2-4.7l-6.1-5.2C29.3 36.6 26.8 37 24 37c-5.3 0-9.7-2.9-11.3-7.2l-6.5 5C9.5 40.7 16.3 45 24 45z"/><path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.4-2.3 4.3-4.3 5.6l6.1 5.2C40.8 35.6 44 31 44 25c0-1.3-.2-2.7-.4-4z"/></svg>
            }
            Google{"\uB85C \uB85C\uADF8\uC778"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── COUNTDOWN BANNER ──────────────────────────────────────
function CountdownBanner({ events }) {
  const upcoming = useMemo(()=>events.filter(e=>e.isDday).map(e=>({...e,diff:diffDays(e.date)})).filter(e=>e.diff>=0).sort((a,b)=>a.diff-b.diff).slice(0,3),[events]);
  if (!upcoming.length) return null;
  return (
    <div style={{ display:"flex",gap:12,flexWrap:"wrap",marginBottom:24 }}>
      {upcoming.map(e=>(
        <div key={e.id} style={{ display:"flex",alignItems:"center",gap:12,...S.card,padding:"12px 16px",flex:1,minWidth:180 }}>
          <div style={{ borderRadius:10,padding:8,background:EVENT_TYPES[e.type]?.color+"22" }}><Zap size={13} color={EVENT_TYPES[e.type]?.color}/></div>
          <div style={{ flex:1,minWidth:0 }}>
            <div style={{ fontSize:12,fontWeight:500,color:C.text1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{e.title}</div>
            <div style={{ fontSize:11,color:C.text2,marginTop:2 }}>{formatDate(e.date)}</div>
          </div>
          <span style={{ fontSize:16,fontWeight:900,color:e.diff===0?C.danger:C.accent,fontVariantNumeric:"tabular-nums" }}>{dDayLabel(e.diff)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── DASHBOARD ─────────────────────────────────────────────
function Dashboard({ library, certCategories, events, setPage, userInfo }) {
  const totalFiles = library.reduce((a,s)=>a+(s.files||[]).length+((s.folders||[]).reduce((b,f)=>b+(f.files||[]).length,0)),0);
  const totalCerts = certCategories.reduce((a,cat)=>a+(cat.certs||[]).length,0);
  const nextExam = events.filter(e=>e.isDday&&diffDays(e.date)>=0).sort((a,b)=>diffDays(a.date)-diffDays(b.date))[0];
  const upcomingEvents = [...events].filter(e=>diffDays(e.date)>=0).sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,5);
  const stats = [
    { icon:BookOpen, label:"\uAC15\uC758 \uC139\uC158",       value:library.length,    color:"#818cf8", page:"library" },
    { icon:FileText, label:"\uD559\uC2B5 \uC790\uB8CC",       value:totalFiles,         color:"#38bdf8", page:"library" },
    { icon:Award,    label:"\uBCF4\uC720 \uC790\uACA9\uC99D", value:totalCerts,         color:"#34d399", page:"certs" },
    { icon:Calendar, label:"\uB4F1\uB85D \uC77C\uC815",       value:events.length,      color:"#fbbf24", page:"scheduler" },
  ];
  return (
    <div>
      <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:32 }}>
        {userInfo?.picture&&<img src={userInfo.picture} alt="" style={{ width:44,height:44,borderRadius:"50%",border:`2px solid ${C.border2}` }}/>}
        <div>
          <h2 style={{ fontSize:20,fontWeight:700,color:C.text1,fontFamily:"Georgia,serif" }}>{userInfo?.name?`\uC548\uB155\uD558\uC138\uC694, ${userInfo.name.split(" ")[0]}\uB2D8`:"\uB300\uC2DC\uBCF4\uB4DC"}</h2>
          <p style={{ fontSize:12,color:C.text2 }}>{new Date().toLocaleDateString("ko-KR",{year:"numeric",month:"long",day:"numeric",weekday:"long"})}</p>
        </div>
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:12,marginBottom:24 }}>
        {stats.map(s=>(
          <button key={s.label} onClick={()=>setPage(s.page)} style={{ ...S.card,padding:16,textAlign:"left",cursor:"pointer",fontFamily:"inherit" }} onMouseEnter={e=>e.currentTarget.style.transform="scale(1.02)"} onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
            <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
              <div style={{ borderRadius:10,padding:8,background:s.color+"18" }}><s.icon size={15} color={s.color}/></div>
              <span style={{ fontSize:24,fontWeight:900,color:C.text1,fontVariantNumeric:"tabular-nums" }}>{s.value}</span>
            </div>
            <div style={{ fontSize:11,color:C.text2 }}>{s.label}</div>
          </button>
        ))}
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
        <div style={{ ...S.card,padding:20 }}>
          <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:16 }}><AlertCircle size={13} color={C.danger}/><span style={{ fontSize:13,fontWeight:600,color:C.text1 }}>{"\uB2E4\uC74C D-Day"}</span></div>
          {nextExam?(
            <div style={{ display:"flex",alignItems:"center",gap:16 }}>
              <div style={{ borderRadius:14,padding:"12px 16px",textAlign:"center",background:`${C.accent}18`,border:`1px solid ${C.accent}30`,minWidth:72 }}>
                <div style={{ fontSize:22,fontWeight:900,color:C.accent,fontVariantNumeric:"tabular-nums" }}>{dDayLabel(diffDays(nextExam.date))}</div>
              </div>
              <div>
                <div style={{ fontSize:13,fontWeight:600,color:C.text1 }}>{nextExam.title}</div>
                <div style={{ fontSize:11,color:C.text2,marginTop:4 }}>{formatDate(nextExam.date)}</div>
                <div style={{ fontSize:11,marginTop:6,display:"inline-block",padding:"2px 8px",borderRadius:99,background:EVENT_TYPES[nextExam.type]?.color+"22",color:EVENT_TYPES[nextExam.type]?.color }}>{EVENT_TYPES[nextExam.type]?.label}</div>
              </div>
            </div>
          ):<p style={{ fontSize:13,color:C.text2 }}>{"\uB4F1\uB85D\uB41C D-Day\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."}</p>}
        </div>
        <div style={{ ...S.card,padding:20 }}>
          <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:16 }}><Clock size={13} color={C.accent}/><span style={{ fontSize:13,fontWeight:600,color:C.text1 }}>{"\uC608\uC815 \uC77C\uC815"}</span></div>
          {upcomingEvents.length?(
            <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
              {upcomingEvents.map(e=>(
                <div key={e.id} style={{ display:"flex",alignItems:"center",gap:8 }}>
                  <div style={{ width:6,height:6,borderRadius:"50%",background:EVENT_TYPES[e.type]?.color,flexShrink:0 }}/>
                  <span style={{ fontSize:12,flex:1,color:C.text2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{e.title}</span>
                  <span style={{ fontSize:11,color:C.text3,flexShrink:0 }}>{formatDate(e.date)}</span>
                </div>
              ))}
            </div>
          ):<p style={{ fontSize:13,color:C.text2 }}>{"\uC608\uC815\uB41C \uC77C\uC815\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</p>}
        </div>
      </div>
    </div>
  );
}

// ─── FILE ROW ──────────────────────────────────────────────
function FileRow({ file, color, onDelete, deleting }) {
  function getIcon(name="") { const ext=name.split(".").pop()?.toLowerCase(); if(["jpg","jpeg","png","gif","webp"].includes(ext)) return Image; if(ext==="pdf") return FileText; return File; }
  const FIcon = getIcon(file.name);
  return (
    <div style={{ display:"flex",alignItems:"center",gap:10,padding:"8px 16px",borderBottom:`1px solid ${C.border}` }}>
      <div style={{ borderRadius:7,padding:5,background:(color||C.accent)+"18",flexShrink:0 }}><FIcon size={11} color={color||C.accent}/></div>
      <span style={{ flex:1,fontSize:12,color:C.text2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{file.name}</span>
      <span style={{ fontSize:10,color:C.text3,flexShrink:0 }}>{file.size}</span>
      <span style={{ fontSize:10,color:C.text3,flexShrink:0 }}>{formatDate(file.date)}</span>
      {file.webViewLink&&<a href={file.webViewLink} target="_blank" rel="noreferrer" style={{ color:C.accent,display:"flex",padding:3 }}><Eye size={11}/></a>}
      <button onClick={()=>onDelete(file)} disabled={deleting===file.id} style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.danger,display:"flex",flexShrink:0 }}>
        {deleting===file.id?<Loader2 size={11} style={{ animation:"spin 1s linear infinite" }}/>:<Trash2 size={11}/>}
      </button>
    </div>
  );
}

// ─── LIBRARY ───────────────────────────────────────────────
function Library({ library, onChange, folderId }) {
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSection, setNewSection] = useState({ subject:"", color:SECTION_COLORS[0] });
  const [editSectionId, setEditSectionId] = useState(null);
  const [editSectionName, setEditSectionName] = useState("");
  // folder state
  const [addFolderTarget, setAddFolderTarget] = useState(null); // sectionId
  const [newFolderName, setNewFolderName] = useState("");
  const [editFolderId, setEditFolderId] = useState(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const [collapsedSections, setCollapsedSections] = useState({});
  // upload
  const [uploading, setUploading] = useState(false);
  const [uploadTarget, setUploadTarget] = useState(null); // { sectionId, folderId? }
  const [deletingFile, setDeletingFile] = useState(null);
  const fileInputRef = useRef(null);

  function addSection() {
    if (!newSection.subject.trim()) return;
    onChange([...library,{ id:uid(),subject:newSection.subject.trim(),color:newSection.color,folders:[],files:[] }]);
    setNewSection({ subject:"",color:SECTION_COLORS[0] }); setShowAddSection(false);
  }
  function deleteSection(id) { onChange(library.filter(s=>s.id!==id)); }
  function saveSectionEdit(id) {
    if (!editSectionName.trim()) { setEditSectionId(null); return; }
    onChange(library.map(s=>s.id!==id?s:{...s,subject:editSectionName.trim()})); setEditSectionId(null);
  }

  function addFolder(sectionId) {
    if (!newFolderName.trim()) return;
    onChange(library.map(s=>s.id!==sectionId?s:{...s,folders:[...(s.folders||[]),{ id:uid(),name:newFolderName.trim(),files:[] }]}));
    setNewFolderName(""); setAddFolderTarget(null);
  }
  function deleteFolder(sectionId, folderId) {
    onChange(library.map(s=>s.id!==sectionId?s:{...s,folders:(s.folders||[]).filter(f=>f.id!==folderId)}));
  }
  function saveFolderEdit(sectionId, folderId) {
    if (!editFolderName.trim()) { setEditFolderId(null); return; }
    onChange(library.map(s=>s.id!==sectionId?s:{...s,folders:(s.folders||[]).map(f=>f.id!==folderId?f:{...f,name:editFolderName.trim()})}));
    setEditFolderId(null);
  }

  function openUpload(sectionId, folderId=null) {
    setUploadTarget({ sectionId, folderId });
    setTimeout(()=>fileInputRef.current?.click(),50);
  }
  async function handleFileSelect(e) {
    const files=Array.from(e.target.files); if(!files.length||!folderId||!uploadTarget) return;
    setUploading(true);
    try {
      const uploaded=await Promise.all(files.map(f=>uploadFileToDrive(f,folderId)));
      const newFiles=uploaded.map(r=>({ id:uid(),driveId:r.id,name:r.name,size:formatBytes(r.size),date:today(),webViewLink:r.webViewLink }));
      const { sectionId, folderId:tFolderId } = uploadTarget;
      onChange(library.map(s=>{
        if (s.id!==sectionId) return s;
        if (tFolderId) return { ...s,folders:(s.folders||[]).map(f=>f.id!==tFolderId?f:{...f,files:[...(f.files||[]),...newFiles]}) };
        return { ...s,files:[...(s.files||[]),...newFiles] };
      }));
    } catch(err) { alert("\uC5C5\uB85C\uB4DC \uC2E4\uD328: "+err.message); }
    finally { setUploading(false); setUploadTarget(null); if(fileInputRef.current) fileInputRef.current.value=""; }
  }
  async function deleteFile(sectionId, file, folderId=null) {
    setDeletingFile(file.id);
    try {
      if (file.driveId) await deleteFileFromDrive(file.driveId);
      onChange(library.map(s=>{
        if (s.id!==sectionId) return s;
        if (folderId) return { ...s,folders:(s.folders||[]).map(f=>f.id!==folderId?f:{...f,files:(f.files||[]).filter(fi=>fi.id!==file.id)}) };
        return { ...s,files:(s.files||[]).filter(fi=>fi.id!==file.id) };
      }));
    } catch(err) { console.error(err); } finally { setDeletingFile(null); }
  }

  function toggleSection(id) { setCollapsedSections(p=>({...p,[id]:!p[id]})); }
  function toggleFolder(id) { setCollapsedFolders(p=>({...p,[id]:!p[id]})); }

  return (
    <div>
      <input ref={fileInputRef} type="file" multiple style={{ display:"none" }} onChange={handleFileSelect}/>
      <PageHeader title={"\uAC15\uC758 \uC790\uB8CC\uC2E4"} sub={"\uC139\uC158 \u2192 \uD3F4\uB354 \u2192 \uD30C\uC77C \uAD6C\uC870\uB85C \uAD00\uB9AC\uD569\uB2C8\uB2E4"}
        action={<Btn icon={Plus} onClick={()=>setShowAddSection(true)}>{"\uC0C8 \uC139\uC158"}</Btn>}/>

      {library.length===0&&<EmptyState icon={FolderOpen} title={"\uAC15\uC758 \uC139\uC158\uC774 \uC5C6\uC2B5\uB2C8\uB2E4"} action={<Btn icon={Plus} onClick={()=>setShowAddSection(true)}>{"\uC139\uC158 \uCD94\uAC00"}</Btn>}/>}

      <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
        {library.map(section=>{
          const collapsed=collapsedSections[section.id];
          const totalCount=(section.files||[]).length+(section.folders||[]).reduce((a,f)=>a+(f.files||[]).length,0);
          return (
            <div key={section.id} style={{ ...S.card,overflow:"hidden" }}>
              {/* Section Header */}
              <div style={{ display:"flex",alignItems:"center",gap:10,padding:"14px 20px",borderBottom:collapsed?`1px solid ${C.border}`:"none",borderLeft:`3px solid ${section.color}`,background:C.surface }}>
                <button onClick={()=>toggleSection(section.id)} style={{ background:"transparent",border:"none",cursor:"pointer",padding:2,color:C.text3,display:"flex",flexShrink:0 }}>
                  {collapsed?<CR size={13}/>:<ChevronDown size={13}/>}
                </button>
                {editSectionId===section.id
                  ? <input autoFocus value={editSectionName} onChange={e=>setEditSectionName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveSectionEdit(section.id);if(e.key==="Escape")setEditSectionId(null);}} style={{ flex:1,background:"transparent",border:"none",borderBottom:`1px solid ${section.color}`,color:C.text1,fontSize:13,fontWeight:600,outline:"none",fontFamily:"inherit" }}/>
                  : <span style={{ flex:1,fontSize:13,fontWeight:600,color:C.text1 }}>{section.subject}</span>
                }
                <span style={{ fontSize:11,color:C.text3 }}>{totalCount}{"\uAC1C"}</span>
                {editSectionId===section.id
                  ? <button onClick={()=>saveSectionEdit(section.id)} style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:section.color,display:"flex" }}><Check size={12}/></button>
                  : <button onClick={()=>{setEditSectionId(section.id);setEditSectionName(section.subject);}} style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.text2,display:"flex" }}><Edit2 size={12}/></button>
                }
                <Btn size="sm" icon={FolderOpen} variant="ghost" style={{ background:section.color+"18",color:section.color,border:"none" }} onClick={()=>setAddFolderTarget(section.id)}>{"\uD3F4\uB354"}</Btn>
                <Btn size="sm" icon={Upload} variant="ghost" style={{ background:section.color+"18",color:section.color,border:"none" }} loading={uploading&&uploadTarget?.sectionId===section.id&&!uploadTarget?.folderId} onClick={()=>openUpload(section.id)}>{"\uD30C\uC77C"}</Btn>
                <button onClick={()=>deleteSection(section.id)} style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.danger,display:"flex" }}><Trash2 size={12}/></button>
              </div>

              {!collapsed&&(
                <div>
                  {/* Root files */}
                  {(section.files||[]).map(file=>(
                    <FileRow key={file.id} file={file} color={section.color} onDelete={f=>deleteFile(section.id,f,null)} deleting={deletingFile}/>
                  ))}

                  {/* Folders */}
                  {(section.folders||[]).map(folder=>{
                    const fc=collapsedFolders[folder.id];
                    return (
                      <div key={folder.id} style={{ borderTop:`1px solid ${C.border}` }}>
                        {/* Folder header */}
                        <div style={{ display:"flex",alignItems:"center",gap:8,padding:"10px 20px",background:C.surface2 }}>
                          <button onClick={()=>toggleFolder(folder.id)} style={{ background:"transparent",border:"none",cursor:"pointer",padding:2,color:C.text3,display:"flex" }}>
                            {fc?<CR size={12}/>:<ChevronDown size={12}/>}
                          </button>
                          <Folder size={13} color={section.color} style={{ flexShrink:0 }}/>
                          {editFolderId===folder.id
                            ? <input autoFocus value={editFolderName} onChange={e=>setEditFolderName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveFolderEdit(section.id,folder.id);if(e.key==="Escape")setEditFolderId(null);}} style={{ flex:1,background:"transparent",border:"none",borderBottom:`1px solid ${section.color}`,color:C.text1,fontSize:12,fontWeight:500,outline:"none",fontFamily:"inherit" }}/>
                            : <span style={{ flex:1,fontSize:12,fontWeight:500,color:C.text1 }}>{folder.name}</span>
                          }
                          <span style={{ fontSize:10,color:C.text3 }}>{(folder.files||[]).length}{"\uAC1C"}</span>
                          {editFolderId===folder.id
                            ? <button onClick={()=>saveFolderEdit(section.id,folder.id)} style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:section.color,display:"flex" }}><Check size={11}/></button>
                            : <button onClick={()=>{setEditFolderId(folder.id);setEditFolderName(folder.name);}} style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.text2,display:"flex" }}><Edit2 size={11}/></button>
                          }
                          <button onClick={()=>openUpload(section.id,folder.id)} disabled={uploading&&uploadTarget?.folderId===folder.id} style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:section.color,display:"flex" }}>
                            {uploading&&uploadTarget?.folderId===folder.id?<Loader2 size={11} style={{ animation:"spin 1s linear infinite" }}/>:<Upload size={11}/>}
                          </button>
                          <button onClick={()=>deleteFolder(section.id,folder.id)} style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.danger,display:"flex" }}><Trash2 size={11}/></button>
                        </div>
                        {/* Folder files */}
                        {!fc&&(folder.files||[]).map(file=>(
                          <div key={file.id} style={{ paddingLeft:16 }}>
                            <FileRow file={file} color={section.color} onDelete={f=>deleteFile(section.id,f,folder.id)} deleting={deletingFile}/>
                          </div>
                        ))}
                        {!fc&&(folder.files||[]).length===0&&(
                          <div style={{ paddingLeft:36,padding:"8px 20px 8px 36px",fontSize:11,color:C.text3 }}>{"\uD30C\uC77C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</div>
                        )}
                      </div>
                    );
                  })}

                  {(section.folders||[]).length===0&&(section.files||[]).length===0&&(
                    <div style={{ padding:"14px 20px",fontSize:12,color:C.text3 }}>{"\uD3F4\uB354\uB098 \uD30C\uC77C\uC744 \uCD94\uAC00\uD558\uC138\uC694."}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Section Modal */}
      {showAddSection&&(
        <Modal title={"\uC0C8 \uC139\uC158 \uCD94\uAC00"} onClose={()=>setShowAddSection(false)}>
          <div style={{ ...S.col,gap:16 }}>
            <Input label={"\uACFC\uBAA9\uBA85"} value={newSection.subject} onChange={e=>setNewSection(p=>({...p,subject:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addSection()} placeholder="NCS \uC9C1\uC5C5\uAE30\uCD08\uB2A5\uB825, TOEIC ..."/>
            <Field label={"\uC0C9\uC0C1"}>
              <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
                {SECTION_COLORS.map(c=>(<button key={c} onClick={()=>setNewSection(p=>({...p,color:c}))} style={{ width:28,height:28,borderRadius:"50%",background:c,border:newSection.color===c?"3px solid white":"3px solid transparent",cursor:"pointer",outline:"none",opacity:newSection.color===c?1:0.5 }}/>))}
              </div>
            </Field>
            <div style={{ display:"flex",gap:8,justifyContent:"flex-end" }}>
              <Btn variant="ghost" onClick={()=>setShowAddSection(false)}>{"\uCDE8\uC18C"}</Btn>
              <Btn onClick={addSection}>{"\uCD94\uAC00"}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Add Folder Modal */}
      {addFolderTarget&&(
        <Modal title={"\uD3F4\uB354 \uCD94\uAC00"} onClose={()=>setAddFolderTarget(null)}>
          <div style={{ ...S.col,gap:16 }}>
            <Input label={"\uD3F4\uB354 \uC774\uB984"} value={newFolderName} onChange={e=>setNewFolderName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addFolder(addFolderTarget)} placeholder="\uC608: 1\uC8FC\uCC28, \uC2E4\uC804\uBB38\uC81C, \uC815\uB9AC\uB178\uD2B8 ..."/>
            <div style={{ display:"flex",gap:8,justifyContent:"flex-end" }}>
              <Btn variant="ghost" onClick={()=>setAddFolderTarget(null)}>{"\uCDE8\uC18C"}</Btn>
              <Btn onClick={()=>addFolder(addFolderTarget)}>{"\uCD94\uAC00"}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── CERTIFICATES ──────────────────────────────────────────
function Certificates({ certCategories, onChange, folderId }) {
  const [showAddCat, setShowAddCat] = useState(false);
  const [newCat, setNewCat] = useState({ name:"", color:SECTION_COLORS[0] });
  const [showAddCert, setShowAddCert] = useState(null); // categoryId
  const [certForm, setCertForm] = useState({ name:"",issuer:"",date:"",expiry:"",score:"",note:"",color:CERT_COLORS[0] });
  const [confirmDelete, setConfirmDelete] = useState(null); // { type:'cat'|'cert', catId, certId? }
  const [collapsedCats, setCollapsedCats] = useState({});
  const [uploadingCert, setUploadingCert] = useState(null);
  const [deletingFile, setDeletingFile] = useState(null);
  const fileInputRef = useRef(null);
  const uploadTargetRef = useRef(null);
  const cf = k => e => setCertForm(p=>({...p,[k]:e.target.value}));

  function addCategory() {
    if (!newCat.name.trim()) return;
    onChange([...certCategories,{ id:uid(),name:newCat.name.trim(),color:newCat.color,certs:[] }]);
    setNewCat({ name:"",color:SECTION_COLORS[0] }); setShowAddCat(false);
  }
  function deleteCategory(id) { onChange(certCategories.filter(c=>c.id!==id)); setConfirmDelete(null); }
  function addCert(catId) {
    if (!certForm.name.trim()) return;
    onChange(certCategories.map(cat=>cat.id!==catId?cat:{...cat,certs:[...(cat.certs||[]),{...certForm,id:uid(),files:[]}]}));
    setCertForm({ name:"",issuer:"",date:"",expiry:"",score:"",note:"",color:CERT_COLORS[0] }); setShowAddCert(null);
  }
  function deleteCert(catId, certId) {
    onChange(certCategories.map(cat=>cat.id!==catId?cat:{...cat,certs:(cat.certs||[]).filter(c=>c.id!==certId)})); setConfirmDelete(null);
  }

  function openUpload(catId, certId) { uploadTargetRef.current={ catId,certId }; setTimeout(()=>fileInputRef.current?.click(),50); }
  async function handleFileSelect(e) {
    const files=Array.from(e.target.files); if(!files.length||!folderId) return;
    const { catId,certId }=uploadTargetRef.current;
    setUploadingCert(certId);
    try {
      const uploaded=await Promise.all(files.map(f=>uploadFileToDrive(f,folderId)));
      const newFiles=uploaded.map(r=>({ id:uid(),driveId:r.id,name:r.name,size:formatBytes(r.size),date:today(),webViewLink:r.webViewLink }));
      onChange(certCategories.map(cat=>cat.id!==catId?cat:{...cat,certs:(cat.certs||[]).map(c=>c.id!==certId?c:{...c,files:[...(c.files||[]),...newFiles]})}));
    } catch(err) { alert("\uC5C5\uB85C\uB4DC \uC2E4\uD328: "+err.message); }
    finally { setUploadingCert(null); uploadTargetRef.current=null; if(fileInputRef.current) fileInputRef.current.value=""; }
  }
  async function deleteFile(catId, certId, file) {
    setDeletingFile(file.id);
    try {
      if (file.driveId) await deleteFileFromDrive(file.driveId);
      onChange(certCategories.map(cat=>cat.id!==catId?cat:{...cat,certs:(cat.certs||[]).map(c=>c.id!==certId?c:{...c,files:(c.files||[]).filter(f=>f.id!==file.id)})}));
    } catch(err) { console.error(err); } finally { setDeletingFile(null); }
  }

  function expiryStatus(expiry) {
    if (!expiry) return null;
    const d=diffDays(expiry);
    if (d<0) return { text:"\uB9CC\uB8CC\uB428",color:C.danger };
    if (d<90) return { text:`${d}\uC77C \uD6C4 \uB9CC\uB8CC`,color:C.warning };
    return { text:"\uC720\uD6A8",color:C.success };
  }

  return (
    <div>
      <input ref={fileInputRef} type="file" multiple style={{ display:"none" }} onChange={handleFileSelect}/>
      <PageHeader title={"\uC790\uACA9\uC99D \uBCF4\uAD00\uD568"} sub={"\uCE74\uD14C\uACE0\uB9AC\uBCC4\uB85C \uC790\uACA9\uC99D\uC744 \uBD84\uB958\uD558\uACE0 \uAD00\uB828 \uD30C\uC77C\uC744 \uBCF4\uAD00\uD569\uB2C8\uB2E4"}
        action={<Btn icon={Plus} onClick={()=>setShowAddCat(true)}>{"\uCE74\uD14C\uACE0\uB9AC \uCD94\uAC00"}</Btn>}/>

      {certCategories.length===0&&<EmptyState icon={Award} title={"\uCE74\uD14C\uACE0\uB9AC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4"} sub={"\uC5B4\uD559, IT, \uAD6D\uAC00\uC790\uACA9\uC99D \uB4F1\uC73C\uB85C \uBD84\uB958\uD558\uC138\uC694"} action={<Btn icon={Plus} onClick={()=>setShowAddCat(true)}>{"\uCE74\uD14C\uACE0\uB9AC \uCD94\uAC00"}</Btn>}/>}

      <div style={{ display:"flex",flexDirection:"column",gap:20 }}>
        {certCategories.map(cat=>{
          const collapsed=collapsedCats[cat.id];
          const certCount=(cat.certs||[]).length;
          return (
            <div key={cat.id} style={{ ...S.card,overflow:"hidden" }}>
              {/* Category Header */}
              <div style={{ display:"flex",alignItems:"center",gap:10,padding:"14px 20px",borderBottom:`1px solid ${C.border}`,borderLeft:`3px solid ${cat.color}`,background:C.surface }}>
                <button onClick={()=>setCollapsedCats(p=>({...p,[cat.id]:!p[cat.id]}))} style={{ background:"transparent",border:"none",cursor:"pointer",padding:2,color:C.text3,display:"flex" }}>
                  {collapsed?<CR size={13}/>:<ChevronDown size={13}/>}
                </button>
                <div style={{ width:10,height:10,borderRadius:"50%",background:cat.color,flexShrink:0 }}/>
                <span style={{ flex:1,fontSize:14,fontWeight:600,color:C.text1 }}>{cat.name}</span>
                <span style={{ fontSize:11,color:C.text3 }}>{certCount}{"\uAC1C"}</span>
                <Btn size="sm" icon={Plus} variant="ghost" style={{ background:cat.color+"18",color:cat.color,border:"none" }} onClick={()=>{setShowAddCert(cat.id);setCertForm({ name:"",issuer:"",date:"",expiry:"",score:"",note:"",color:CERT_COLORS[0] });}}>{"\uC790\uACA9\uC99D"}</Btn>
                <button onClick={()=>setConfirmDelete({ type:"cat",catId:cat.id })} style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.danger,display:"flex" }}><Trash2 size={12}/></button>
              </div>

              {/* Certs Grid */}
              {!collapsed&&(
                <div style={{ padding:16 }}>
                  {(cat.certs||[]).length===0?(
                    <div style={{ fontSize:12,color:C.text3,padding:"8px 4px" }}>{"\uC790\uACA9\uC99D\uC744 \uCD94\uAC00\uD558\uC138\uC694."}</div>
                  ):(
                    <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12 }}>
                      {(cat.certs||[]).map(cert=>{
                        const status=expiryStatus(cert.expiry);
                        return (
                          <div key={cert.id} style={{ borderRadius:14,overflow:"hidden",background:cert.color,border:`1px solid ${cert.color}88` }}>
                            <div style={{ padding:16 }}>
                              <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:12 }}>
                                <div style={{ borderRadius:10,padding:8,background:"rgba(255,255,255,0.12)" }}><Award size={16} color="rgba(255,255,255,0.9)"/></div>
                                <div style={{ display:"flex",gap:4 }}>
                                  <button onClick={()=>openUpload(cat.id,cert.id)} disabled={uploadingCert===cert.id} style={{ background:"rgba(255,255,255,0.15)",border:"none",cursor:"pointer",padding:5,borderRadius:7,display:"flex",color:"rgba(255,255,255,0.8)" }}>
                                    {uploadingCert===cert.id?<Loader2 size={11} style={{ animation:"spin 1s linear infinite" }}/>:<Upload size={11}/>}
                                  </button>
                                  <button onClick={()=>setConfirmDelete({ type:"cert",catId:cat.id,certId:cert.id })} style={{ background:"rgba(255,255,255,0.15)",border:"none",cursor:"pointer",padding:5,borderRadius:7,display:"flex",color:"rgba(255,255,255,0.8)" }}><Trash2 size={11}/></button>
                                </div>
                              </div>
                              <h3 style={{ fontSize:14,fontWeight:700,color:"rgba(255,255,255,0.95)",marginBottom:2 }}>{cert.name}</h3>
                              {cert.issuer&&<p style={{ fontSize:11,color:"rgba(255,255,255,0.55)" }}>{cert.issuer}</p>}
                              {cert.score&&<div style={{ marginTop:8,display:"inline-block",fontSize:12,fontWeight:700,padding:"3px 10px",borderRadius:99,background:"rgba(255,255,255,0.15)",color:"rgba(255,255,255,0.9)" }}>{cert.score}</div>}
                            </div>
                            <div style={{ padding:"8px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(0,0,0,0.2)",borderTop:"1px solid rgba(255,255,255,0.08)" }}>
                              <span style={{ fontSize:10,color:"rgba(255,255,255,0.5)" }}>{cert.date?formatDate(cert.date):"\uB0A0\uC9DC \uBBF8\uC785\uB825"}</span>
                              {status&&<span style={{ fontSize:10,fontWeight:500,padding:"2px 7px",borderRadius:99,background:status.color+"25",color:status.color }}>{status.text}</span>}
                            </div>
                            {(cert.files||[]).length>0&&(
                              <div style={{ background:"rgba(0,0,0,0.15)",borderTop:"1px solid rgba(255,255,255,0.06)" }}>
                                {(cert.files||[]).map(file=>(
                                  <div key={file.id} style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 14px",borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                                    <FileText size={10} color="rgba(255,255,255,0.4)"/>
                                    <span style={{ flex:1,fontSize:10,color:"rgba(255,255,255,0.55)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{file.name}</span>
                                    {file.webViewLink&&<a href={file.webViewLink} target="_blank" rel="noreferrer" style={{ color:"rgba(255,255,255,0.4)",display:"flex" }}><Eye size={10}/></a>}
                                    <button onClick={()=>deleteFile(cat.id,cert.id,file)} disabled={deletingFile===file.id} style={{ background:"transparent",border:"none",cursor:"pointer",display:"flex",color:"rgba(255,255,255,0.4)",padding:2 }}>
                                      {deletingFile===file.id?<Loader2 size={10} style={{ animation:"spin 1s linear infinite" }}/>:<Trash2 size={10}/>}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                            {cert.note&&<div style={{ padding:"6px 16px",fontSize:10,color:"rgba(255,255,255,0.35)",background:"rgba(0,0,0,0.15)" }}>{cert.note}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Category Modal */}
      {showAddCat&&(
        <Modal title={"\uCE74\uD14C\uACE0\uB9AC \uCD94\uAC00"} onClose={()=>setShowAddCat(false)}>
          <div style={{ ...S.col,gap:16 }}>
            <Input label={"\uCE74\uD14C\uACE0\uB9AC \uC774\uB984"} value={newCat.name} onChange={e=>setNewCat(p=>({...p,name:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addCategory()} placeholder="\uC5B4\uD559, IT, \uAD6D\uAC00\uC790\uACA9\uC99D, \uAE08\uC735 ..."/>
            <Field label={"\uC0C9\uC0C1"}>
              <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
                {SECTION_COLORS.map(c=>(<button key={c} onClick={()=>setNewCat(p=>({...p,color:c}))} style={{ width:28,height:28,borderRadius:"50%",background:c,border:newCat.color===c?"3px solid white":"3px solid transparent",cursor:"pointer",outline:"none",opacity:newCat.color===c?1:0.5 }}/>))}
              </div>
            </Field>
            <div style={{ display:"flex",gap:8,justifyContent:"flex-end" }}>
              <Btn variant="ghost" onClick={()=>setShowAddCat(false)}>{"\uCDE8\uC18C"}</Btn>
              <Btn onClick={addCategory}>{"\uCD94\uAC00"}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Add Cert Modal */}
      {showAddCert&&(
        <Modal title={"\uC790\uACA9\uC99D \uCD94\uAC00"} onClose={()=>setShowAddCert(null)}>
          <div style={{ ...S.col,gap:12 }}>
            <Input label={"\uC790\uACA9\uC99D\uBA85 *"} value={certForm.name} onChange={cf("name")} placeholder="TOEIC, OPIc, \uC815\uBCF4\uCC98\uB9AC\uAE30\uC0AC ..."/>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
              <Input label={"\uBC1C\uAE09 \uAE30\uAD00"} value={certForm.issuer} onChange={cf("issuer")} placeholder="ETS ..."/>
              <Input label={"\uC810\uC218/\uB4F1\uAE09"} value={certForm.score} onChange={cf("score")} placeholder="900, IM2 ..."/>
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
              <Input label={"\uCDE8\uB4DD\uC77C"} type="date" value={certForm.date} onChange={cf("date")}/>
              <Input label={"\uB9CC\uB8CC\uC77C"} type="date" value={certForm.expiry} onChange={cf("expiry")}/>
            </div>
            <Textarea label={"\uBA54\uBAA8"} value={certForm.note} onChange={cf("note")} placeholder="\uAC31\uC2E0 \uC694\uAC74, \uC81C\uCD9C\uCC98 \uB4F1 ..."/>
            <Field label={"\uCE74\uB4DC \uC0C9\uC0C1"}>
              <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
                {CERT_COLORS.map(c=>(<button key={c} onClick={()=>setCertForm(p=>({...p,color:c}))} style={{ width:28,height:28,borderRadius:"50%",background:c,border:certForm.color===c?"3px solid white":"3px solid transparent",cursor:"pointer",outline:"none" }}/>))}
              </div>
            </Field>
            <div style={{ display:"flex",gap:8,justifyContent:"flex-end",marginTop:4 }}>
              <Btn variant="ghost" onClick={()=>setShowAddCert(null)}>{"\uCDE8\uC18C"}</Btn>
              <Btn onClick={()=>addCert(showAddCert)}>{"\uCD94\uAC00"}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirm Delete Modal */}
      {confirmDelete&&(
        <Modal title={"\uC0AD\uC81C \uD655\uC778"} onClose={()=>setConfirmDelete(null)}>
          <p style={{ fontSize:13,color:C.text2,marginBottom:20 }}>
            {confirmDelete.type==="cat"?"\uC774 \uCE74\uD14C\uACE0\uB9AC\uC640 \uD3EC\uD568\uB41C \uBAA8\uB4E0 \uC790\uACA9\uC99D\uC744 \uC0AD\uC81C\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?":"\uC774 \uC790\uACA9\uC99D\uC744 \uC0AD\uC81C\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?"}
          </p>
          <div style={{ display:"flex",gap:8,justifyContent:"flex-end" }}>
            <Btn variant="ghost" onClick={()=>setConfirmDelete(null)}>{"\uCDE8\uC18C"}</Btn>
            <Btn variant="danger" onClick={()=>confirmDelete.type==="cat"?deleteCategory(confirmDelete.catId):deleteCert(confirmDelete.catId,confirmDelete.certId)}>{"\uC0AD\uC81C"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── SCHEDULER ─────────────────────────────────────────────
function Scheduler({ events, onChange }) {
  const [view, setView] = useState("month");
  const [cursor, setCursor] = useState(new Date());
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title:"",date:today(),type:"exam",note:"",isDday:true });
  const fld = k => e => setForm(p=>({...p,[k]:e.target.value}));

  function openAdd(date=today()) { setForm(p=>({...p,date})); setShowAdd(true); }
  function addEvent() {
    if (!form.title.trim()||!form.date) return;
    onChange([...events,{...form,id:uid(),isDday:form.isDday}]);
    setForm({ title:"",date:today(),type:"exam",note:"",isDday:true }); setShowAdd(false);
  }
  function deleteEvent(id) { onChange(events.filter(e=>e.id!==id)); }
  function getMonthGrid(d) {
    const y=d.getFullYear(),m=d.getMonth(),first=new Date(y,m,1),last=new Date(y,m+1,0),cells=[];
    for(let i=0;i<first.getDay();i++) cells.push(null);
    for(let n=1;n<=last.getDate();n++) cells.push(new Date(y,m,n));
    while(cells.length%7!==0) cells.push(null); return cells;
  }
  function eventsOn(d) { if(!d) return []; return events.filter(e=>e.date===d.toISOString().split("T")[0]); }
  function getWeekDates(d) { const b=new Date(d); b.setDate(d.getDate()-d.getDay()); return Array.from({length:7},(_,i)=>{ const x=new Date(b); x.setDate(b.getDate()+i); return x; }); }

  const todayStr=today(),monthGrid=getMonthGrid(cursor),weekDates=getWeekDates(cursor);
  return (
    <div>
      <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:32 }}>
        <div>
          <h2 style={{ fontSize:20,fontWeight:700,color:C.text1,fontFamily:"Georgia,serif" }}>{"\uD559\uC2B5 \uC2A4\uCF00\uC904\uB7EC"}</h2>
          <p style={{ fontSize:13,color:C.text2,marginTop:4 }}>{"\uC2DC\uD5D8 \uC77C\uC815\uACFC D-Day\uB97C \uAD00\uB9AC\uD569\uB2C8\uB2E4"}</p>
        </div>
        <div style={{ display:"flex",gap:8 }}>
          <div style={{ display:"flex",borderRadius:10,overflow:"hidden",border:`1px solid ${C.border2}` }}>
            {["month","week"].map(v=>(
              <button key={v} onClick={()=>setView(v)} style={{ padding:"7px 14px",fontSize:12,fontWeight:500,background:v===view?C.accent:"transparent",color:v===view?"white":C.text2,border:"none",cursor:"pointer",fontFamily:"inherit" }}>
                {v==="month"?"\uC6D4\uAC04":"\uC8FC\uAC04"}
              </button>
            ))}
          </div>
          <Btn icon={Plus} onClick={()=>openAdd()}>{"\uC77C\uC815 \uCD94\uAC00"}</Btn>
        </div>
      </div>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
        <button onClick={()=>view==="month"?setCursor(p=>new Date(p.getFullYear(),p.getMonth()-1,1)):setCursor(p=>{const d=new Date(p);d.setDate(d.getDate()-7);return d;})} style={{ background:"transparent",border:"none",cursor:"pointer",padding:6,color:C.text2,display:"flex",borderRadius:8 }}><ChevronLeft size={15}/></button>
        <span style={{ fontSize:14,fontWeight:600,color:C.text1 }}>
          {view==="month"?cursor.toLocaleDateString("ko-KR",{year:"numeric",month:"long"}):`${weekDates[0].toLocaleDateString("ko-KR",{month:"short",day:"numeric"})} – ${weekDates[6].toLocaleDateString("ko-KR",{month:"short",day:"numeric"})}`}
        </span>
        <button onClick={()=>view==="month"?setCursor(p=>new Date(p.getFullYear(),p.getMonth()+1,1)):setCursor(p=>{const d=new Date(p);d.setDate(d.getDate()+7);return d;})} style={{ background:"transparent",border:"none",cursor:"pointer",padding:6,color:C.text2,display:"flex",borderRadius:8 }}><ChevronRight size={15}/></button>
      </div>
      {view==="month"&&(
        <div style={{ ...S.card,overflow:"hidden",marginBottom:24 }}>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)" }}>
            {WEEKDAYS.map((d,i)=>(<div key={d} style={{ padding:"10px 0",textAlign:"center",fontSize:11,fontWeight:600,color:i===0?C.danger:i===6?C.accent:C.text3,background:C.surface,borderBottom:`1px solid ${C.border}` }}>{d}</div>))}
            {monthGrid.map((day,i)=>{
              const evs=eventsOn(day),ds=day?.toISOString().split("T")[0],isToday=ds===todayStr,isWeekend=day&&(day.getDay()===0||day.getDay()===6);
              return (
                <div key={i} onClick={()=>day&&openAdd(ds)} style={{ minHeight:80,padding:6,cursor:day?"pointer":"default",background:day?"transparent":C.surface2,borderRight:(i+1)%7!==0?`1px solid ${C.border}`:"none",borderBottom:i<monthGrid.length-7?`1px solid ${C.border}`:"none" }}>
                  {day&&(<>
                    <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:2 }}>
                      <span style={{ fontSize:11,width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:"50%",fontWeight:500,background:isToday?C.accent:"transparent",color:isToday?"white":isWeekend?(day.getDay()===0?C.danger:C.accent):C.text2 }}>{day.getDate()}</span>
                    </div>
                    <div style={{ display:"flex",flexDirection:"column",gap:2 }}>
                      {evs.slice(0,2).map(e=>(<div key={e.id} onClick={ev=>{ev.stopPropagation();deleteEvent(e.id);}} style={{ fontSize:10,borderRadius:4,padding:"1px 4px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",background:EVENT_TYPES[e.type]?.color+"22",color:EVENT_TYPES[e.type]?.color,cursor:"pointer" }}>{e.isDday&&"\u2605 "}{e.title}</div>))}
                      {evs.length>2&&<div style={{ fontSize:10,color:C.text3,paddingLeft:4 }}>+{evs.length-2}</div>}
                    </div>
                  </>)}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {view==="week"&&(
        <div style={{ ...S.card,overflow:"hidden",marginBottom:24 }}>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)" }}>
            {weekDates.map((day,i)=>{
              const ds=day.toISOString().split("T")[0],isToday=ds===todayStr,evs=eventsOn(day);
              return (
                <div key={i} style={{ borderRight:i<6?`1px solid ${C.border}`:"none" }}>
                  <div onClick={()=>openAdd(ds)} style={{ padding:"10px 0",textAlign:"center",cursor:"pointer",background:C.surface,borderBottom:`1px solid ${C.border}` }}>
                    <div style={{ fontSize:11,color:i===0?C.danger:i===6?C.accent:C.text3,marginBottom:4 }}>{WEEKDAYS[i]}</div>
                    <div style={{ fontSize:16,fontWeight:700,width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:"50%",margin:"0 auto",background:isToday?C.accent:"transparent",color:isToday?"white":C.text1 }}>{day.getDate()}</div>
                  </div>
                  <div style={{ padding:4,minHeight:120,display:"flex",flexDirection:"column",gap:4 }}>
                    {evs.map(e=>(<div key={e.id} onClick={()=>deleteEvent(e.id)} style={{ fontSize:11,borderRadius:6,padding:"4px 6px",background:EVENT_TYPES[e.type]?.color+"22",color:EVENT_TYPES[e.type]?.color,cursor:"pointer",fontWeight:500 }}>{e.isDday&&"\u2605 "}{e.title}</div>))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <h3 style={{ fontSize:13,fontWeight:600,color:C.text1,marginBottom:12 }}>{"\uC804\uCCB4 \uC77C\uC815"} <span style={{ color:C.text3 }}>({events.length})</span></h3>
        {events.length===0?<p style={{ fontSize:13,color:C.text2 }}>{"\uC77C\uC815\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</p>:(
          <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
            {[...events].sort((a,b)=>new Date(a.date)-new Date(b.date)).map(e=>{
              const diff=diffDays(e.date);
              return (
                <div key={e.id} style={{ display:"flex",alignItems:"center",gap:10,padding:"12px 16px",...S.card }}>
                  <div style={{ width:8,height:8,borderRadius:"50%",background:EVENT_TYPES[e.type]?.color,flexShrink:0 }}/>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:13,fontWeight:500,color:C.text1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{e.isDday&&<span style={{ color:C.accent,marginRight:4 }}>★</span>}{e.title}</div>
                    {e.note&&<div style={{ fontSize:11,color:C.text3,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{e.note}</div>}
                  </div>
                  <span style={{ fontSize:11,color:C.text3,flexShrink:0 }}>{formatDate(e.date)}</span>
                  {e.isDday&&<span style={{ fontSize:11,fontWeight:700,flexShrink:0,padding:"2px 8px",borderRadius:99,background:diff<0?"rgba(148,163,184,0.1)":diff===0?C.danger+"20":C.accent+"18",color:diff<0?C.text3:diff===0?C.danger:C.accent }}>{dDayLabel(diff)}</span>}
                  <button onClick={()=>deleteEvent(e.id)} style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.danger,display:"flex",flexShrink:0 }}><Trash2 size={12}/></button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {showAdd&&(
        <Modal title={"\uC77C\uC815 \uCD94\uAC00"} onClose={()=>setShowAdd(false)}>
          <div style={{ ...S.col,gap:12 }}>
            <Input label={"\uC81C\uBAA9 *"} value={form.title} onChange={fld("title")} onKeyDown={e=>e.key==="Enter"&&addEvent()} placeholder="TOEIC \uC2DC\uD5D8 ..."/>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
              <Input label={"\uB0A0\uC9DC *"} type="date" value={form.date} onChange={fld("date")}/>
              <SelectInput label={"\uC720\uD615"} value={form.type} onChange={fld("type")}>
                {Object.entries(EVENT_TYPES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
              </SelectInput>
            </div>
            <Textarea label={"\uBA54\uBAA8"} value={form.note} onChange={fld("note")} placeholder="\uC7A5\uC18C, \uC900\uBE44\uBB3C \uB4F1 ..."/>
            <label style={{ display:"flex",alignItems:"center",gap:10,cursor:"pointer" }}>
              <div style={{ position:"relative",width:40,height:22,flexShrink:0 }} onClick={()=>setForm(p=>({...p,isDday:!p.isDday}))}>
                <div style={{ position:"absolute",inset:0,borderRadius:99,background:form.isDday?C.accent:C.surface3,transition:"background 0.2s" }}/>
                <div style={{ position:"absolute",top:2,left:form.isDday?20:2,width:18,height:18,borderRadius:"50%",background:"white",transition:"left 0.2s" }}/>
              </div>
              <span style={{ fontSize:13,color:C.text2 }}>D-Day \uCE74\uC6B4\uD2B8\uB2E4\uC6B4 \uD45C\uC2DC</span>
            </label>
            <div style={{ display:"flex",gap:8,justifyContent:"flex-end",marginTop:4 }}>
              <Btn variant="ghost" onClick={()=>setShowAdd(false)}>{"\uCDE8\uC18C"}</Btn>
              <Btn onClick={addEvent}>{"\uCD94\uAC00"}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── SIDEBAR ───────────────────────────────────────────────
function Sidebar({ page, setPage, certCategories, events, syncStatus, onSignOut, userInfo }) {
  const totalCerts=certCategories.reduce((a,c)=>a+(c.certs||[]).length,0);
  const upcoming=events.filter(e=>e.isDday&&diffDays(e.date)>=0).length;
  const navItems=[
    { id:"dashboard", label:"\uB300\uC2DC\uBCF4\uB4DC",           icon:LayoutDashboard },
    { id:"library",   label:"\uAC15\uC758 \uC790\uB8CC\uC2E4",    icon:BookOpen },
    { id:"certs",     label:"\uC790\uACA9\uC99D \uBCF4\uAD00\uD568", icon:Award, badge:totalCerts },
    { id:"scheduler", label:"\uD559\uC2B5 \uC2A4\uCF00\uC904\uB7EC", icon:Calendar, badge:upcoming||null },
  ];
  return (
    <nav style={{ width:220,minWidth:220,display:"flex",flexDirection:"column",height:"100%" }}>
      <div style={{ padding:"20px 20px 12px" }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <div style={{ borderRadius:12,padding:8,background:`${C.accent}18`,border:`1px solid ${C.accent}30` }}><GraduationCap size={16} color={C.accent}/></div>
          <div>
            <div style={{ fontSize:14,fontWeight:700,color:C.text1,fontFamily:"Georgia,serif" }}>CareerKit</div>
            <div style={{ display:"flex",alignItems:"center",gap:5,marginTop:2 }}>
              <SyncDot status={syncStatus}/>
              <span style={{ fontSize:10,color:C.text3 }}>{syncStatus==="synced"?"Drive \uB3D9\uAE30\uD654":syncStatus==="syncing"?"\uC800\uC7A5 \uC911...":"\uC624\uB958"}</span>
            </div>
          </div>
        </div>
      </div>
      <div style={{ flex:1,padding:"4px 12px",overflowY:"auto" }}>
        {navItems.map(item=>{
          const active=page===item.id;
          return (
            <button key={item.id} onClick={()=>setPage(item.id)} style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:12,width:"100%",textAlign:"left",cursor:"pointer",fontFamily:"inherit",marginBottom:2,background:active?`${C.accent}18`:"transparent",color:active?C.accent:C.text2,border:active?`1px solid ${C.accent}30`:"1px solid transparent",transition:"all 0.15s" }}>
              <item.icon size={15} style={{ flexShrink:0 }}/>
              <span style={{ flex:1,fontSize:13,fontWeight:500 }}>{item.label}</span>
              {item.badge>0&&<span style={{ fontSize:10,fontWeight:700,padding:"1px 6px",borderRadius:99,background:active?C.accent:C.surface3,color:active?"white":C.text2 }}>{item.badge}</span>}
            </button>
          );
        })}
      </div>
      <div style={{ padding:"12px 16px",borderTop:`1px solid ${C.border}` }}>
        <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:10 }}>
          {userInfo?.picture?<img src={userInfo.picture} alt="" style={{ width:32,height:32,borderRadius:"50%",border:`2px solid ${C.border2}`,flexShrink:0 }}/>:<div style={{ width:32,height:32,borderRadius:"50%",background:C.surface3,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}><GraduationCap size={14} color={C.text2}/></div>}
          <div style={{ flex:1,minWidth:0 }}>
            <div style={{ fontSize:12,fontWeight:600,color:C.text1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{userInfo?.name||"User"}</div>
            <div style={{ fontSize:10,color:C.text3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{userInfo?.email||""}</div>
          </div>
        </div>
        <button onClick={onSignOut} style={{ display:"flex",alignItems:"center",gap:6,width:"100%",padding:"7px 12px",borderRadius:10,background:"transparent",border:`1px solid ${C.border}`,color:C.text3,fontSize:12,cursor:"pointer",fontFamily:"inherit" }}>
          <LogOut size={12}/>{"\uB85C\uADF8\uC544\uC6C3"}
        </button>
      </div>
    </nav>
  );
}

// ─── ROOT APP ──────────────────────────────────────────────
export default function App() {
  const [authState, setAuthState] = useState("loading");
  const [page, setPage] = useState("dashboard");
  const [data, setData] = useState(EMPTY_DATA);
  const [syncStatus, setSyncStatus] = useState("synced");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userInfo, setUserInfo] = useState(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const dataFileIdRef=useRef(null),folderIdRef=useRef(null),tokenClientRef=useRef(null),saveTimerRef=useRef(null);

  useEffect(()=>{
    (async()=>{
      await Promise.all([initGapi(),initGis()]);
      tokenClientRef.current=window.google.accounts.oauth2.initTokenClient({ client_id:CLIENT_ID,scope:SCOPES,callback:handleTokenResponse });
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
    const u=await uRes.json(); setUserInfo({ name:u.name,email:u.email,picture:u.picture });
    const existing=await findFile(DATA_FILE_NAME);
    if (existing) {
      dataFileIdRef.current=existing.id;
      const loaded=await readJsonFile(existing.id);
      // migrate old data: if certs array exists (old format), convert to certCategories
      if (loaded.certs&&!loaded.certCategories) {
        setData({ library:loaded.library||[], certCategories:[{ id:uid(),name:"\uAE30\uD0C8",color:SECTION_COLORS[0],certs:loaded.certs.map(c=>({...c,files:c.files||[]})) }], events:loaded.events||[] });
      } else {
        setData({ library:loaded.library||[], certCategories:loaded.certCategories||[], events:loaded.events||[] });
      }
    } else {
      dataFileIdRef.current=await createJsonFile(DATA_FILE_NAME,EMPTY_DATA);
    }
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
  const updateCerts=useCallback(certCategories=>{ const d={...data,certCategories}; setData(d); scheduleSave(d); },[data]);
  const updateEvents=useCallback(events=>{ const d={...data,events}; setData(d); scheduleSave(d); },[data]);

  const globalStyle=`
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
    @keyframes pulse { 0%,100%{opacity:1;}50%{opacity:0.4;} }
    a { text-decoration: none; }
  `;

  if (authState==="loading") return (<><style>{globalStyle}</style><div style={{ height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:C.bg }}><Loader2 size={32} color={C.accent} style={{ animation:"spin 1s linear infinite" }}/></div></>);
  if (authState==="login") return (<><style>{globalStyle}</style><LoginScreen onSignIn={handleSignIn} loading={loginLoading}/></>);

  const pages={
    dashboard:<Dashboard library={data.library} certCategories={data.certCategories} events={data.events} setPage={setPage} userInfo={userInfo}/>,
    library:  <Library   library={data.library} onChange={updateLibrary} folderId={folderIdRef.current}/>,
    certs:    <Certificates certCategories={data.certCategories} onChange={updateCerts} folderId={folderIdRef.current}/>,
    scheduler:<Scheduler events={data.events} onChange={updateEvents}/>,
  };

  return (
    <>
      <style>{globalStyle}</style>
      <style>{`@media(min-width:768px){.sidebar-desktop{display:flex!important;flex-direction:column;}.mobile-topbar{display:none!important;}}`}</style>
      <div style={{ display:"flex",height:"100vh",overflow:"hidden",background:C.bg }}>
        <div className="sidebar-desktop" style={{ display:"none",flexShrink:0,background:C.surface,borderRight:`1px solid ${C.border}` }}>
          <Sidebar page={page} setPage={setPage} certCategories={data.certCategories} events={data.events} syncStatus={syncStatus} onSignOut={handleSignOut} userInfo={userInfo}/>
        </div>
        {sidebarOpen&&(
          <div onClick={()=>setSidebarOpen(false)} style={{ position:"fixed",inset:0,zIndex:40,background:"rgba(0,0,0,0.6)",backdropFilter:"blur(4px)" }}>
            <div onClick={e=>e.stopPropagation()} style={{ position:"absolute",left:0,top:0,bottom:0,width:240,background:C.surface,borderRight:`1px solid ${C.border2}`,display:"flex",flexDirection:"column" }}>
              <Sidebar page={page} setPage={p=>{setPage(p);setSidebarOpen(false);}} certCategories={data.certCategories} events={data.events} syncStatus={syncStatus} onSignOut={handleSignOut} userInfo={userInfo}/>
            </div>
          </div>
        )}
        <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden" }}>
          <div className="mobile-topbar" style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",background:C.surface,borderBottom:`1px solid ${C.border}` }}>
            <button onClick={()=>setSidebarOpen(true)} style={{ background:"transparent",border:"none",cursor:"pointer",padding:6,color:C.text2,display:"flex",borderRadius:8 }}><Menu size={16}/></button>
            <span style={{ fontSize:14,fontWeight:700,color:C.text1,fontFamily:"Georgia,serif" }}>CareerKit</span>
            <SyncDot status={syncStatus}/>
          </div>
          <div style={{ flex:1,overflowY:"auto" }}>
            <div style={{ maxWidth:900,margin:"0 auto",padding:"32px 24px" }}>
              <CountdownBanner events={data.events}/>
              {pages[page]}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
