import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  BookOpen, Award, Calendar, LayoutDashboard, Plus, Trash2,
  Upload, ChevronLeft, ChevronRight, X, Edit2, Check,
  Clock, FileText, Image, File, FolderOpen, Folder, AlertCircle,
  GraduationCap, Zap, LogOut, Cloud, RefreshCw,
  Eye, Loader2, Menu, ChevronDown, ChevronRight as CR,
  Download, Pencil, ExternalLink, CalendarPlus, CalendarCheck,
  MoveRight, Search, Bell, TrendingUp, Star, ScrollText
} from "lucide-react";

// ─── GOOGLE API ────────────────────────────────────────────
const CLIENT_ID = "406294571592-ufr5l29p3vvv4nfobec3ktosb8euj7gj.apps.googleusercontent.com";
const SCOPES = [
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar",
].join(" ");
const DATA_FILE   = "career_data.json";
const FOLDER_NAME = "CareerKit Files";
const TOKEN_KEY   = "career_gapi_token";
const TOKEN_EXP   = "career_gapi_expiry";

function loadScript(src, check) {
  return new Promise(r => {
    if (check()) { r(); return; }
    const s = document.createElement("script"); s.src = src; s.onload = r;
    document.head.appendChild(s);
  });
}
async function initGapi() {
  await loadScript("https://apis.google.com/js/api.js", () => !!window.gapi);
  await new Promise(r => window.gapi.load("client", r));
  await window.gapi.client.init({
    discoveryDocs: [
      "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest",
      "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest",
    ],
  });
}
async function initGis() {
  await loadScript("https://accounts.google.com/gsi/client", () => !!window.google?.accounts);
}
function saveToken(t) {
  localStorage.setItem(TOKEN_KEY, t.access_token);
  localStorage.setItem(TOKEN_EXP, String(Date.now() + (t.expires_in - 60) * 1000));
  window.gapi.client.setToken(t);
}
function loadCachedToken() {
  const t = localStorage.getItem(TOKEN_KEY), e = Number(localStorage.getItem(TOKEN_EXP));
  if (t && e && Date.now() < e) { window.gapi.client.setToken({ access_token: t }); return true; }
  return false;
}
function clearToken() {
  localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_EXP);
  window.gapi.client.setToken(null);
}
function getAccessToken() { return window.gapi.client.getToken()?.access_token; }

// ─── DRIVE HELPERS ─────────────────────────────────────────
async function findFile(name, spaces = "appDataFolder") {
  const r = await window.gapi.client.drive.files.list({ spaces, q: `name='${name}' and trashed=false`, fields: "files(id,name)" });
  return r.result.files?.[0] || null;
}
async function readJsonFile(id) {
  const r = await window.gapi.client.drive.files.get({ fileId: id, alt: "media" });
  return typeof r.result === "string" ? JSON.parse(r.result) : r.result;
}
async function createJsonFile(name, data, parents = ["appDataFolder"]) {
  const b = "ck_b";
  const body = [`--${b}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify({ name, parents }), `--${b}`, "Content-Type: application/json", "", JSON.stringify(data), `--${b}--`].join("\r\n");
  const r = await window.gapi.client.request({ path: "https://www.googleapis.com/upload/drive/v3/files", method: "POST", params: { uploadType: "multipart", fields: "id" }, headers: { "Content-Type": `multipart/related; boundary=${b}` }, body });
  return r.result.id;
}
async function updateJsonFile(id, data) {
  await window.gapi.client.request({ path: `https://www.googleapis.com/upload/drive/v3/files/${id}`, method: "PATCH", params: { uploadType: "media" }, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
}
async function getOrCreateDriveFolder() {
  const e = await findFile(FOLDER_NAME, "drive");
  if (e) return e.id;
  const r = await window.gapi.client.drive.files.create({ resource: { name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }, fields: "id" });
  return r.result.id;
}
async function uploadFileToDrive(file, folderId) {
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify({ name: file.name, parents: [folderId] })], { type: "application/json" }));
  form.append("file", file);
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,mimeType,webViewLink", { method: "POST", headers: { Authorization: `Bearer ${getAccessToken()}` }, body: form });
  if (!r.ok) throw new Error("Upload failed");
  return r.json();
}
async function deleteDriveFile(id) { await window.gapi.client.drive.files.delete({ fileId: id }); }
async function renameDriveFile(id, name) { await window.gapi.client.drive.files.update({ fileId: id, resource: { name } }); }
async function fetchFileBlob(id) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${getAccessToken()}` } });
  if (!r.ok) throw new Error("Fetch failed");
  return r.blob();
}

// ─── GOOGLE CALENDAR HELPERS ───────────────────────────────
const CAL_SUMMARY = "CareerKit";
async function getOrCreateCareerCalendar() {
  const stored = localStorage.getItem("career_cal_id");
  if (stored) {
    try { await window.gapi.client.calendar.calendars.get({ calendarId: stored }); return stored; }
    catch { localStorage.removeItem("career_cal_id"); }
  }
  const list = await window.gapi.client.calendar.calendarList.list();
  const found = list.result.items?.find(c => c.summary === CAL_SUMMARY);
  if (found) { localStorage.setItem("career_cal_id", found.id); return found.id; }
  const created = await window.gapi.client.calendar.calendars.insert({ resource: { summary: CAL_SUMMARY, timeZone: "Asia/Seoul" } });
  localStorage.setItem("career_cal_id", created.result.id);
  return created.result.id;
}
const typeToLabel = { exam:"시험", study:"학습", cert:"자격증", other:"기타" };
const labelToType = { "시험":"exam", "학습":"study", "자격증":"cert", "기타":"other" };
const typeColorId  = { exam:"11", study:"9", cert:"10", other:"8" };
function buildGCalDescription(event) {
  const label = typeToLabel[event.type] || "기타";
  return event.note ? `${label}\n${event.note}` : label;
}
function parseGCalDescription(desc) {
  if (!desc) return { type:"other", note:"" };
  const lines = desc.split("\n");
  const type = labelToType[lines[0].trim()] || "other";
  const note = lines.slice(1).join("\n").trim();
  return { type, note };
}
function buildCalendarTimes(event) {
  const date = event.date;
  const [y, m, d] = date.split("-").map(Number);
  if (event.hasTime && event.startTime && event.endTime) {
    const tz = "Asia/Seoul";
    return { start: { dateTime: `${date}T${event.startTime}:00`, timeZone: tz }, end: { dateTime: `${date}T${event.endTime}:00`, timeZone: tz } };
  }
  const endDate = new Date(y, m - 1, d + 1).toLocaleDateString("sv-SE");
  return { start: { date }, end: { date: endDate } };
}
async function addToGoogleCalendar(event, calId) {
  const times = buildCalendarTimes(event);
  const res = await window.gapi.client.calendar.events.insert({
    calendarId: calId,
    resource: { summary: event.title, description: buildGCalDescription(event), ...times, colorId: typeColorId[event.type] || "8" },
  });
  return res.result.id;
}
async function removeFromGoogleCalendar(googleEventId, calId) {
  try { await window.gapi.client.calendar.events.delete({ calendarId: calId, eventId: googleEventId }); }
  catch(e) { console.warn("Calendar delete failed:", e); }
}
async function updateGoogleCalendarEvent(googleEventId, calId, event) {
  const times = buildCalendarTimes(event);
  await window.gapi.client.calendar.events.patch({
    calendarId: calId, eventId: googleEventId,
    resource: { summary: event.title, description: buildGCalDescription(event), ...times, colorId: typeColorId[event.type] || "8" },
  });
}
async function fetchGoogleCalendarEvents(calId, existingEvents) {
  const now = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString();
  const timeMax = new Date(now.getFullYear(), now.getMonth() + 12, 31).toISOString();
  const res = await window.gapi.client.calendar.events.list({ calendarId: calId, timeMin, timeMax, singleEvents: true, orderBy: "startTime", maxResults: 500 });
  const googleEvents = res.result.items || [];
  const geById = new Map(googleEvents.map(ge => [ge.id, ge]));
  const knownGoogleIds = new Set(existingEvents.map(e => e.googleEventId).filter(Boolean));
  const tMin = new Date(timeMin), tMax = new Date(timeMax);
  const newEvents = [], updatedEvents = [], deletedLocalIds = [];

  for (const localEv of existingEvents) {
    if (!localEv.googleEventId || !localEv.syncedToCalendar) continue;
    const evDate = new Date(localEv.date + "T12:00:00");
    if (evDate < tMin || evDate > tMax) continue;
    const ge = geById.get(localEv.googleEventId);
    if (!ge) {
      deletedLocalIds.push(localEv.id);
    } else {
      const geDate = ge.start?.date || ge.start?.dateTime?.split("T")[0];
      const geTitle = ge.summary || "(제목 없음)";
      const { type: geType, note: geNote } = parseGCalDescription(ge.description);
      const geHasTime = !!ge.start?.dateTime;
      const geStartTime = geHasTime ? ge.start.dateTime.split("T")[1]?.slice(0,5) : null;
      const geEndTime = geHasTime ? ge.end?.dateTime?.split("T")[1]?.slice(0,5) : null;
      if (geDate !== localEv.date || geTitle !== localEv.title || geNote !== (localEv.note||"") || geType !== localEv.type || geHasTime !== (localEv.hasTime||false) || geStartTime !== (localEv.startTime||null) || geEndTime !== (localEv.endTime||null)) {
        updatedEvents.push({ id: localEv.id, title: geTitle, date: geDate, type: geType, note: geNote, hasTime: geHasTime, startTime: geStartTime, endTime: geEndTime });
      }
    }
  }

  for (const ge of googleEvents) {
    if (knownGoogleIds.has(ge.id)) continue;
    const rawDate = ge.start?.date || ge.start?.dateTime?.split("T")[0];
    if (!rawDate) continue;
    const newHasTime = !!ge.start?.dateTime;
    const newStartTime = newHasTime ? ge.start.dateTime.split("T")[1]?.slice(0,5) : null;
    const newEndTime = newHasTime ? ge.end?.dateTime?.split("T")[1]?.slice(0,5) : null;
    const { type: newType, note: newNote } = parseGCalDescription(ge.description);
    newEvents.push({ id: uid(), title: ge.summary || "(제목 없음)", date: rawDate, type: newType, note: newNote, isDday: true, syncCal: true, googleEventId: ge.id, syncedToCalendar: true, importedFromCalendar: true, hasTime: newHasTime, startTime: newStartTime, endTime: newEndTime });
  }

  return { newEvents, updatedEvents, deletedLocalIds };
}

// ─── UTILS ─────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }
function today() { return new Date().toLocaleDateString("sv-SE"); }
function diffDays(d) { const t = new Date(d); t.setHours(0,0,0,0); const n = new Date(); n.setHours(0,0,0,0); return Math.round((t-n)/86400000); }
function formatDate(d) { if (!d) return "-"; const [y,m,day] = d.split("-"); return new Date(+y, +m-1, +day).toLocaleDateString("ko-KR", { year:"numeric", month:"short", day:"numeric" }); }
function formatBytes(b) { if (!b) return ""; if (b<1024) return b+"B"; if (b<1048576) return (b/1024).toFixed(1)+"KB"; return (b/1048576).toFixed(1)+"MB"; }
function dDayLabel(d) { if (d===0) return "D-Day"; return d>0?`D-${d}`:`D+${Math.abs(d)}`; }
function getExt(name="") { return name.split(".").pop()?.toLowerCase()||""; }
function isImage(name) { return ["jpg","jpeg","png","gif","webp","svg","bmp"].includes(getExt(name)); }
function isPdf(name) { return getExt(name)==="pdf"; }
function isText(name) { return ["txt","md","json","csv","js","ts","jsx","tsx","css","xml","yaml","yml"].includes(getExt(name)); }
function isHtml(name) { return getExt(name) === "html"; }

const RECENT_KEY = "career_recent_files";
function addRecentFile(file, sectionName, sectionColor) {
  const prev = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  const filtered = prev.filter(f => f.id !== file.id);
  const entry = { id:file.id, name:file.name, driveId:file.driveId, webViewLink:file.webViewLink, sectionName, sectionColor, ts:Date.now() };
  localStorage.setItem(RECENT_KEY, JSON.stringify([entry, ...filtered].slice(0, 8)));
}
function getRecentFiles() { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); }
function formatTimeAgo(ts) {
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d === 0) return "오늘"; if (d === 1) return "어제";
  if (d < 7) return `${d}일 전`; if (d < 30) return `${Math.floor(d/7)}주 전`;
  return `${Math.floor(d/30)}개월 전`;
}

const C = {
  bg:"#080c14", surface:"#0f1521", surface2:"#161e2e", surface3:"#1c2640",
  border:"rgba(255,255,255,0.06)", border2:"rgba(255,255,255,0.10)",
  accent:"#818cf8", text1:"#f1f5f9", text2:"#8892a4", text3:"#4a5568",
  danger:"#f87171", success:"#34d399", warning:"#fbbf24",
};
const SEC_COLORS  = ["#818cf8","#38bdf8","#34d399","#fbbf24","#f87171","#c084fc","#f472b6","#2dd4bf"];
const CERT_COLORS = ["#1e293b","#1e3a5f","#14532d","#7c2d12","#312e81","#4a1942","#064e3b","#334155"];
const EVENT_TYPES = {
  exam:  { label:"시험",       color:"#f87171" },
  study: { label:"학습",       color:"#818cf8" },
  cert:  { label:"자격증", color:"#34d399" },
  other: { label:"기타",       color:"#8892a4" },
};
const WEEKDAYS  = ["일","월","화","수","목","금","토"];
const EMPTY_DATA = { library:[], certCategories:[], events:[], coverLetterFolders:[] };
function formatEventTime(e) {
  if (!e.hasTime || !e.startTime) return "";
  return `${e.startTime}${e.endTime?`~${e.endTime}`:""}`;
}

const S = {
  card:  { background:C.surface, border:`1px solid ${C.border2}`, borderRadius:16 },
  input: { background:C.surface, border:`1px solid ${C.border2}`, borderRadius:10, color:C.text1, padding:"8px 12px", fontSize:13, width:"100%", outline:"none", boxSizing:"border-box" },
  label: { fontSize:11, fontWeight:500, color:C.text2, marginBottom:4, display:"block" },
  col:   { display:"flex", flexDirection:"column", gap:6 },
};

// ─── TOAST SYSTEM ──────────────────────────────────────────
const _toastBus = [];
function addToast(type, msg, duration = 3500) {
  const t = { id: uid(), type, msg, duration };
  _toastBus.forEach(fn => fn(t));
}
function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    function handler(t) {
      setToasts(prev => [...prev, t]);
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), t.duration);
    }
    _toastBus.push(handler);
    return () => { const i = _toastBus.indexOf(handler); if (i >= 0) _toastBus.splice(i, 1); };
  }, []);
  if (!toasts.length) return null;
  const clr = { success:C.success, error:C.danger, info:C.accent, warning:C.warning };
  return (
    <div style={{ position:"fixed",bottom:24,right:24,zIndex:300,display:"flex",flexDirection:"column-reverse",gap:8,pointerEvents:"none" }}>
      {toasts.map(t => (
        <div key={t.id} style={{ display:"flex",alignItems:"center",gap:10,padding:"12px 16px",borderRadius:12,maxWidth:340,minWidth:220,
          background:C.surface2,border:`1px solid ${clr[t.type]}40`,
          boxShadow:"0 8px 32px rgba(0,0,0,0.5)",pointerEvents:"all",
          animation:"toastIn 0.25s cubic-bezier(.21,1.02,.73,1) both" }}>
          <div style={{ width:8,height:8,borderRadius:"50%",background:clr[t.type],flexShrink:0 }}/>
          <span style={{ fontSize:13,color:C.text1,lineHeight:1.4,flex:1 }}>{t.msg}</span>
          <button onClick={()=>setToasts(p=>p.filter(x=>x.id!==t.id))} style={{ background:"transparent",border:"none",cursor:"pointer",padding:2,color:C.text3,display:"flex",flexShrink:0 }}><X size={12}/></button>
        </div>
      ))}
    </div>
  );
}

// ─── DRAG & DROP HELPERS ───────────────────────────────────
function reorder(arr, fromIdx, toIdx) {
  const a = [...arr];
  const [item] = a.splice(fromIdx, 1);
  a.splice(toIdx, 0, item);
  return a;
}
function useDragList(items, onReorder) {
  const dragIdx = useRef(null);
  const [overIdx, setOverIdx] = useState(null);
  function onDragStart(i) { dragIdx.current = i; }
  function onDragOver(e, i) { e.preventDefault(); setOverIdx(i); }
  function onDrop(e, i) {
    e.preventDefault();
    if (dragIdx.current !== null && dragIdx.current !== i) onReorder(reorder(items, dragIdx.current, i));
    dragIdx.current = null; setOverIdx(null);
  }
  function onDragEnd() { dragIdx.current = null; setOverIdx(null); }
  return { overIdx, onDragStart, onDragOver, onDrop, onDragEnd };
}

// ─── FILE VIEWER ───────────────────────────────────────────
// Per-slide notes — manages its own localStorage state
function PdfSlideNotes({ notesKey }) {
  const [val, setVal] = useState(() => localStorage.getItem(notesKey) || "");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  function handle(e) {
    const v = e.target.value; setVal(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => localStorage.setItem(notesKey, v), 600);
  }
  return (
    <textarea value={val} onChange={handle}
      placeholder={"이 슬라이드 메모..."}
      style={{ flex:1,resize:"none",background:"transparent",border:"none",color:C.text1,padding:"10px 14px",fontSize:13,lineHeight:1.7,outline:"none",fontFamily:"inherit",minHeight:0 }}
    />
  );
}

function FileViewer({ file, onClose, onRename }) {
  const [state, setState] = useState("loading");
  const [blobUrl, setBlobUrl] = useState(null);
  const [textContent, setTextContent] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(file.name);
  const [renaming, setRenaming] = useState(false);
  const [pdfPageImgs, setPdfPageImgs] = useState([]); // blob-URL per page, populated progressively
  const [notesVisible, setNotesVisible] = useState(true);
  const pdfDocRef = useRef(null);
  const blobUrlRef = useRef(null);
  const pageImgUrlsRef = useRef([]);
  const notesBase = `pdf_notes_${file.driveId || file.id || file.name}`;
  const FIcon = isImage(file.name) ? Image : isPdf(file.name) ? FileText : File;
  const narrow = window.innerWidth < 700;

  useEffect(() => {
    if (!file.driveId) { setState("no-drive"); return; }
    (async () => {
      setState("loading");
      try {
        const blob = await fetchFileBlob(file.driveId);
        if (isText(file.name)) { setTextContent(await blob.text()); setState("text"); return; }
        if (isHtml(file.name)) { setTextContent(await blob.text()); setState("html"); return; }
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url; setBlobUrl(url);
        if (isImage(file.name)) { setState("image"); return; }
        if (isPdf(file.name)) {
          try {
            await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", () => !!window.pdfjsLib);
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
            const buf = await blob.arrayBuffer();
            const doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
            pdfDocRef.current = doc; setState("pdf");
          } catch { setState("pdf-fallback"); }
          return;
        }
        setState("other");
      } catch { setState("error"); }
    })();
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      pageImgUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
      if (pdfDocRef.current) { pdfDocRef.current.destroy(); pdfDocRef.current = null; }
    };
  }, [file.driveId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render PDF pages to blob-URL images progressively
  useEffect(() => {
    if (state !== "pdf" || !pdfDocRef.current) return;
    const doc = pdfDocRef.current;
    let cancelled = false;
    (async () => {
      const imgs = [];
      // Render target width: 70% of viewport (notes takes 30%) on desktop, full width on mobile
      const targetW = (narrow ? window.innerWidth : window.innerWidth * 0.68) * (window.devicePixelRatio || 1);
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) break;
        const page = await doc.getPage(i);
        const vp0 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(targetW / vp0.width, 4) });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
        const imgUrl = await new Promise(res => canvas.toBlob(b => res(URL.createObjectURL(b)), "image/jpeg", 0.92));
        pageImgUrlsRef.current.push(imgUrl);
        imgs.push(imgUrl);
        if (!cancelled) setPdfPageImgs([...imgs]);
      }
    })();
    return () => { cancelled = true; };
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveRename() {
    if (!nameVal.trim() || nameVal === file.name) { setEditingName(false); return; }
    setRenaming(true);
    try { if (onRename) await onRename(file, nameVal.trim()); }
    catch(e) { console.error(e); }
    finally { setRenaming(false); setEditingName(false); }
  }

  return (
    <div style={{ position:"fixed",inset:0,zIndex:60,background:"rgba(0,0,0,0.92)",backdropFilter:"blur(12px)",display:"flex",flexDirection:"column" }}>
      {/* ── Header ── */}
      <div style={{ display:"flex",alignItems:"center",gap:8,padding:"10px 16px",background:C.surface,borderBottom:`1px solid ${C.border2}`,flexShrink:0,flexWrap:"wrap" }}>
        <div style={{ borderRadius:8,padding:6,background:C.accent+"18",flexShrink:0 }}><FIcon size={14} color={C.accent}/></div>
        {editingName ? (
          <input autoFocus value={nameVal} onChange={e=>setNameVal(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter") saveRename(); if(e.key==="Escape"){setEditingName(false);setNameVal(file.name);} }}
            style={{ flex:1,minWidth:80,background:"transparent",border:"none",borderBottom:`1px solid ${C.accent}`,color:C.text1,fontSize:13,fontWeight:500,outline:"none",fontFamily:"inherit" }}/>
        ) : (
          <span style={{ flex:1,minWidth:0,fontSize:13,fontWeight:500,color:C.text1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{file.name}</span>
        )}
        {onRename&&!editingName&&<button onClick={()=>{setEditingName(true);setNameVal(file.name);}} title="이름 변경" style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.text2,display:"flex",flexShrink:0 }}><Pencil size={13}/></button>}
        {editingName&&<button onClick={saveRename} disabled={renaming} style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.success,display:"flex",flexShrink:0 }}>{renaming?<Loader2 size={13} style={{ animation:"spin 1s linear infinite" }}/>:<Check size={13}/>}</button>}
        {state==="pdf"&&<button onClick={()=>setNotesVisible(v=>!v)} style={{ background:notesVisible?C.accent+"22":"transparent",border:`1px solid ${notesVisible?C.accent+"44":C.border2}`,borderRadius:8,cursor:"pointer",padding:"5px 10px",color:notesVisible?C.accent:C.text2,display:"flex",alignItems:"center",gap:5,fontSize:12,flexShrink:0 }}><Pencil size={11}/>메모</button>}
        {blobUrl&&<a href={blobUrl} download={file.name} style={{ display:"flex",alignItems:"center",gap:5,fontSize:12,color:C.text2,padding:"5px 10px",borderRadius:8,border:`1px solid ${C.border2}`,textDecoration:"none",flexShrink:0 }}><Download size={12}/>다운로드</a>}
        {file.webViewLink&&<a href={file.webViewLink} target="_blank" rel="noreferrer" style={{ display:"flex",alignItems:"center",gap:5,fontSize:12,color:C.text2,padding:"5px 10px",borderRadius:8,border:`1px solid ${C.border2}`,textDecoration:"none",flexShrink:0 }}><ExternalLink size={12}/>Drive</a>}
        <button onClick={onClose} style={{ background:"transparent",border:"none",cursor:"pointer",padding:6,color:C.text2,display:"flex",borderRadius:8,flexShrink:0 }}><X size={16}/></button>
      </div>
      {/* ── Body ── */}
      <div style={{ flex:1,overflow:"auto",minHeight:0,padding:state==="pdf"?"16px 16px 32px":"24px" }}>
        {/* Non-PDF states */}
        {state==="loading"&&<div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:200,gap:12 }}><Loader2 size={28} color={C.accent} style={{ animation:"spin 1s linear infinite" }}/><span style={{ fontSize:13,color:C.text2 }}>불러오는 중...</span></div>}
        {state==="error"&&<div style={{ textAlign:"center",padding:40 }}><p style={{ fontSize:14,color:C.danger,marginBottom:8 }}>파일을 불러올 수 없습니다.</p>{file.webViewLink&&<a href={file.webViewLink} target="_blank" rel="noreferrer" style={{ fontSize:13,color:C.accent }}>Drive에서 열기</a>}</div>}
        {state==="no-drive"&&<p style={{ fontSize:14,color:C.text2,textAlign:"center",padding:40 }}>로컬 파일입니다.</p>}
        {state==="image"&&<div style={{ display:"flex",alignItems:"center",justifyContent:"center",minHeight:300 }}><img src={blobUrl} alt={file.name} style={{ maxWidth:"100%",maxHeight:"80vh",borderRadius:12,boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}/></div>}
        {state==="pdf-fallback"&&<div style={{ textAlign:"center",padding:40 }}><FileText size={40} color={C.text3} style={{ marginBottom:16 }}/><p style={{ fontSize:13,color:C.text2,marginBottom:16 }}>PDF 렌더러를 불러올 수 없습니다.</p><div style={{ display:"flex",gap:8,justifyContent:"center" }}>{blobUrl&&<a href={blobUrl} download={file.name} style={{ display:"flex",alignItems:"center",gap:6,fontSize:13,color:"white",padding:"8px 16px",borderRadius:10,background:C.accent,textDecoration:"none" }}><Download size={13}/>다운로드</a>}{file.webViewLink&&<a href={file.webViewLink} target="_blank" rel="noreferrer" style={{ display:"flex",alignItems:"center",gap:6,fontSize:13,color:C.text2,padding:"8px 16px",borderRadius:10,border:`1px solid ${C.border2}`,textDecoration:"none" }}><ExternalLink size={13}/>Drive에서 열기</a>}</div></div>}
        {state==="text"&&<div style={{ maxWidth:800,margin:"0 auto",background:C.surface,borderRadius:12,padding:24,border:`1px solid ${C.border2}` }}><pre style={{ fontSize:12,color:C.text2,lineHeight:1.7,whiteSpace:"pre-wrap",wordBreak:"break-word" }}>{textContent}</pre></div>}
        {state==="html"&&<iframe srcDoc={textContent} sandbox="allow-scripts allow-same-origin" title={file.name} style={{ width:"100%",minHeight:"80vh",border:"none",borderRadius:8,background:"white",display:"block",pointerEvents:"none" }} onLoad={e=>{try{const h=e.target.contentDocument?.documentElement?.scrollHeight;if(h)e.target.style.height=h+"px";}catch{}}}/>}
        {state==="other"&&<div style={{ textAlign:"center",padding:40 }}><div style={{ borderRadius:20,padding:24,background:C.surface2,display:"inline-flex",marginBottom:16 }}><File size={40} color={C.text3}/></div><p style={{ fontSize:13,color:C.text2,marginBottom:16 }}>이 형식은 뷰어에서 직접 보기가 불가능합니다.</p><div style={{ display:"flex",gap:8,justifyContent:"center" }}>{blobUrl&&<a href={blobUrl} download={file.name} style={{ display:"flex",alignItems:"center",gap:6,fontSize:13,color:"white",padding:"8px 16px",borderRadius:10,background:C.accent,textDecoration:"none" }}><Download size={13}/>다운로드</a>}{file.webViewLink&&<a href={file.webViewLink} target="_blank" rel="noreferrer" style={{ display:"flex",alignItems:"center",gap:6,fontSize:13,color:C.text2,padding:"8px 16px",borderRadius:10,border:`1px solid ${C.border2}`,textDecoration:"none" }}><ExternalLink size={13}/>Drive에서 열기</a>}</div></div>}
        {/* PDF: per-slide rows */}
        {state==="pdf"&&(
          <div style={{ maxWidth:notesVisible?1400:900,margin:"0 auto",display:"flex",flexDirection:"column",gap:12 }}>
            {pdfPageImgs.length===0&&<div style={{ display:"flex",alignItems:"center",justifyContent:"center",minHeight:200,gap:12 }}><Loader2 size={20} color={C.accent} style={{ animation:"spin 1s linear infinite" }}/><span style={{ fontSize:13,color:C.text2 }}>렌더링 중...</span></div>}
            {pdfPageImgs.map((imgUrl, i) => (
              <div key={i} style={{ display:"flex",flexDirection:narrow?"column":"row",borderRadius:10,overflow:"hidden",border:`1px solid ${C.border}`,background:"#111" }}>
                {/* Slide image — 70% */}
                <div style={{ flex:7,position:"relative",minWidth:0 }}>
                  <span style={{ position:"absolute",top:8,left:8,fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.6)",background:"rgba(0,0,0,0.55)",borderRadius:99,padding:"2px 8px",zIndex:1,userSelect:"none" }}>{i+1}</span>
                  <img src={imgUrl} alt={`슬라이드 ${i+1}`} style={{ width:"100%",height:"auto",display:"block" }}/>
                </div>
                {/* Per-slide notes — 30% */}
                {notesVisible&&(
                  <div style={{ flex:3,display:"flex",flexDirection:"column",borderLeft:narrow?"none":`1px solid ${C.border2}`,borderTop:narrow?`1px solid ${C.border2}`:"none",background:C.surface,minHeight:narrow?120:0,minWidth:0 }}>
                    <div style={{ padding:"6px 14px",borderBottom:`1px solid ${C.border}`,fontSize:10,fontWeight:600,color:C.text3,flexShrink:0,letterSpacing:"0.04em" }}>슬라이드 {i+1} 메모</div>
                    <PdfSlideNotes notesKey={`${notesBase}_p${i+1}`}/>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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
  const variants = { primary:{background:C.accent,color:"#fff"},ghost:{background:"transparent",color:C.text2,border:`1px solid ${C.border2}`},danger:{background:"rgba(248,113,113,0.12)",color:C.danger,border:"1px solid rgba(248,113,113,0.2)"},success:{background:"rgba(52,211,153,0.12)",color:C.success,border:"1px solid rgba(52,211,153,0.2)"} };
  return <button {...props} style={{ ...base,...variants[variant],...ext }} onMouseEnter={e=>e.currentTarget.style.opacity="0.8"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>{loading?<Loader2 size={13} style={{ animation:"spin 1s linear infinite" }}/>:Icon?<Icon size={sz==="sm"?11:13}/>:null}{children}</button>;
}
function Field({ label, children, style:ext={} }) { return <div style={{ ...S.col,...ext }}>{label&&<label style={S.label}>{label}</label>}{children}</div>; }
function Input({ label, style:ext={}, ...props }) { return <Field label={label}><input {...props} style={{ ...S.input,...ext }}/></Field>; }
function Textarea({ label, ...props }) { return <Field label={label}><textarea {...props} rows={3} style={{ ...S.input,resize:"none" }}/></Field>; }
function SelectInput({ label, children, ...props }) { return <Field label={label}><select {...props} style={{ ...S.input }}>{children}</select></Field>; }
function SyncDot({ status }) { const map={synced:C.success,syncing:C.accent,error:C.danger}; return <div style={{ width:7,height:7,borderRadius:"50%",background:map[status]||C.text3,flexShrink:0,animation:status==="syncing"?"pulse 1s infinite":undefined }}/>; }
function EmptyState({ icon:Icon, title, sub, action }) { return <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"64px 24px",border:`1.5px dashed ${C.border2}`,borderRadius:20,textAlign:"center" }}><div style={{ background:C.surface2,borderRadius:16,padding:16,marginBottom:16 }}><Icon size={28} color={C.text3}/></div><p style={{ fontSize:14,color:C.text2,fontWeight:500,marginBottom:6 }}>{title}</p>{sub&&<p style={{ fontSize:12,color:C.text3,marginBottom:16 }}>{sub}</p>}{action}</div>; }
function PageHeader({ title, sub, action }) { return <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:32 }}><div><h2 style={{ fontSize:20,fontWeight:700,color:C.text1,fontFamily:"Georgia,serif" }}>{title}</h2>{sub&&<p style={{ fontSize:13,color:C.text2,marginTop:4 }}>{sub}</p>}</div>{action}</div>; }

// ─── LOGIN ─────────────────────────────────────────────────
function LoginScreen({ onSignIn, loading }) {
  return (
    <div style={{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:C.bg,padding:24 }}>
      <div style={{ width:"100%",maxWidth:360 }}>
        <div style={{ ...S.card,padding:40,textAlign:"center" }}>
          <div style={{ display:"inline-flex",borderRadius:20,padding:16,marginBottom:24,background:`${C.accent}18`,border:`1px solid ${C.accent}30` }}><GraduationCap size={36} color={C.accent}/></div>
          <h1 style={{ fontSize:28,fontWeight:700,color:C.text1,marginBottom:8,fontFamily:"Georgia,serif" }}>CareerKit</h1>
          <p style={{ fontSize:13,color:C.text2,marginBottom:32,lineHeight:1.6 }}>커리어 관리 플랫폼</p>
          <button onClick={onSignIn} disabled={loading} style={{ width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:"12px 24px",borderRadius:12,border:`1px solid ${C.border2}`,background:C.surface2,color:C.text1,fontSize:14,fontWeight:500,cursor:"pointer",fontFamily:"inherit" }}>
            {loading?<Loader2 size={16} style={{ animation:"spin 1s linear infinite" }}/>:<svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.2 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1L37 9.8C33.7 6.8 29.1 5 24 5 12.9 5 4 13.9 4 25s8.9 20 20 20 20-8.9 20-20c0-1.3-.2-2.7-.4-4z"/><path fill="#FF3D00" d="M6.3 15.7l6.6 4.8C14.7 17 19 14 24 14c3.1 0 5.8 1.2 7.9 3.1L37 9.8C33.7 6.8 29.1 5 24 5c-7.7 0-14.4 4.2-17.7 10.7z"/><path fill="#4CAF50" d="M24 45c5.1 0 9.7-1.8 13.2-4.7l-6.1-5.2C29.3 36.6 26.8 37 24 37c-5.3 0-9.7-2.9-11.3-7.2l-6.5 5C9.5 40.7 16.3 45 24 45z"/><path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.4-2.3 4.3-4.3 5.6l6.1 5.2C40.8 35.6 44 31 44 25c0-1.3-.2-2.7-.4-4z"/></svg>}
            Google로 로그인
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
          <div style={{ flex:1,minWidth:0 }}><div style={{ fontSize:12,fontWeight:500,color:C.text1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{e.title}</div><div style={{ fontSize:11,color:C.text2,marginTop:2 }}>{formatDate(e.date)}</div></div>
          <span style={{ fontSize:16,fontWeight:900,color:e.diff===0?C.danger:C.accent,fontVariantNumeric:"tabular-nums" }}>{dDayLabel(e.diff)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── DASHBOARD ─────────────────────────────────────────────
function Dashboard({ library, certCategories, events, setPage, userInfo, onOpenFile }) {
  const countFiles = (n) => (n.files||[]).length + (n.folders||[]).reduce((b,f) => b + countFiles(f), 0);
  const totalFiles = library.reduce((a,s) => a + countFiles(s), 0);
  const totalCerts = certCategories.reduce((a,c)=>a+(c.certs||[]).length,0);
  const nextExam   = events.filter(e=>e.isDday&&diffDays(e.date)>=0).sort((a,b)=>diffDays(a.date)-diffDays(b.date))[0];
  const upcoming   = [...events].filter(e=>diffDays(e.date)>=0).sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,5);
  const recentFiles = useMemo(() => getRecentFiles(), []);
  const expiringCerts = useMemo(() => {
    const results = [];
    certCategories.forEach(cat => (cat.certs||[]).forEach(cert => {
      if (!cert.expiry) return;
      const d = diffDays(cert.expiry);
      if (d >= 0 && d <= 90) results.push({ ...cert, _catName:cat.name, _daysLeft:d });
    }));
    return results.sort((a,b)=>a._daysLeft-b._daysLeft);
  }, [certCategories]);
  const stats = [
    { icon:BookOpen, label:"강의 섹션",       value:library.length, color:"#818cf8", page:"library" },
    { icon:FileText, label:"학습 자료",       value:totalFiles,     color:"#38bdf8", page:"library" },
    { icon:Award,    label:"보유 자격증", value:totalCerts,     color:"#34d399", page:"certs" },
    { icon:Calendar, label:"등록 일정",       value:events.length,  color:"#fbbf24", page:"scheduler" },
  ];
  return (
    <div>
      <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:32 }}>
        {userInfo?.picture&&<img src={userInfo.picture} alt="" style={{ width:44,height:44,borderRadius:"50%",border:`2px solid ${C.border2}` }}/>}
        <div>
          <h2 style={{ fontSize:20,fontWeight:700,color:C.text1,fontFamily:"Georgia,serif" }}>{userInfo?.name?`안녕하세요, ${userInfo.name.split(" ")[0]}님`:"대시보드"}</h2>
          <p style={{ fontSize:12,color:C.text2 }}>{new Date().toLocaleDateString("ko-KR",{year:"numeric",month:"long",day:"numeric",weekday:"long"})}</p>
        </div>
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:12,marginBottom:24 }}>
        {stats.map(s=>(
          <button key={s.label} onClick={()=>setPage(s.page)} style={{ ...S.card,padding:16,textAlign:"left",cursor:"pointer",fontFamily:"inherit" }} onMouseEnter={e=>e.currentTarget.style.transform="scale(1.02)"} onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
            <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}><div style={{ borderRadius:10,padding:8,background:s.color+"18" }}><s.icon size={15} color={s.color}/></div><span style={{ fontSize:24,fontWeight:900,color:C.text1,fontVariantNumeric:"tabular-nums" }}>{s.value}</span></div>
            <div style={{ fontSize:11,color:C.text2 }}>{s.label}</div>
          </button>
        ))}
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
        <div style={{ ...S.card,padding:20 }}>
          <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:16 }}><AlertCircle size={13} color={C.danger}/><span style={{ fontSize:13,fontWeight:600,color:C.text1 }}>다음 D-Day</span></div>
          {nextExam?(<div style={{ display:"flex",alignItems:"center",gap:16 }}><div style={{ borderRadius:14,padding:"12px 16px",textAlign:"center",background:`${C.accent}18`,border:`1px solid ${C.accent}30`,minWidth:72 }}><div style={{ fontSize:22,fontWeight:900,color:C.accent,fontVariantNumeric:"tabular-nums" }}>{dDayLabel(diffDays(nextExam.date))}</div></div><div><div style={{ fontSize:13,fontWeight:600,color:C.text1 }}>{nextExam.title}</div><div style={{ fontSize:11,color:C.text2,marginTop:4 }}>{formatDate(nextExam.date)}</div><div style={{ fontSize:11,marginTop:6,display:"inline-block",padding:"2px 8px",borderRadius:99,background:EVENT_TYPES[nextExam.type]?.color+"22",color:EVENT_TYPES[nextExam.type]?.color }}>{EVENT_TYPES[nextExam.type]?.label}</div></div></div>):<p style={{ fontSize:13,color:C.text2 }}>등록된 D-Day가 없습니다.</p>}
        </div>
        <div style={{ ...S.card,padding:20 }}>
          <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:16 }}><Clock size={13} color={C.accent}/><span style={{ fontSize:13,fontWeight:600,color:C.text1 }}>예정 일정</span></div>
          {upcoming.length?(<div style={{ display:"flex",flexDirection:"column",gap:8 }}>{upcoming.map(e=>(<div key={e.id} style={{ display:"flex",alignItems:"center",gap:8 }}><div style={{ width:6,height:6,borderRadius:"50%",background:EVENT_TYPES[e.type]?.color,flexShrink:0 }}/><span style={{ fontSize:12,flex:1,color:C.text2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{e.title}</span><span style={{ fontSize:11,color:C.text3,flexShrink:0 }}>{formatDate(e.date)}</span></div>))}</div>):<p style={{ fontSize:13,color:C.text2 }}>예정된 일정이 없습니다.</p>}
        </div>
      </div>
      {expiringCerts.length > 0 && (
        <div style={{ ...S.card,padding:20,marginTop:16 }}>
          <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:16 }}><Bell size={13} color={C.warning}/><span style={{ fontSize:13,fontWeight:600,color:C.text1 }}>자격증 만료 임박</span><span style={{ fontSize:11,color:C.text3,marginLeft:4 }}>90일 이내</span></div>
          <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
            {expiringCerts.map(cert => {
              const urgentColor = cert._daysLeft <= 30 ? C.danger : cert._daysLeft <= 60 ? C.warning : C.accent;
              return (
                <div key={cert.id} onClick={()=>setPage("certs")} style={{ display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:10,background:urgentColor+"10",border:`1px solid ${urgentColor}25`,cursor:"pointer" }}>
                  <Award size={12} color={urgentColor} style={{ flexShrink:0 }}/>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:12,fontWeight:500,color:C.text1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{cert.name}</div>
                    <div style={{ fontSize:10,color:C.text3,marginTop:1 }}>{cert._catName} · {formatDate(cert.expiry)}</div>
                  </div>
                  <span style={{ fontSize:11,fontWeight:700,color:urgentColor,flexShrink:0 }}>{cert._daysLeft === 0 ? "오늘 만료" : `D-${cert._daysLeft}`}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {recentFiles.length > 0 && (
        <div style={{ ...S.card,padding:20,marginTop:16 }}>
          <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:16 }}><Clock size={13} color={C.accent}/><span style={{ fontSize:13,fontWeight:600,color:C.text1 }}>최근 열람</span></div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8 }}>
            {recentFiles.map(f=>{
              const FIcon=isPdf(f.name)?FileText:isImage(f.name)?Image:File;
              return (
                <button key={f.id} onClick={()=>onOpenFile(f)} style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:10,background:C.surface2,border:`1px solid ${C.border}`,cursor:"pointer",textAlign:"left",fontFamily:"inherit" }}>
                  <div style={{ borderRadius:7,padding:5,background:(f.sectionColor||C.accent)+"22",flexShrink:0 }}><FIcon size={12} color={f.sectionColor||C.accent}/></div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:12,color:C.text1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{f.name}</div>
                    <div style={{ fontSize:10,color:C.text3,marginTop:1 }}>{f.sectionName} · {formatTimeAgo(f.ts)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FILE MOVE MODAL ───────────────────────────────────────
// 파일을 다른 섹션/폴더로 이동시키는 모달
// library: 전체 라이브러리 배열
// file: 이동할 파일 객체
// currentSectionId, currentFolderId: 현재 위치
// onMove(targetSectionId, targetFolderId): 이동 콜백
function FileMoveModal({ file, library, currentSectionId, currentFolderId, onMove, onClose }) {
  const [targetSectionId, setTargetSectionId] = useState(currentSectionId);
  const [targetFolderId, setTargetFolderId] = useState(null); // null = 섹션 루트

  // 선택된 섹션의 폴더 목록 (재귀 flatten)
  function flattenFolders(folders, prefix="") {
    const result = [];
    for (const f of (folders||[])) {
      result.push({ id: f.id, label: prefix + f.name });
      result.push(...flattenFolders(f.folders||[], prefix + f.name + " / "));
    }
    return result;
  }

  const targetSection = library.find(s => s.id === targetSectionId);
  const folderOptions = targetSection ? flattenFolders(targetSection.folders||[]) : [];

  function handleMove() {
    onMove(targetSectionId, targetFolderId);
    onClose();
  }

  return (
    <Modal title={`"${file.name}" 이동`} onClose={onClose}>
      <div style={{ ...S.col, gap:16 }}>
        <SelectInput label="대상 섹션"
          value={targetSectionId}
          onChange={e => { setTargetSectionId(e.target.value); setTargetFolderId(null); }}>
          {library.map(s => <option key={s.id} value={s.id}>{s.subject}</option>)}
        </SelectInput>
        <SelectInput label="대상 폴더 (없으면 섹션 루트)"
          value={targetFolderId || ""}
          onChange={e => setTargetFolderId(e.target.value || null)}>
          <option value="">섹션 루트 (폴더 없음)</option>
          {folderOptions.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </SelectInput>
        {/* 현재 위치와 같으면 경고 */}
        {targetSectionId === currentSectionId && targetFolderId === currentFolderId && (
          <p style={{ fontSize:12, color:C.warning }}>현재 위치와 동일합니다.</p>
        )}
        <div style={{ display:"flex",gap:8,justifyContent:"flex-end",marginTop:4 }}>
          <Btn variant="ghost" onClick={onClose}>취소</Btn>
          <Btn
            icon={MoveRight}
            onClick={handleMove}
            disabled={targetSectionId === currentSectionId && targetFolderId === currentFolderId}>
            이동
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── FILE ROW ──────────────────────────────────────────────
function FileRow({ file, color, onDelete, onRename, onView, onMove, deleting, depth=0 }) {
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState(file.name);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const FIcon = isImage(file.name)?Image:isPdf(file.name)?FileText:File;
  async function saveRename() { if(!newName.trim()||newName===file.name){setEditing(false);return;} setRenaming(true); await onRename(file,newName.trim()); setRenaming(false); setEditing(false); }
  async function handleDownload() {
    if (!file.driveId) return;
    setDownloading(true);
    try {
      const blob = await fetchFileBlob(file.driveId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href=url; a.download=file.name; a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
    } catch(e) { console.error(e); } finally { setDownloading(false); }
  }
  return (
    <div style={{ display:"flex",alignItems:"center",gap:10,padding:"8px 16px",paddingLeft:16+depth*20,borderBottom:`1px solid ${C.border}` }}>
      <div style={{ borderRadius:7,padding:5,background:(color||C.accent)+"18",flexShrink:0 }}><FIcon size={11} color={color||C.accent}/></div>
      {editing?(<input autoFocus value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveRename();if(e.key==="Escape"){setEditing(false);setNewName(file.name);}}} style={{ flex:1,background:"transparent",border:"none",borderBottom:`1px solid ${C.accent}`,color:C.text1,fontSize:12,outline:"none",fontFamily:"inherit" }}/>):(<span style={{ flex:1,fontSize:12,color:C.text2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{file.name}</span>)}
      <span style={{ fontSize:10,color:C.text3,flexShrink:0 }}>{file.size}</span>
      <span style={{ fontSize:10,color:C.text3,flexShrink:0 }}>{formatDate(file.date)}</span>
      {editing?(
        <button onClick={saveRename} disabled={renaming} style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.success,display:"flex" }}>{renaming?<Loader2 size={11} style={{ animation:"spin 1s linear infinite" }}/>:<Check size={11}/>}</button>
      ):confirming?(
        <>
          <span style={{ fontSize:10,color:C.danger,flexShrink:0 }}>삭제?</span>
          <button onClick={()=>{setConfirming(false);onDelete(file);}} style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.danger,display:"flex" }}><Check size={11}/></button>
          <button onClick={()=>setConfirming(false)} style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.text2,display:"flex" }}><X size={11}/></button>
        </>
      ):(
        <>
          <button onClick={()=>onView(file)} title="보기" style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.accent,display:"flex" }}><Eye size={11}/></button>
          {file.driveId&&<button onClick={handleDownload} disabled={downloading} title="다운로드" style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.text2,display:"flex" }}>{downloading?<Loader2 size={11} style={{ animation:"spin 1s linear infinite" }}/>:<Download size={11}/>}</button>}
          <button onClick={()=>{setEditing(true);setNewName(file.name);}} title="이름 변경" style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.text2,display:"flex" }}><Pencil size={11}/></button>
          {onMove && <button onClick={()=>onMove(file)} title="이동" style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.text2,display:"flex" }}><MoveRight size={11}/></button>}
          <button onClick={()=>setConfirming(true)} disabled={deleting===file.id} title="삭제" style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.danger,display:"flex" }}>{deleting===file.id?<Loader2 size={11} style={{ animation:"spin 1s linear infinite" }}/>:<Trash2 size={11}/>}</button>
        </>
      )}
    </div>
  );
}

// ─── FOLDER TREE ───────────────────────────────────────────
function FolderTree({ folder, sectionId, sectionColor, depth=0, onDeleteFile, onRenameFile, onViewFile, onMoveFile, onDeleteFolder, onRenameFolder, onAddSubfolder, onUpload, deletingFile, uploading, uploadTarget }) {
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  const [showAddSub, setShowAddSub] = useState(false);
  const [subName, setSubName] = useState("");
  const [confirmFolder, setConfirmFolder] = useState(false);
  const indentPx = 20+depth*16;
  const isUploading = uploading&&uploadTarget?.folderId===folder.id;
  function saveRename() { if(!editName.trim()){setEditing(false);return;} onRenameFolder(sectionId,folder.id,editName.trim()); setEditing(false); }
  function addSub() { if(!subName.trim()) return; onAddSubfolder(sectionId,folder.id,subName.trim()); setSubName(""); setShowAddSub(false); }
  return (
    <div style={{ borderTop:`1px solid ${C.border}` }}>
      <div style={{ display:"flex",alignItems:"center",gap:8,padding:`10px 16px`,paddingLeft:indentPx,background:depth%2===0?C.surface2:C.surface3 }}>
        <button onClick={()=>setCollapsed(p=>!p)} style={{ background:"transparent",border:"none",cursor:"pointer",padding:2,color:C.text3,display:"flex" }}>{collapsed?<CR size={12}/>:<ChevronDown size={12}/>}</button>
        <Folder size={13} color={sectionColor} style={{ flexShrink:0 }}/>
        {editing?(<input autoFocus value={editName} onChange={e=>setEditName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveRename();if(e.key==="Escape")setEditing(false);}} style={{ flex:1,background:"transparent",border:"none",borderBottom:`1px solid ${sectionColor}`,color:C.text1,fontSize:12,fontWeight:500,outline:"none",fontFamily:"inherit" }}/>):(<span style={{ flex:1,fontSize:12,fontWeight:500,color:C.text1 }}>{folder.name}</span>)}
        <span style={{ fontSize:10,color:C.text3 }}>{(folder.files||[]).length+(folder.folders||[]).reduce((a,f)=>a+(f.files||[]).length,0)}개</span>
        {editing?(<button onClick={saveRename} style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:sectionColor,display:"flex" }}><Check size={11}/></button>):(<button onClick={()=>{setEditing(true);setEditName(folder.name);}} style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.text2,display:"flex" }}><Pencil size={11}/></button>)}
        <button onClick={()=>setShowAddSub(true)} title="하위 폴더" style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.text2,display:"flex" }}><FolderOpen size={11}/></button>
        <button onClick={()=>onUpload(sectionId,folder.id)} disabled={isUploading} style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:sectionColor,display:"flex" }}>{isUploading?<Loader2 size={11} style={{ animation:"spin 1s linear infinite" }}/>:<Upload size={11}/>}</button>
        {confirmFolder?(
          <>
            <span style={{ fontSize:10,color:C.danger,flexShrink:0 }}>삭제?</span>
            <button onClick={()=>{setConfirmFolder(false);onDeleteFolder(sectionId,folder.id);}} style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.danger,display:"flex" }}><Check size={11}/></button>
            <button onClick={()=>setConfirmFolder(false)} style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.text2,display:"flex" }}><X size={11}/></button>
          </>
        ):(
          <button onClick={()=>setConfirmFolder(true)} title="폴더 삭제" style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.danger,display:"flex" }}><Trash2 size={11}/></button>
        )}
      </div>
      {showAddSub&&(<div style={{ display:"flex",gap:8,padding:"8px 16px",paddingLeft:indentPx+20,background:C.surface2,borderTop:`1px solid ${C.border}` }}><input autoFocus value={subName} onChange={e=>setSubName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")addSub();if(e.key==="Escape")setShowAddSub(false);}} placeholder={"하위 폴더 이름 → Enter"} style={{ ...S.input,flex:1,fontSize:11,padding:"5px 8px" }}/><button onClick={addSub} style={{ background:C.accent,border:"none",borderRadius:8,color:"white",fontSize:11,padding:"5px 10px",cursor:"pointer",fontFamily:"inherit" }}>추가</button><button onClick={()=>setShowAddSub(false)} style={{ background:"transparent",border:"none",cursor:"pointer",color:C.text3 }}><X size={12}/></button></div>)}
      {!collapsed&&(<>
        {(folder.files||[]).map(file=>(<FileRow key={file.id} file={file} color={sectionColor} depth={depth+1}
          onDelete={f=>onDeleteFile(sectionId,f,folder.id)}
          onRename={(f,n)=>onRenameFile(sectionId,f,n,folder.id)}
          onView={f=>onViewFile(f,folder.id)}
          onMove={f=>onMoveFile(f,sectionId,folder.id)}
          deleting={deletingFile}/>))}
        {(folder.folders||[]).map(sub=>(<FolderTree key={sub.id} folder={sub} sectionId={sectionId} sectionColor={sectionColor} depth={depth+1}
          onDeleteFile={onDeleteFile} onRenameFile={onRenameFile} onViewFile={onViewFile} onMoveFile={onMoveFile}
          onDeleteFolder={onDeleteFolder} onRenameFolder={onRenameFolder} onAddSubfolder={onAddSubfolder}
          onUpload={onUpload} deletingFile={deletingFile} uploading={uploading} uploadTarget={uploadTarget}/>))}
        {(folder.files||[]).length===0&&(folder.folders||[]).length===0&&(<div style={{ padding:`8px 16px`,paddingLeft:indentPx+20,fontSize:11,color:C.text3 }}>비어 있습니다.</div>)}
      </>)}
    </div>
  );
}

// ─── LIBRARY ───────────────────────────────────────────────
function Library({ library, onChange, driveFolderId }) {
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSection, setNewSection] = useState({ subject:"",color:SEC_COLORS[0] });
  const [editSectionId, setEditSectionId] = useState(null);
  const [editSectionName, setEditSectionName] = useState("");
  const [addFolderTarget, setAddFolderTarget] = useState(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [collapsedSections, setCollapsedSections] = useState({});
  const [uploading, setUploading] = useState(false);
  const [uploadTarget, setUploadTarget] = useState(null);
  const [deletingFile, setDeletingFile] = useState(null);
  const [viewingFile, setViewingFile] = useState(null);
  const [movingFile, setMovingFile] = useState(null); // { file, sectionId, folderId }
  const [confirmSection, setConfirmSection] = useState(null); // { id, name }
  const fileInputRef = useRef(null);

  // 폴더 트리 헬퍼
  function updateFolderInTree(folders,tid,upd){return folders.map(f=>{if(f.id===tid)return upd(f);if(f.folders?.length)return{...f,folders:updateFolderInTree(f.folders,tid,upd)};return f;});}
  function removeFolderFromTree(folders,tid){return folders.filter(f=>f.id!==tid).map(f=>({...f,folders:f.folders?removeFolderFromTree(f.folders,tid):[]}));}

  // 특정 폴더에서 파일 제거
  function removeFileFromSection(lib, sectionId, fileId, folderId) {
    return lib.map(s => {
      if (s.id !== sectionId) return s;
      if (!folderId) return { ...s, files:(s.files||[]).filter(f=>f.id!==fileId) };
      return { ...s, folders: updateFolderInTree(s.folders||[], folderId, f=>({...f, files:(f.files||[]).filter(fi=>fi.id!==fileId)})) };
    });
  }
  // 특정 폴더에 파일 추가
  function addFileToSection(lib, sectionId, file, folderId) {
    return lib.map(s => {
      if (s.id !== sectionId) return s;
      if (!folderId) return { ...s, files:[...(s.files||[]), file] };
      return { ...s, folders: updateFolderInTree(s.folders||[], folderId, f=>({...f, files:[...(f.files||[]), file]})) };
    });
  }

  function addSection(){if(!newSection.subject.trim())return;onChange([...library,{id:uid(),subject:newSection.subject.trim(),color:newSection.color,folders:[],files:[]}]);setNewSection({subject:"",color:SEC_COLORS[0]});setShowAddSection(false);}
  function deleteSection(id){onChange(library.filter(s=>s.id!==id));}
  function saveSectionEdit(id){if(!editSectionName.trim()){setEditSectionId(null);return;}onChange(library.map(s=>s.id!==id?s:{...s,subject:editSectionName.trim()}));setEditSectionId(null);}
  function addRootFolder(sid){if(!newFolderName.trim())return;onChange(library.map(s=>s.id!==sid?s:{...s,folders:[...(s.folders||[]),{id:uid(),name:newFolderName.trim(),files:[],folders:[]}]}));setNewFolderName("");setAddFolderTarget(null);}
  function handleAddSubfolder(sid,pid,name){onChange(library.map(s=>{if(s.id!==sid)return s;return{...s,folders:updateFolderInTree(s.folders||[],pid,f=>({...f,folders:[...(f.folders||[]),{id:uid(),name,files:[],folders:[]}]}))};}));}
  function handleDeleteFolder(sid,fid){onChange(library.map(s=>{if(s.id!==sid)return s;return{...s,folders:removeFolderFromTree(s.folders||[],fid)};}));}
  function handleRenameFolder(sid,fid,name){onChange(library.map(s=>{if(s.id!==sid)return s;return{...s,folders:updateFolderInTree(s.folders||[],fid,f=>({...f,name}))};}));}

  function openUpload(sid,fid=null){setUploadTarget({sectionId:sid,folderId:fid});setTimeout(()=>fileInputRef.current?.click(),50);}

  // 섹션 드래그
  const sectionDrag = useDragList(library, onChange);
  // 루트 파일 드래그 (섹션 내)
  const fileDragRefs = useRef({});
  const [fileDragState, setFileDragState] = useState({});
  function onFileDragStart(sectionId, i) { fileDragRefs.current[sectionId] = { dragIdx: i }; }
  function onFileDragOver(e, sectionId, i) { e.preventDefault(); setFileDragState(p=>({...p,[sectionId]:i})); }
  function onFileDrop(e, sectionId, i) {
    e.preventDefault();
    const ref = fileDragRefs.current[sectionId] || {};
    if (ref.dragIdx !== null && ref.dragIdx !== undefined && ref.dragIdx !== i) {
      const section = library.find(s=>s.id===sectionId);
      if (section) onChange(library.map(s=>s.id!==sectionId?s:{...s,files:reorder(s.files||[],ref.dragIdx,i)}));
    }
    fileDragRefs.current[sectionId] = {};
    setFileDragState(p=>({...p,[sectionId]:null}));
  }
  function onFileDragEnd(sectionId) { fileDragRefs.current[sectionId] = {}; setFileDragState(p=>({...p,[sectionId]:null})); }

  async function handleFileSelect(e){
    const files=Array.from(e.target.files);if(!files.length||!driveFolderId||!uploadTarget)return;
    setUploading(true);
    try{
      const uploaded=await Promise.all(files.map(f=>uploadFileToDrive(f,driveFolderId)));
      const newFiles=uploaded.map(r=>({id:uid(),driveId:r.id,name:r.name,size:formatBytes(r.size),date:today(),webViewLink:r.webViewLink,mimeType:r.mimeType}));
      const{sectionId,folderId}=uploadTarget;
      onChange(library.map(s=>{
        if(s.id!==sectionId)return s;
        if(!folderId)return{...s,files:[...(s.files||[]),...newFiles]};
        return{...s,folders:updateFolderInTree(s.folders||[],folderId,f=>({...f,files:[...(f.files||[]),...newFiles]}))};
      }));
    }catch(err){addToast("error","업로드 실패: "+err.message);}
    finally{setUploading(false);setUploadTarget(null);if(fileInputRef.current)fileInputRef.current.value="";}
  }

  async function handleDeleteFile(sid,file,fid=null){
    setDeletingFile(file.id);
    try{if(file.driveId)await deleteDriveFile(file.driveId);onChange(removeFileFromSection(library,sid,file.id,fid));}
    catch(e){console.error(e);}finally{setDeletingFile(null);}
  }

  async function handleRenameFile(sid,file,newName,fid=null){
    if(file.driveId){try{await renameDriveFile(file.driveId,newName);}catch(e){console.error(e);}}
    onChange(library.map(s=>{
      if(s.id!==sid)return s;
      const ren=files=>files.map(f=>f.id===file.id?{...f,name:newName}:f);
      if(!fid)return{...s,files:ren(s.files||[])};
      return{...s,folders:updateFolderInTree(s.folders||[],fid,f=>({...f,files:ren(f.files||[])}))};
    }));
  }

  // 파일 이동: 원래 위치에서 제거 → 새 위치에 추가
  function handleMoveFile(file, fromSectionId, fromFolderId, toSectionId, toFolderId) {
    let lib = removeFileFromSection(library, fromSectionId, file.id, fromFolderId);
    lib = addFileToSection(lib, toSectionId, file, toFolderId);
    onChange(lib);
  }

  return (
    <div>
      <input ref={fileInputRef} type="file" multiple style={{ display:"none" }} onChange={handleFileSelect}/>
      {viewingFile&&<FileViewer file={viewingFile} onClose={()=>setViewingFile(null)} onRename={async(f,n)=>{await handleRenameFile(viewingFile._sectionId,f,n,viewingFile._folderId);setViewingFile(p=>({...p,name:n}));}}/>}
      {movingFile&&(
        <FileMoveModal
          file={movingFile.file}
          library={library}
          currentSectionId={movingFile.sectionId}
          currentFolderId={movingFile.folderId}
          onMove={(toSectionId, toFolderId) => handleMoveFile(movingFile.file, movingFile.sectionId, movingFile.folderId, toSectionId, toFolderId)}
          onClose={()=>setMovingFile(null)}
        />
      )}
      <PageHeader title="강의 자료실" sub="섹션 → 폴더(중첩) → 파일" action={<Btn icon={Plus} onClick={()=>setShowAddSection(true)}>새 섹션</Btn>}/>
      {library.length===0&&<EmptyState icon={FolderOpen} title="강의 섹션이 없습니다" action={<Btn icon={Plus} onClick={()=>setShowAddSection(true)}>섹션 추가</Btn>}/>}
      <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
        {library.map((section,sIdx)=>{
          const collapsed=collapsedSections[section.id];
          return (
            <div key={section.id}
              draggable
              onDragStart={()=>sectionDrag.onDragStart(sIdx)}
              onDragOver={e=>sectionDrag.onDragOver(e,sIdx)}
              onDrop={e=>sectionDrag.onDrop(e,sIdx)}
              onDragEnd={sectionDrag.onDragEnd}
              style={{ ...S.card,overflow:"hidden", opacity:sectionDrag.overIdx===sIdx?0.6:1, outline:sectionDrag.overIdx===sIdx?"2px dashed "+C.accent:"none" }}>
              <div style={{ display:"flex",alignItems:"center",gap:10,padding:"14px 20px",borderLeft:`3px solid ${section.color}`,background:C.surface,borderBottom:`1px solid ${C.border}` }}>
                <button onClick={()=>setCollapsedSections(p=>({...p,[section.id]:!p[section.id]}))} style={{ background:"transparent",border:"none",cursor:"pointer",padding:2,color:C.text3,display:"flex" }}>{collapsed?<CR size={13}/>:<ChevronDown size={13}/>}</button>
                {editSectionId===section.id?(<input autoFocus value={editSectionName} onChange={e=>setEditSectionName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveSectionEdit(section.id);if(e.key==="Escape")setEditSectionId(null);}} style={{ flex:1,background:"transparent",border:"none",borderBottom:`1px solid ${section.color}`,color:C.text1,fontSize:13,fontWeight:600,outline:"none",fontFamily:"inherit" }}/>):(<span style={{ flex:1,fontSize:13,fontWeight:600,color:C.text1 }}>{section.subject}</span>)}
                {editSectionId===section.id?(<button onClick={()=>saveSectionEdit(section.id)} style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:section.color,display:"flex" }}><Check size={12}/></button>):(<button onClick={()=>{setEditSectionId(section.id);setEditSectionName(section.subject);}} style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.text2,display:"flex" }}><Pencil size={12}/></button>)}
                <Btn size="sm" icon={FolderOpen} variant="ghost" style={{ background:section.color+"18",color:section.color,border:"none" }} onClick={()=>setAddFolderTarget(section.id)}>폴더</Btn>
                <Btn size="sm" icon={Upload} variant="ghost" style={{ background:section.color+"18",color:section.color,border:"none" }} loading={uploading&&uploadTarget?.sectionId===section.id&&!uploadTarget?.folderId} onClick={()=>openUpload(section.id)}>파일</Btn>
                <button onClick={()=>setConfirmSection({id:section.id,name:section.subject})} title="섹션 삭제" style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.danger,display:"flex" }}><Trash2 size={12}/></button>
              </div>
              {!collapsed&&(<div>
                {/* 루트 파일 — 드래그로 순서 변경, 이동 버튼으로 폴더 간 이동 */}
                {(section.files||[]).map((file,fIdx)=>(
                  <div key={file.id}
                    draggable
                    onDragStart={()=>onFileDragStart(section.id,fIdx)}
                    onDragOver={e=>onFileDragOver(e,section.id,fIdx)}
                    onDrop={e=>onFileDrop(e,section.id,fIdx)}
                    onDragEnd={()=>onFileDragEnd(section.id)}
                    style={{ opacity:fileDragState[section.id]===fIdx?0.5:1, outline:fileDragState[section.id]===fIdx?`2px dashed ${C.accent}`:"none" }}>
                    <FileRow
                      file={file} color={section.color} depth={0}
                      onDelete={f=>handleDeleteFile(section.id,f,null)}
                      onRename={(f,n)=>handleRenameFile(section.id,f,n,null)}
                      onView={f=>{ addRecentFile(f, section.subject, section.color); setViewingFile({...f,_sectionId:section.id,_folderId:null}); }}
                      onMove={f=>setMovingFile({file:f, sectionId:section.id, folderId:null})}
                      deleting={deletingFile}/>
                  </div>
                ))}
                {/* 폴더 트리 */}
                {(section.folders||[]).map(folder=>(
                  <FolderTree key={folder.id} folder={folder} sectionId={section.id} sectionColor={section.color} depth={0}
                    onDeleteFile={handleDeleteFile}
                    onRenameFile={handleRenameFile}
                    onViewFile={(f,fid)=>{ addRecentFile(f, section.subject, section.color); setViewingFile({...f,_sectionId:section.id,_folderId:fid}); }}
                    onMoveFile={(f,sid,fid)=>setMovingFile({file:f, sectionId:sid, folderId:fid})}
                    onDeleteFolder={handleDeleteFolder}
                    onRenameFolder={handleRenameFolder}
                    onAddSubfolder={handleAddSubfolder}
                    onUpload={openUpload}
                    deletingFile={deletingFile}
                    uploading={uploading}
                    uploadTarget={uploadTarget}/>
                ))}
                {(section.files||[]).length===0&&(section.folders||[]).length===0&&(<div style={{ padding:"14px 20px",fontSize:12,color:C.text3 }}>폴더나 파일을 추가하세요.</div>)}
              </div>)}
            </div>
          );
        })}
      </div>
      {showAddSection&&(<Modal title="새 섹션 추가" onClose={()=>setShowAddSection(false)}><div style={{ ...S.col,gap:16 }}><Input label="과목명" value={newSection.subject} onChange={e=>setNewSection(p=>({...p,subject:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addSection()} placeholder="NCS, TOEIC ..."/><Field label="색상"><div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>{SEC_COLORS.map(c=>(<button key={c} onClick={()=>setNewSection(p=>({...p,color:c}))} style={{ width:28,height:28,borderRadius:"50%",background:c,border:newSection.color===c?"3px solid white":"3px solid transparent",cursor:"pointer",outline:"none",opacity:newSection.color===c?1:0.5 }}/>))}</div></Field><div style={{ display:"flex",gap:8,justifyContent:"flex-end" }}><Btn variant="ghost" onClick={()=>setShowAddSection(false)}>취소</Btn><Btn onClick={addSection}>추가</Btn></div></div></Modal>)}
      {addFolderTarget&&(<Modal title="폴더 추가" onClose={()=>setAddFolderTarget(null)}><div style={{ ...S.col,gap:16 }}><Input label="폴더 이름" value={newFolderName} onChange={e=>setNewFolderName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addRootFolder(addFolderTarget)} placeholder="1주차, 실전문제 ..."/><div style={{ display:"flex",gap:8,justifyContent:"flex-end" }}><Btn variant="ghost" onClick={()=>setAddFolderTarget(null)}>취소</Btn><Btn onClick={()=>addRootFolder(addFolderTarget)}>추가</Btn></div></div></Modal>)}
      {confirmSection&&(<Modal title="섹션 삭제" onClose={()=>setConfirmSection(null)}><p style={{ fontSize:13,color:C.text2,marginBottom:20 }}>"{confirmSection.name}" 섹션과 포함된 모든 파일을 삭제하시겠습니까?</p><div style={{ display:"flex",gap:8,justifyContent:"flex-end" }}><Btn variant="ghost" onClick={()=>setConfirmSection(null)}>취소</Btn><Btn variant="danger" onClick={()=>{deleteSection(confirmSection.id);setConfirmSection(null);}}>삭제</Btn></div></Modal>)}
    </div>
  );
}

// ─── CERT FILE ROW ─────────────────────────────────────────
function CertFileRow({ file, onView, onDelete, deleting }) {
  const [downloading, setDownloading] = useState(false);
  async function handleDownload() {
    if (!file.driveId) return;
    setDownloading(true);
    try {
      const blob = await fetchFileBlob(file.driveId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href=url; a.download=file.name; a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
    } catch(e) { console.error(e); } finally { setDownloading(false); }
  }
  return (
    <div style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 14px",borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
      <FileText size={10} color="rgba(255,255,255,0.4)"/>
      <span style={{ flex:1,fontSize:10,color:"rgba(255,255,255,0.55)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{file.name}</span>
      <button onClick={onView} style={{ background:"transparent",border:"none",cursor:"pointer",display:"flex",color:"rgba(255,255,255,0.5)",padding:2 }}><Eye size={10}/></button>
      {file.driveId&&<button onClick={handleDownload} disabled={downloading} title="다운로드" style={{ background:"transparent",border:"none",cursor:"pointer",display:"flex",color:"rgba(255,255,255,0.4)",padding:2 }}>{downloading?<Loader2 size={10} style={{ animation:"spin 1s linear infinite" }}/>:<Download size={10}/>}</button>}
      <button onClick={onDelete} disabled={deleting} title="삭제" style={{ background:"transparent",border:"none",cursor:"pointer",display:"flex",color:"rgba(255,255,255,0.4)",padding:2 }}>{deleting?<Loader2 size={10} style={{ animation:"spin 1s linear infinite" }}/>:<Trash2 size={10}/>}</button>
    </div>
  );
}

// ─── CERTIFICATES ──────────────────────────────────────────
function Certificates({ certCategories, onChange, driveFolderId }) {
  const [showAddCat, setShowAddCat] = useState(false);
  const [newCat, setNewCat] = useState({ name:"",color:SEC_COLORS[0] });
  const [showAddCert, setShowAddCert] = useState(null);
  const [certForm, setCertForm] = useState({ name:"",issuer:"",date:"",expiry:"",score:"",note:"",color:CERT_COLORS[0] });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [collapsedCats, setCollapsedCats] = useState({});
  const [uploadingCert, setUploadingCert] = useState(null);
  const [deletingFile, setDeletingFile] = useState(null);
  const [viewingFile, setViewingFile] = useState(null);
  const [editCertTarget, setEditCertTarget] = useState(null); // { catId, certId }
  const fileInputRef = useRef(null);
  const uploadTargetRef = useRef(null);
  const cf = k=>e=>setCertForm(p=>({...p,[k]:e.target.value}));

  function addCategory(){if(!newCat.name.trim())return;onChange([...certCategories,{id:uid(),name:newCat.name.trim(),color:newCat.color,certs:[]}]);setNewCat({name:"",color:SEC_COLORS[0]});setShowAddCat(false);}
  function deleteCategory(id){onChange(certCategories.filter(c=>c.id!==id));setConfirmDelete(null);}
  function addCert(catId){if(!certForm.name.trim())return;onChange(certCategories.map(cat=>cat.id!==catId?cat:{...cat,certs:[...(cat.certs||[]),{...certForm,id:uid(),files:[]}]}));setCertForm({name:"",issuer:"",date:"",expiry:"",score:"",note:"",color:CERT_COLORS[0]});setShowAddCert(null);}
  function deleteCert(catId,certId){onChange(certCategories.map(cat=>cat.id!==catId?cat:{...cat,certs:(cat.certs||[]).filter(c=>c.id!==certId)}));setConfirmDelete(null);}
  function updateCert(catId,certId){if(!certForm.name.trim())return;onChange(certCategories.map(cat=>cat.id!==catId?cat:{...cat,certs:(cat.certs||[]).map(c=>c.id!==certId?c:{...c,...certForm})}));setEditCertTarget(null);addToast("success","자격증이 수정되었습니다.");}
  function openUpload(catId,certId){uploadTargetRef.current={catId,certId};setTimeout(()=>fileInputRef.current?.click(),50);}
  async function handleFileSelect(e){const files=Array.from(e.target.files);if(!files.length||!driveFolderId)return;const{catId,certId}=uploadTargetRef.current;setUploadingCert(certId);try{const uploaded=await Promise.all(files.map(f=>uploadFileToDrive(f,driveFolderId)));const newFiles=uploaded.map(r=>({id:uid(),driveId:r.id,name:r.name,size:formatBytes(r.size),date:today(),webViewLink:r.webViewLink}));onChange(certCategories.map(cat=>cat.id!==catId?cat:{...cat,certs:(cat.certs||[]).map(c=>c.id!==certId?c:{...c,files:[...(c.files||[]),...newFiles]})}));}catch(err){addToast("error","업로드 실패: "+err.message);}finally{setUploadingCert(null);uploadTargetRef.current=null;if(fileInputRef.current)fileInputRef.current.value="";}}
  async function handleDeleteFile(catId,certId,file){setDeletingFile(file.id);try{if(file.driveId)await deleteDriveFile(file.driveId);onChange(certCategories.map(cat=>cat.id!==catId?cat:{...cat,certs:(cat.certs||[]).map(c=>c.id!==certId?c:{...c,files:(c.files||[]).filter(f=>f.id!==file.id)})}));}catch(e){console.error(e);}finally{setDeletingFile(null);}}
  function expiryStatus(expiry){if(!expiry)return null;const d=diffDays(expiry);if(d<0)return{text:"만료됨",color:C.danger};if(d<90)return{text:`${d}일 후 만료`,color:C.warning};return{text:"유효",color:C.success};}
  const catDrag = useDragList(certCategories, onChange);
  const certDragRefs = useRef({});
  const [certDragState, setCertDragState] = useState({});
  function onCertDragStart(catId,i){certDragRefs.current[catId]={dragIdx:i};}
  function onCertDragOver(e,catId,i){e.preventDefault();setCertDragState(p=>({...p,[catId]:i}));}
  function onCertDrop(e,catId,i){e.preventDefault();const ref=certDragRefs.current[catId]||{};if(ref.dragIdx!==null&&ref.dragIdx!==undefined&&ref.dragIdx!==i){onChange(certCategories.map(cat=>cat.id!==catId?cat:{...cat,certs:reorder(cat.certs||[],ref.dragIdx,i)}));}certDragRefs.current[catId]={};setCertDragState(p=>({...p,[catId]:null}));}
  function onCertDragEnd(catId){certDragRefs.current[catId]={};setCertDragState(p=>({...p,[catId]:null}));}

  return (
    <div>
      <input ref={fileInputRef} type="file" multiple style={{ display:"none" }} onChange={handleFileSelect}/>
      {viewingFile&&<FileViewer file={viewingFile} onClose={()=>setViewingFile(null)} onRename={async(f,n)=>{if(f.driveId){try{await renameDriveFile(f.driveId,n);}catch(e){console.error(e);}}onChange(certCategories.map(cat=>cat.id!==viewingFile._catId?cat:{...cat,certs:(cat.certs||[]).map(c=>c.id!==viewingFile._certId?c:{...c,files:(c.files||[]).map(fi=>fi.id===f.id?{...fi,name:n}:fi)})}));setViewingFile(p=>({...p,name:n}));}}/>}
      <PageHeader title="자격증 보관함" sub="카테고리 → 자격증 → 관련 파일" action={<Btn icon={Plus} onClick={()=>setShowAddCat(true)}>카테고리 추가</Btn>}/>
      {certCategories.length===0&&<EmptyState icon={Award} title="카테고리가 없습니다" sub="어학, IT, 국가자격증 등" action={<Btn icon={Plus} onClick={()=>setShowAddCat(true)}>카테고리 추가</Btn>}/>}
      <div style={{ display:"flex",flexDirection:"column",gap:20 }}>
        {certCategories.map((cat,catIdx)=>{
          const collapsed=collapsedCats[cat.id];
          return (
            <div key={cat.id}
              draggable
              onDragStart={()=>catDrag.onDragStart(catIdx)}
              onDragOver={e=>catDrag.onDragOver(e,catIdx)}
              onDrop={e=>catDrag.onDrop(e,catIdx)}
              onDragEnd={catDrag.onDragEnd}
              style={{ ...S.card,overflow:"hidden", opacity:catDrag.overIdx===catIdx?0.6:1, outline:catDrag.overIdx===catIdx?"2px dashed "+C.accent:"none" }}>
              <div style={{ display:"flex",alignItems:"center",gap:10,padding:"14px 20px",borderBottom:`1px solid ${C.border}`,borderLeft:`3px solid ${cat.color}`,background:C.surface }}>
                <button onClick={()=>setCollapsedCats(p=>({...p,[cat.id]:!p[cat.id]}))} style={{ background:"transparent",border:"none",cursor:"pointer",padding:2,color:C.text3,display:"flex" }}>{collapsed?<CR size={13}/>:<ChevronDown size={13}/>}</button>
                <div style={{ width:10,height:10,borderRadius:"50%",background:cat.color,flexShrink:0 }}/>
                <span style={{ flex:1,fontSize:14,fontWeight:600,color:C.text1 }}>{cat.name}</span>
                <span style={{ fontSize:11,color:C.text3 }}>{(cat.certs||[]).length}개</span>
                <Btn size="sm" icon={Plus} variant="ghost" style={{ background:cat.color+"18",color:cat.color,border:"none" }} onClick={()=>{setShowAddCert(cat.id);setCertForm({name:"",issuer:"",date:"",expiry:"",score:"",note:"",color:CERT_COLORS[0]});}}>자격증</Btn>
                <button onClick={()=>setConfirmDelete({type:"cat",catId:cat.id})} style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.danger,display:"flex" }}><Trash2 size={12}/></button>
              </div>
              {!collapsed&&(<div style={{ padding:16 }}>
                {(cat.certs||[]).length===0?(<div style={{ fontSize:12,color:C.text3,padding:"8px 4px" }}>자격증을 추가하세요.</div>):(
                  <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12 }}>
                    {(cat.certs||[]).map((cert,certIdx)=>{
                      const status=expiryStatus(cert.expiry);
                      return (
                        <div key={cert.id}
                          draggable
                          onDragStart={()=>onCertDragStart(cat.id,certIdx)}
                          onDragOver={e=>onCertDragOver(e,cat.id,certIdx)}
                          onDrop={e=>onCertDrop(e,cat.id,certIdx)}
                          onDragEnd={()=>onCertDragEnd(cat.id)}
                          style={{ borderRadius:14,overflow:"hidden",background:cert.color,border:`1px solid ${cert.color}88`, opacity:certDragState[cat.id]===certIdx?0.5:1, outline:certDragState[cat.id]===certIdx?`2px dashed ${C.accent}`:"none", cursor:"grab" }}>
                          <div style={{ padding:16 }}>
                            <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:12 }}>
                              <div style={{ borderRadius:10,padding:8,background:"rgba(255,255,255,0.12)" }}><Award size={16} color="rgba(255,255,255,0.9)"/></div>
                              <div style={{ display:"flex",gap:4 }}>
                                <button onClick={()=>openUpload(cat.id,cert.id)} disabled={uploadingCert===cert.id} title="파일 첨부" style={{ background:"rgba(255,255,255,0.15)",border:"none",cursor:"pointer",padding:5,borderRadius:7,display:"flex",color:"rgba(255,255,255,0.8)" }}>{uploadingCert===cert.id?<Loader2 size={11} style={{ animation:"spin 1s linear infinite" }}/>:<Upload size={11}/>}</button>
                                <button onClick={()=>{setEditCertTarget({catId:cat.id,certId:cert.id});setCertForm({name:cert.name,issuer:cert.issuer||"",date:cert.date||"",expiry:cert.expiry||"",score:cert.score||"",note:cert.note||"",color:cert.color});}} title="수정" style={{ background:"rgba(255,255,255,0.15)",border:"none",cursor:"pointer",padding:5,borderRadius:7,display:"flex",color:"rgba(255,255,255,0.8)" }}><Edit2 size={11}/></button>
                                <button onClick={()=>setConfirmDelete({type:"cert",catId:cat.id,certId:cert.id})} title="삭제" style={{ background:"rgba(255,255,255,0.15)",border:"none",cursor:"pointer",padding:5,borderRadius:7,display:"flex",color:"rgba(255,255,255,0.8)" }}><Trash2 size={11}/></button>
                              </div>
                            </div>
                            <h3 style={{ fontSize:14,fontWeight:700,color:"rgba(255,255,255,0.95)",marginBottom:2 }}>{cert.name}</h3>
                            {cert.issuer&&<p style={{ fontSize:11,color:"rgba(255,255,255,0.55)" }}>{cert.issuer}</p>}
                            {cert.score&&<div style={{ marginTop:8,display:"inline-block",fontSize:12,fontWeight:700,padding:"3px 10px",borderRadius:99,background:"rgba(255,255,255,0.15)",color:"rgba(255,255,255,0.9)" }}>{cert.score}</div>}
                          </div>
                          <div style={{ padding:"8px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(0,0,0,0.2)",borderTop:"1px solid rgba(255,255,255,0.08)" }}>
                            <span style={{ fontSize:10,color:"rgba(255,255,255,0.5)" }}>{cert.date?formatDate(cert.date):"날짜 미입력"}</span>
                            {status&&<span style={{ fontSize:10,fontWeight:500,padding:"2px 7px",borderRadius:99,background:status.color+"25",color:status.color }}>{status.text}</span>}
                          </div>
                          {(cert.files||[]).length>0&&(<div style={{ background:"rgba(0,0,0,0.15)",borderTop:"1px solid rgba(255,255,255,0.06)" }}>{(cert.files||[]).map(file=>(<CertFileRow key={file.id} file={file} catId={cat.id} certId={cert.id} onView={()=>{ addRecentFile(file, cat.name, cat.color); setViewingFile({...file,_catId:cat.id,_certId:cert.id}); }} onDelete={()=>setConfirmDelete({type:"file",catId:cat.id,certId:cert.id,file})} deleting={deletingFile===file.id}/>))}</div>)}
                          {cert.note&&<div style={{ padding:"6px 16px",fontSize:10,color:"rgba(255,255,255,0.35)",background:"rgba(0,0,0,0.15)" }}>{cert.note}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>)}
            </div>
          );
        })}
      </div>
      {showAddCat&&(<Modal title="카테고리 추가" onClose={()=>setShowAddCat(false)}><div style={{ ...S.col,gap:16 }}><Input label="카테고리 이름" value={newCat.name} onChange={e=>setNewCat(p=>({...p,name:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addCategory()} placeholder="어학, IT, 국가자격증 ..."/><Field label="색상"><div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>{SEC_COLORS.map(c=>(<button key={c} onClick={()=>setNewCat(p=>({...p,color:c}))} style={{ width:28,height:28,borderRadius:"50%",background:c,border:newCat.color===c?"3px solid white":"3px solid transparent",cursor:"pointer",outline:"none",opacity:newCat.color===c?1:0.5 }}/>))}</div></Field><div style={{ display:"flex",gap:8,justifyContent:"flex-end" }}><Btn variant="ghost" onClick={()=>setShowAddCat(false)}>취소</Btn><Btn onClick={addCategory}>추가</Btn></div></div></Modal>)}
      {showAddCert&&(<Modal title="자격증 추가" onClose={()=>setShowAddCert(null)}><div style={{ ...S.col,gap:12 }}><Input label="자격증명 *" value={certForm.name} onChange={cf("name")} placeholder="TOEIC, OPIc ..."/><div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}><Input label="발급 기관" value={certForm.issuer} onChange={cf("issuer")} placeholder="ETS ..."/><Input label="점수/등급" value={certForm.score} onChange={cf("score")} placeholder="900, IM2 ..."/></div><div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}><Input label="취득일" type="date" value={certForm.date} onChange={cf("date")}/><Input label="만료일" type="date" value={certForm.expiry} onChange={cf("expiry")}/></div><Textarea label="메모" value={certForm.note} onChange={cf("note")} placeholder="갱신 요건 ..."/><Field label="카드 색상"><div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>{CERT_COLORS.map(c=>(<button key={c} onClick={()=>setCertForm(p=>({...p,color:c}))} style={{ width:28,height:28,borderRadius:"50%",background:c,border:certForm.color===c?"3px solid white":"3px solid transparent",cursor:"pointer",outline:"none" }}/>))}</div></Field><div style={{ display:"flex",gap:8,justifyContent:"flex-end",marginTop:4 }}><Btn variant="ghost" onClick={()=>setShowAddCert(null)}>취소</Btn><Btn onClick={()=>addCert(showAddCert)}>추가</Btn></div></div></Modal>)}
      {confirmDelete&&(<Modal title="삭제 확인" onClose={()=>setConfirmDelete(null)}><p style={{ fontSize:13,color:C.text2,marginBottom:20 }}>{confirmDelete.type==="cat"?"이 카테고리와 포함된 모든 자격증을 삭제하시겠습니까?":confirmDelete.type==="cert"?"이 자격증을 삭제하시겠습니까?":`"${confirmDelete.file?.name}" 파일을 삭제하시겠습니까?`}</p><div style={{ display:"flex",gap:8,justifyContent:"flex-end" }}><Btn variant="ghost" onClick={()=>setConfirmDelete(null)}>취소</Btn><Btn variant="danger" onClick={()=>{if(confirmDelete.type==="cat")deleteCategory(confirmDelete.catId);else if(confirmDelete.type==="cert")deleteCert(confirmDelete.catId,confirmDelete.certId);else handleDeleteFile(confirmDelete.catId,confirmDelete.certId,confirmDelete.file);}}>삭제</Btn></div></Modal>)}
      {editCertTarget&&(<Modal title="자격증 수정" onClose={()=>setEditCertTarget(null)}><div style={{ ...S.col,gap:12 }}><Input label="자격증명 *" value={certForm.name} onChange={cf("name")} placeholder="TOEIC, OPIc ..."/><div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}><Input label="발급 기관" value={certForm.issuer} onChange={cf("issuer")} placeholder="ETS ..."/><Input label="점수/등급" value={certForm.score} onChange={cf("score")} placeholder="900, IM2 ..."/></div><div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}><Input label="취득일" type="date" value={certForm.date} onChange={cf("date")}/><Input label="만료일" type="date" value={certForm.expiry} onChange={cf("expiry")}/></div><Textarea label="메모" value={certForm.note} onChange={cf("note")} placeholder="갱신 요건 ..."/><Field label="카드 색상"><div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>{CERT_COLORS.map(c=>(<button key={c} onClick={()=>setCertForm(p=>({...p,color:c}))} style={{ width:28,height:28,borderRadius:"50%",background:c,border:certForm.color===c?"3px solid white":"3px solid transparent",cursor:"pointer",outline:"none" }}/>))}</div></Field><div style={{ display:"flex",gap:8,justifyContent:"flex-end",marginTop:4 }}><Btn variant="ghost" onClick={()=>setEditCertTarget(null)}>취소</Btn><Btn icon={Check} onClick={()=>updateCert(editCertTarget.catId,editCertTarget.certId)}>저장</Btn></div></div></Modal>)}
    </div>
  );
}

// ─── SCHEDULER ─────────────────────────────────────────────
function Scheduler({ events, onChange, calendarId, setCalendarId }) {
  const [view, setView] = useState("month");
  const [cursor, setCursor] = useState(new Date());
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title:"",date:today(),type:"exam",note:"",isDday:true,syncCal:true,hasTime:false,startTime:"09:00",endTime:"10:00" });
  const [addingCal, setAddingCal] = useState(false);
  const [removingCal, setRemovingCal] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [importing, setImporting] = useState(false);
  const [confirmEvent, setConfirmEvent] = useState(null);
  const [editingEventId, setEditingEventId] = useState(null);
  const fld = k=>e=>setForm(p=>({...p,[k]:e.target.value}));
  const importingRef = useRef(false);

  async function syncFromGoogle() {
    if (importingRef.current) return;
    importingRef.current = true; setImporting(true);
    try {
      let calId = calendarId;
      if (!calId) { calId = await getOrCreateCareerCalendar(); setCalendarId(calId); }
      const { newEvents, updatedEvents, deletedLocalIds } = await fetchGoogleCalendarEvents(calId, events);
      if (newEvents.length || updatedEvents.length || deletedLocalIds.length) {
        let next = events.filter(e => !deletedLocalIds.includes(e.id));
        next = next.map(e => { const u = updatedEvents.find(x => x.id === e.id); return u ? { ...e, ...u } : e; });
        next = [...next, ...newEvents];
        onChange(next);
        const parts = [newEvents.length>0&&`추가 ${newEvents.length}건`, updatedEvents.length>0&&`수정 ${updatedEvents.length}건`, deletedLocalIds.length>0&&`삭제 ${deletedLocalIds.length}건`].filter(Boolean);
        addToast("info", `Google 캘린더 동기화 (${parts.join(", ")})`);
      }
    } catch(e) { console.error(e); }
    finally { importingRef.current = false; setImporting(false); }
  }

  useEffect(() => {
    syncFromGoogle();
    const interval = setInterval(syncFromGoogle, 60000);
    function onFocus() { syncFromGoogle(); }
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openAdd(date=today()){ setEditingEventId(null); setForm({ title:"",date,type:"exam",note:"",isDday:true,syncCal:true,hasTime:false,startTime:"09:00",endTime:"10:00" }); setShowAdd(true); }
  function openEdit(ev){ setEditingEventId(ev.id); setForm({ title:ev.title,date:ev.date,type:ev.type,note:ev.note||"",isDday:ev.isDday,syncCal:false,hasTime:ev.hasTime||false,startTime:ev.startTime||"09:00",endTime:ev.endTime||"10:00" }); setShowAdd(true); }

  async function addEvent() {
    if (!form.title.trim()||!form.date) return;
    if (editingEventId) {
      const existingEv = events.find(e => e.id === editingEventId);
      if (existingEv?.googleEventId && calendarId) {
        setAddingCal(true);
        try { await updateGoogleCalendarEvent(existingEv.googleEventId, calendarId, { ...existingEv, ...form }); }
        catch(e) { console.error(e); }
        finally { setAddingCal(false); }
      }
      onChange(events.map(e=>e.id!==editingEventId?e:{...e,title:form.title,date:form.date,type:form.type,note:form.note,isDday:form.isDday,hasTime:form.hasTime,startTime:form.hasTime?form.startTime:null,endTime:form.hasTime?form.endTime:null}));
      setEditingEventId(null); setShowAdd(false); setForm({ title:"",date:today(),type:"exam",note:"",isDday:true,syncCal:true,hasTime:false,startTime:"09:00",endTime:"10:00" });
      addToast("success","일정이 수정되었습니다.");
      return;
    }
    setAddingCal(true);
    let googleEventId = null, calId = calendarId;
    try {
      if (form.syncCal) {
        if (!calId) { calId = await getOrCreateCareerCalendar(); setCalendarId(calId); }
        googleEventId = await addToGoogleCalendar({ ...form }, calId);
      }
    } catch(e) { console.error(e); } finally { setAddingCal(false); }
    onChange([...events,{ ...form, id:uid(), isDday:form.isDday, googleEventId, syncedToCalendar: !!googleEventId, hasTime:form.hasTime, startTime:form.hasTime?form.startTime:null, endTime:form.hasTime?form.endTime:null }]);
    setForm({ title:"",date:today(),type:"exam",note:"",isDday:true,syncCal:true,hasTime:false,startTime:"09:00",endTime:"10:00" });
    setShowAdd(false);
  }

  async function deleteEvent(id) {
    const ev = events.find(e=>e.id===id);
    if (ev?.googleEventId && calendarId) {
      setRemovingCal(id);
      try { await removeFromGoogleCalendar(ev.googleEventId, calendarId); } catch(e) { console.error(e); }
      finally { setRemovingCal(null); }
    }
    onChange(events.filter(e=>e.id!==id));
    if (selectedEvent?.id===id) setSelectedEvent(null);
  }

  async function syncEventToCalendar(ev) {
    if (ev.googleEventId) return;
    setRemovingCal(ev.id);
    try {
      let calId = calendarId;
      if (!calId) { calId = await getOrCreateCareerCalendar(); setCalendarId(calId); }
      const googleEventId = await addToGoogleCalendar(ev, calId);
      onChange(events.map(e=>e.id!==ev.id?e:{...e,googleEventId,syncedToCalendar:true}));
    } catch(e) { console.error(e); addToast("error","Google 캘린더 동기화 실패"); }
    finally { setRemovingCal(null); }
  }

  function getMonthGrid(d){const y=d.getFullYear(),m=d.getMonth(),first=new Date(y,m,1),last=new Date(y,m+1,0),cells=[];for(let i=0;i<first.getDay();i++)cells.push(null);for(let n=1;n<=last.getDate();n++)cells.push(new Date(y,m,n));while(cells.length%7!==0)cells.push(null);return cells;}
  function eventsOn(d){if(!d)return[];const ds=d.toLocaleDateString("sv-SE");return events.filter(e=>e.date===ds);}
  function getWeekDates(d){const b=new Date(d);b.setDate(d.getDate()-d.getDay());return Array.from({length:7},(_,i)=>{const x=new Date(b);x.setDate(b.getDate()+i);return x;});}

  const todayStr=today(), monthGrid=getMonthGrid(cursor), weekDates=getWeekDates(cursor);

  return (
    <div>
      <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:32 }}>
        <div>
          <div style={{ display:"flex",alignItems:"center",gap:8 }}>
            <h2 style={{ fontSize:20,fontWeight:700,color:C.text1,fontFamily:"Georgia,serif" }}>학습 스케줄러</h2>
            {importing&&<RefreshCw size={13} color={C.text3} style={{ animation:"spin 1s linear infinite",flexShrink:0 }}/>}
          </div>
          <p style={{ fontSize:13,color:C.text2,marginTop:4 }}>시험 일정 및 D-Day 관리 · Google 캘린더 자동 동기화</p>
        </div>
        <div style={{ display:"flex",gap:8 }}>
          <div style={{ display:"flex",borderRadius:10,overflow:"hidden",border:`1px solid ${C.border2}` }}>{["month","week"].map(v=>(<button key={v} onClick={()=>setView(v)} style={{ padding:"7px 14px",fontSize:12,fontWeight:500,background:v===view?C.accent:"transparent",color:v===view?"white":C.text2,border:"none",cursor:"pointer",fontFamily:"inherit" }}>{v==="month"?"월간":"주간"}</button>))}</div>
          <Btn icon={Plus} onClick={()=>openAdd()}>일정 추가</Btn>
        </div>
      </div>

      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
        <button onClick={()=>view==="month"?setCursor(p=>new Date(p.getFullYear(),p.getMonth()-1,1)):setCursor(p=>{const d=new Date(p);d.setDate(d.getDate()-7);return d;})} style={{ background:"transparent",border:"none",cursor:"pointer",padding:6,color:C.text2,display:"flex",borderRadius:8 }}><ChevronLeft size={15}/></button>
        <span style={{ fontSize:14,fontWeight:600,color:C.text1 }}>{view==="month"?cursor.toLocaleDateString("ko-KR",{year:"numeric",month:"long"}):`${weekDates[0].toLocaleDateString("ko-KR",{month:"short",day:"numeric"})} – ${weekDates[6].toLocaleDateString("ko-KR",{month:"short",day:"numeric"})}`}</span>
        <button onClick={()=>view==="month"?setCursor(p=>new Date(p.getFullYear(),p.getMonth()+1,1)):setCursor(p=>{const d=new Date(p);d.setDate(d.getDate()+7);return d;})} style={{ background:"transparent",border:"none",cursor:"pointer",padding:6,color:C.text2,display:"flex",borderRadius:8 }}><ChevronRight size={15}/></button>
      </div>

      {view==="month"&&(
        <div style={{ ...S.card,overflow:"hidden",marginBottom:24 }}>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)" }}>
            {WEEKDAYS.map((d,i)=>(<div key={d} style={{ padding:"10px 0",textAlign:"center",fontSize:11,fontWeight:600,color:i===0?C.danger:i===6?C.accent:C.text3,background:C.surface,borderBottom:`1px solid ${C.border}` }}>{d}</div>))}
            {monthGrid.map((day,i)=>{
              const evs=eventsOn(day),ds=day?.toLocaleDateString("sv-SE"),isToday=ds===todayStr,isWeekend=day&&(day.getDay()===0||day.getDay()===6);
              return (
                <div key={i} onClick={()=>day&&openAdd(ds)} style={{ minHeight:80,padding:6,cursor:day?"pointer":"default",background:day?"transparent":C.surface2,borderRight:(i+1)%7!==0?`1px solid ${C.border}`:"none",borderBottom:i<monthGrid.length-7?`1px solid ${C.border}`:"none" }}>
                  {day&&(<>
                    <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:2 }}>
                      <span style={{ fontSize:11,width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:"50%",fontWeight:500,background:isToday?C.accent:"transparent",color:isToday?"white":isWeekend?(day.getDay()===0?C.danger:C.accent):C.text2 }}>{day.getDate()}</span>
                    </div>
                    <div style={{ display:"flex",flexDirection:"column",gap:2 }}>
                      {evs.slice(0,2).map(e=>(<div key={e.id} onClick={ev=>{ev.stopPropagation();setSelectedEvent(e);}} style={{ fontSize:10,borderRadius:4,padding:"1px 4px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",background:EVENT_TYPES[e.type]?.color+"22",color:EVENT_TYPES[e.type]?.color,cursor:"pointer",display:"flex",alignItems:"center",gap:3 }}>{e.isDday&&"★ "}<span style={{ flex:1,overflow:"hidden",textOverflow:"ellipsis" }}>{e.title}</span>{e.syncedToCalendar&&<CalendarCheck size={8} style={{ flexShrink:0,opacity:0.7 }}/>}</div>))}
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
              const ds=day.toLocaleDateString("sv-SE"),isToday=ds===todayStr,evs=eventsOn(day);
              return (
                <div key={i} style={{ borderRight:i<6?`1px solid ${C.border}`:"none" }}>
                  <div onClick={()=>openAdd(ds)} style={{ padding:"10px 0",textAlign:"center",cursor:"pointer",background:C.surface,borderBottom:`1px solid ${C.border}` }}>
                    <div style={{ fontSize:11,color:i===0?C.danger:i===6?C.accent:C.text3,marginBottom:4 }}>{WEEKDAYS[i]}</div>
                    <div style={{ fontSize:16,fontWeight:700,width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:"50%",margin:"0 auto",background:isToday?C.accent:"transparent",color:isToday?"white":C.text1 }}>{day.getDate()}</div>
                  </div>
                  <div style={{ padding:4,minHeight:120,display:"flex",flexDirection:"column",gap:4 }}>
                    {evs.map(e=>(<div key={e.id} onClick={()=>setSelectedEvent(e)} style={{ fontSize:11,borderRadius:6,padding:"4px 6px",background:EVENT_TYPES[e.type]?.color+"22",color:EVENT_TYPES[e.type]?.color,cursor:"pointer",fontWeight:500,display:"flex",alignItems:"center",gap:4 }}>{e.isDday&&"★ "}<span style={{ flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{e.title}</span>{e.syncedToCalendar&&<CalendarCheck size={9} style={{ flexShrink:0,opacity:0.7 }}/>}</div>))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        {(()=>{const upcoming=[...events].filter(e=>diffDays(e.date)>=0).sort((a,b)=>new Date(a.date)-new Date(b.date));return(
        <><h3 style={{ fontSize:13,fontWeight:600,color:C.text1,marginBottom:12 }}>전체 일정 <span style={{ color:C.text3 }}>({upcoming.length})</span></h3>
        {upcoming.length===0?<p style={{ fontSize:13,color:C.text2 }}>예정된 일정이 없습니다.</p>:(
          <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
            {upcoming.map(e=>{
              const diff=diffDays(e.date);
              return (
                <div key={e.id} style={{ display:"flex",alignItems:"center",gap:10,padding:"12px 16px",...S.card }}>
                  <div style={{ width:8,height:8,borderRadius:"50%",background:EVENT_TYPES[e.type]?.color,flexShrink:0 }}/>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:13,fontWeight:500,color:C.text1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{e.isDday&&<span style={{ color:C.accent,marginRight:4 }}>★</span>}{e.title}</div>
                    <div style={{ display:"flex",alignItems:"center",gap:6,marginTop:2 }}>
                      {e.note&&<span style={{ fontSize:11,color:C.text3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{e.note}</span>}
                      {e.importedFromCalendar&&<span style={{ fontSize:9,fontWeight:600,padding:"1px 5px",borderRadius:99,background:`${C.accent}20`,color:C.accent,flexShrink:0,whiteSpace:"nowrap" }}>Google 가져옴</span>}
                    </div>
                  </div>
                  <span style={{ fontSize:11,color:C.text3,flexShrink:0 }}>{formatDate(e.date)}{e.hasTime&&e.startTime?` ${formatEventTime(e)}`:""}</span>
                  {e.isDday&&diff>=0&&<span style={{ fontSize:11,fontWeight:700,flexShrink:0,padding:"2px 8px",borderRadius:99,background:diff===0?C.danger+"20":C.accent+"18",color:diff===0?C.danger:C.accent }}>{dDayLabel(diff)}</span>}
                  {e.syncedToCalendar?(
                    <div title="Google 캘린더에 동기화됨" style={{ display:"flex",padding:4,color:C.success,flexShrink:0 }}><CalendarCheck size={13}/></div>
                  ):(
                    <button onClick={()=>syncEventToCalendar(e)} disabled={removingCal===e.id} title="Google 캘린더에 추가" style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.text3,display:"flex",flexShrink:0 }}>{removingCal===e.id?<Loader2 size={13} style={{ animation:"spin 1s linear infinite" }}/>:<CalendarPlus size={13}/>}</button>
                  )}
                  <button onClick={()=>setConfirmEvent(e)} disabled={removingCal===e.id} title="삭제" style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.danger,display:"flex",flexShrink:0 }}>{removingCal===e.id?<Loader2 size={13} style={{ animation:"spin 1s linear infinite" }}/>:<Trash2 size={13}/>}</button>
                </div>
              );
            })}
          </div>
        )}
        </>);})()}
      </div>

      {selectedEvent&&(
        <Modal title={selectedEvent.title} onClose={()=>setSelectedEvent(null)}>
          <div style={{ ...S.col,gap:12 }}>
            <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
              <div style={{ fontSize:11,padding:"3px 10px",borderRadius:99,background:EVENT_TYPES[selectedEvent.type]?.color+"22",color:EVENT_TYPES[selectedEvent.type]?.color }}>{EVENT_TYPES[selectedEvent.type]?.label}</div>
              {selectedEvent.isDday&&diffDays(selectedEvent.date)>=0&&<div style={{ fontSize:11,padding:"3px 10px",borderRadius:99,background:diffDays(selectedEvent.date)===0?C.danger+"18":C.accent+"18",color:diffDays(selectedEvent.date)===0?C.danger:C.accent }}>D-Day {dDayLabel(diffDays(selectedEvent.date))}</div>}
              {selectedEvent.syncedToCalendar&&<div style={{ fontSize:11,padding:"3px 10px",borderRadius:99,background:C.success+"18",color:C.success,display:"flex",alignItems:"center",gap:4 }}><CalendarCheck size={10}/>Google 캘린더 연동됨</div>}
            </div>
            <div style={{ fontSize:13,color:C.text2 }}>{formatDate(selectedEvent.date)}{selectedEvent.hasTime&&selectedEvent.startTime?` · ${formatEventTime(selectedEvent)}`:""}</div>
            {selectedEvent.note&&<div style={{ fontSize:13,color:C.text2,padding:12,background:C.surface3,borderRadius:8 }}>{selectedEvent.note}</div>}
            <div style={{ display:"flex",gap:8,justifyContent:"flex-end",marginTop:8 }}>
              {!selectedEvent.syncedToCalendar&&(
                <Btn variant="success" icon={CalendarPlus} loading={removingCal===selectedEvent.id} onClick={async()=>{ await syncEventToCalendar(selectedEvent); setSelectedEvent(null); }}>Google 캘린더에 추가</Btn>
              )}
              <Btn variant="ghost" icon={Edit2} onClick={()=>{const ev=selectedEvent;setSelectedEvent(null);openEdit(ev);}}>수정</Btn>
              <Btn variant="danger" icon={Trash2} onClick={()=>{setSelectedEvent(null);setConfirmEvent(selectedEvent);}}>삭제</Btn>
            </div>
          </div>
        </Modal>
      )}

      {showAdd&&(
        <Modal title={editingEventId?"일정 수정":"일정 추가"} onClose={()=>{setShowAdd(false);setEditingEventId(null);}}>
          <div style={{ ...S.col,gap:12 }}>
            <Input label="제목 *" value={form.title} onChange={fld("title")} onKeyDown={e=>e.key==="Enter"&&addEvent()} placeholder="TOEIC 시험 ..."/>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
              <Input label="날짜 *" type="date" value={form.date} onChange={fld("date")}/>
              <SelectInput label="유형" value={form.type} onChange={fld("type")}>{Object.entries(EVENT_TYPES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</SelectInput>
            </div>
            <label style={{ display:"flex",alignItems:"center",gap:10,cursor:"pointer" }}>
              <div style={{ position:"relative",width:40,height:22,flexShrink:0 }} onClick={()=>setForm(p=>({...p,hasTime:!p.hasTime}))}>
                <div style={{ position:"absolute",inset:0,borderRadius:99,background:form.hasTime?C.accent:C.surface3,transition:"background 0.2s" }}/>
                <div style={{ position:"absolute",top:2,left:form.hasTime?20:2,width:18,height:18,borderRadius:"50%",background:"white",transition:"left 0.2s" }}/>
              </div>
              <span style={{ fontSize:13,color:C.text2 }}>시간 설정</span>
            </label>
            {form.hasTime&&(
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                <Input label="시작 시간" type="time" value={form.startTime} onChange={fld("startTime")}/>
                <Input label="종료 시간" type="time" value={form.endTime} onChange={fld("endTime")}/>
              </div>
            )}
            <Textarea label="메모" value={form.note} onChange={fld("note")} placeholder="장소, 준비물 등 ..."/>
            <label style={{ display:"flex",alignItems:"center",gap:10,cursor:"pointer" }}>
              <div style={{ position:"relative",width:40,height:22,flexShrink:0 }} onClick={()=>setForm(p=>({...p,isDday:!p.isDday}))}>
                <div style={{ position:"absolute",inset:0,borderRadius:99,background:form.isDday?C.accent:C.surface3,transition:"background 0.2s" }}/>
                <div style={{ position:"absolute",top:2,left:form.isDday?20:2,width:18,height:18,borderRadius:"50%",background:"white",transition:"left 0.2s" }}/>
              </div>
              <span style={{ fontSize:13,color:C.text2 }}>D-Day 카운트다운 표시</span>
            </label>
            <label style={{ display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:10,borderRadius:10,background:C.surface3 }}>
              <div style={{ position:"relative",width:40,height:22,flexShrink:0 }} onClick={()=>setForm(p=>({...p,syncCal:!p.syncCal}))}>
                <div style={{ position:"absolute",inset:0,borderRadius:99,background:form.syncCal?"#34d399":C.surface2,transition:"background 0.2s" }}/>
                <div style={{ position:"absolute",top:2,left:form.syncCal?20:2,width:18,height:18,borderRadius:"50%",background:"white",transition:"left 0.2s" }}/>
              </div>
              <div>
                <div style={{ fontSize:13,color:C.text1,display:"flex",alignItems:"center",gap:6 }}><CalendarPlus size={13} color="#34d399"/>Google 캘린더에 추가</div>
                <div style={{ fontSize:11,color:C.text3,marginTop:2 }}>캐릿 캘린더에 자동 등록</div>
              </div>
            </label>
            <div style={{ display:"flex",gap:8,justifyContent:"flex-end",marginTop:4 }}>
              <Btn variant="ghost" onClick={()=>{setShowAdd(false);setEditingEventId(null);}}>취소</Btn>
              <Btn onClick={addEvent} loading={addingCal}>{editingEventId?"저장":addingCal?"Google 캘린더 동기화 중...":"추가"}</Btn>
            </div>
          </div>
        </Modal>
      )}
      {confirmEvent&&(<Modal title="일정 삭제" onClose={()=>setConfirmEvent(null)}><p style={{ fontSize:13,color:C.text2,marginBottom:20 }}>"{confirmEvent.title}" 일정을 삭제하시겠습니까?{confirmEvent.syncedToCalendar&&<span style={{ display:"block",marginTop:6,fontSize:12,color:C.warning }}>Google 캘린더에서도 함께 삭제됩니다.</span>}</p><div style={{ display:"flex",gap:8,justifyContent:"flex-end" }}><Btn variant="ghost" onClick={()=>setConfirmEvent(null)}>취소</Btn><Btn variant="danger" loading={removingCal===confirmEvent.id} onClick={async()=>{await deleteEvent(confirmEvent.id);setConfirmEvent(null);}}>삭제</Btn></div></Modal>)}
    </div>
  );
}

// ─── SEARCH RESULTS ────────────────────────────────────────
function SearchResults({ query, library, certCategories, events, setPage, clearSearch }) {
  const q = query.toLowerCase();

  const fileResults = useMemo(() => {
    const res = [];
    function searchNode(files, folders, section, path) {
      (files||[]).forEach(f => { if (f.name.toLowerCase().includes(q)) res.push({ ...f, _section:section.subject, _color:section.color, _path:path }); });
      (folders||[]).forEach(folder => searchNode(folder.files, folder.folders, section, path + " › " + folder.name));
    }
    library.forEach(s => searchNode(s.files, s.folders, s, s.subject));
    return res;
  }, [query, library]); // eslint-disable-line react-hooks/exhaustive-deps

  const certResults = useMemo(() => {
    const res = [];
    certCategories.forEach(cat => (cat.certs||[]).forEach(cert => {
      if ([cert.name, cert.issuer, cert.score, cert.note].some(v => v?.toLowerCase().includes(q)))
        res.push({ ...cert, _catName:cat.name, _catColor:cat.color });
    }));
    return res;
  }, [query, certCategories]); // eslint-disable-line react-hooks/exhaustive-deps

  const eventResults = useMemo(() =>
    events.filter(e => [e.title, e.note].some(v => v?.toLowerCase().includes(q))),
    [query, events] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const total = fileResults.length + certResults.length + eventResults.length;

  function highlight(text) {
    if (!text) return text;
    const idx = text.toLowerCase().indexOf(q);
    if (idx < 0) return text;
    return <>{text.slice(0, idx)}<mark style={{ background:C.accent+"40", color:C.text1, borderRadius:2, padding:"0 2px" }}>{text.slice(idx, idx+q.length)}</mark>{text.slice(idx+q.length)}</>;
  }

  const Row = ({ icon:Icon, color, primary, secondary, badge, onGo }) => (
    <div style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderBottom:`1px solid ${C.border}` }}>
      <div style={{ borderRadius:7,padding:5,background:color+"22",flexShrink:0 }}><Icon size={11} color={color}/></div>
      <div style={{ flex:1,minWidth:0 }}>
        <div style={{ fontSize:12,color:C.text1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{primary}</div>
        {secondary&&<div style={{ fontSize:10,color:C.text3,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{secondary}</div>}
      </div>
      {badge&&<span style={{ fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:99,background:badge.bg,color:badge.color,flexShrink:0 }}>{badge.text}</span>}
      <button onClick={onGo} style={{ fontSize:11,color:C.accent,background:"transparent",border:`1px solid ${C.accent}30`,cursor:"pointer",padding:"3px 10px",borderRadius:8,flexShrink:0 }}>이동</button>
    </div>
  );

  return (
    <div>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24 }}>
        <div>
          <h2 style={{ fontSize:20,fontWeight:700,color:C.text1,fontFamily:"Georgia,serif" }}>검색 결과</h2>
          <p style={{ fontSize:13,color:C.text2,marginTop:4 }}>"{query}" — {total}건</p>
        </div>
        <button onClick={clearSearch} style={{ display:"flex",alignItems:"center",gap:6,padding:"7px 14px",borderRadius:10,background:"transparent",border:`1px solid ${C.border2}`,color:C.text2,fontSize:12,cursor:"pointer",fontFamily:"inherit" }}><X size={12}/>검색 닫기</button>
      </div>
      {total === 0 && <EmptyState icon={Search} title="검색 결과가 없습니다" sub={`"${query}"에 해당하는 항목이 없습니다`}/>}
      {fileResults.length > 0 && (
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:11,fontWeight:600,color:C.text3,marginBottom:8,display:"flex",alignItems:"center",gap:5,letterSpacing:"0.05em" }}><FileText size={11}/>학습 자료 {fileResults.length}건</div>
          <div style={{ ...S.card,overflow:"hidden" }}>
            {fileResults.map(f => <Row key={f.id} icon={FileText} color={f._color} primary={highlight(f.name)} secondary={f._path} onGo={()=>{setPage("library");clearSearch();}}/>)}
          </div>
        </div>
      )}
      {certResults.length > 0 && (
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:11,fontWeight:600,color:C.text3,marginBottom:8,display:"flex",alignItems:"center",gap:5,letterSpacing:"0.05em" }}><Award size={11}/>자격증 {certResults.length}건</div>
          <div style={{ ...S.card,overflow:"hidden" }}>
            {certResults.map(c => {
              const d = c.expiry ? diffDays(c.expiry) : null;
              const badge = d !== null ? (d < 0 ? {text:"만료됨",bg:C.danger+"22",color:C.danger} : d < 90 ? {text:`D-${d}`,bg:C.warning+"22",color:C.warning} : {text:"유효",bg:C.success+"22",color:C.success}) : null;
              return <Row key={c.id} icon={Award} color={c._catColor} primary={highlight(c.name)} secondary={[c._catName, c.issuer].filter(Boolean).join(" · ")} badge={badge} onGo={()=>{setPage("certs");clearSearch();}}/>;
            })}
          </div>
        </div>
      )}
      {eventResults.length > 0 && (
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:11,fontWeight:600,color:C.text3,marginBottom:8,display:"flex",alignItems:"center",gap:5,letterSpacing:"0.05em" }}><Calendar size={11}/>일정 {eventResults.length}건</div>
          <div style={{ ...S.card,overflow:"hidden" }}>
            {eventResults.map(e => {
              const diff = diffDays(e.date);
              const badge = e.isDday&&diff>=0 ? {text:dDayLabel(diff),bg:(diff===0?C.danger:C.accent)+"22",color:diff===0?C.danger:C.accent} : null;
              return <Row key={e.id} icon={Calendar} color={EVENT_TYPES[e.type]?.color||C.accent} primary={highlight(e.title)} secondary={`${formatDate(e.date)} · ${EVENT_TYPES[e.type]?.label}`} badge={badge} onGo={()=>{setPage("scheduler");clearSearch();}}/>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── COVER LETTER ──────────────────────────────────────────
function CoverLetter({ folders, onChange }) {
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [newFolderForm, setNewFolderForm] = useState({ name:"", color:SEC_COLORS[0] });
  const [addQuestionTarget, setAddQuestionTarget] = useState(null);
  const [addQForm, setAddQForm] = useState({ question:"" });
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const [editingQ, setEditingQ] = useState(null); // { folderId, qId }
  const [editQForm, setEditQForm] = useState({ question:"" });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const folderDrag = useDragList(folders, onChange);
  const qDragRefs = useRef({});
  const [qDragState, setQDragState] = useState({});

  function addFolder() {
    if (!newFolderForm.name.trim()) return;
    onChange([...folders, { id:uid(), name:newFolderForm.name.trim(), color:newFolderForm.color, questions:[] }]);
    setNewFolderForm({ name:"", color:SEC_COLORS[0] }); setShowAddFolder(false);
  }
  function deleteFolder(id) { onChange(folders.filter(f => f.id !== id)); setConfirmDelete(null); }
  function addQuestion(folderId) {
    if (!addQForm.question.trim()) return;
    onChange(folders.map(f => f.id !== folderId ? f : { ...f, questions:[...(f.questions||[]),{ id:uid(), question:addQForm.question.trim(), answer:"" }] }));
    setAddQForm({ question:"" }); setAddQuestionTarget(null);
  }
  function updateAnswer(folderId, qId, answer) {
    onChange(folders.map(f => f.id !== folderId ? f : { ...f, questions:(f.questions||[]).map(q => q.id!==qId?q:{...q,answer}) }));
  }
  function deleteQuestion(folderId, qId) { onChange(folders.map(f => f.id!==folderId?f:{...f,questions:(f.questions||[]).filter(q=>q.id!==qId)})); setConfirmDelete(null); }
  function saveEditQ(folderId, qId) {
    if (!editQForm.question.trim()) return;
    onChange(folders.map(f => f.id!==folderId?f:{...f,questions:(f.questions||[]).map(q=>q.id!==qId?q:{...q,question:editQForm.question.trim()})}));
    setEditingQ(null);
  }
  function onQDragStart(fid,i){qDragRefs.current[fid]={dragIdx:i};}
  function onQDragOver(e,fid,i){e.preventDefault();setQDragState(p=>({...p,[fid]:i}));}
  function onQDrop(e,fid,i){e.preventDefault();const ref=qDragRefs.current[fid]||{};if(ref.dragIdx!=null&&ref.dragIdx!==i){onChange(folders.map(f=>f.id!==fid?f:{...f,questions:reorder(f.questions||[],ref.dragIdx,i)}));}qDragRefs.current[fid]={};setQDragState(p=>({...p,[fid]:null}));}
  function onQDragEnd(fid){qDragRefs.current[fid]={};setQDragState(p=>({...p,[fid]:null}));}

  return (
    <div>
      <PageHeader title="자기소개서" sub="나의 경험을 미리 언어화해두세요" action={<Btn icon={Plus} onClick={()=>setShowAddFolder(true)}>폴더 추가</Btn>}/>
      {folders.length===0&&<EmptyState icon={ScrollText} title="폴더가 없습니다" sub="'폴더 추가' 버튼으로 분류를 만들어보세요" action={<Btn icon={Plus} onClick={()=>setShowAddFolder(true)}>폴더 추가</Btn>}/>}
      <div style={{ display:"flex",flexDirection:"column",gap:20 }}>
        {folders.map((folder,folderIdx)=>{
          const collapsed=collapsedFolders[folder.id];
          return (
            <div key={folder.id}
              draggable
              onDragStart={()=>folderDrag.onDragStart(folderIdx)}
              onDragOver={e=>folderDrag.onDragOver(e,folderIdx)}
              onDrop={e=>folderDrag.onDrop(e,folderIdx)}
              onDragEnd={folderDrag.onDragEnd}
              style={{ ...S.card,overflow:"hidden",opacity:folderDrag.overIdx===folderIdx?0.6:1,outline:folderDrag.overIdx===folderIdx?`2px dashed ${C.accent}`:"none" }}>
              <div style={{ display:"flex",alignItems:"center",gap:10,padding:"14px 20px",borderBottom:`1px solid ${C.border}`,borderLeft:`3px solid ${folder.color}`,background:C.surface }}>
                <button onClick={()=>setCollapsedFolders(p=>({...p,[folder.id]:!p[folder.id]}))} style={{ background:"transparent",border:"none",cursor:"pointer",padding:2,color:C.text3,display:"flex" }}>{collapsed?<CR size={13}/>:<ChevronDown size={13}/>}</button>
                <div style={{ width:10,height:10,borderRadius:"50%",background:folder.color,flexShrink:0 }}/>
                <span style={{ flex:1,fontSize:14,fontWeight:600,color:C.text1 }}>{folder.name}</span>
                <span style={{ fontSize:11,color:C.text3 }}>{(folder.questions||[]).length}개</span>
                <Btn size="sm" icon={Plus} variant="ghost" style={{ background:folder.color+"18",color:folder.color,border:"none" }} onClick={()=>{setAddQuestionTarget(folder.id);setAddQForm({question:""});}}>질문</Btn>
                <button onClick={()=>setConfirmDelete({type:"folder",folderId:folder.id})} style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.danger,display:"flex" }}><Trash2 size={12}/></button>
              </div>
              {!collapsed&&(
                <div style={{ padding:16 }}>
                  {(folder.questions||[]).length===0?(
                    <div style={{ fontSize:12,color:C.text3,padding:"8px 4px" }}>질문을 추가하세요.</div>
                  ):(
                    <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
                      {(folder.questions||[]).map((q,qIdx)=>(
                        <div key={q.id}
                          draggable
                          onDragStart={()=>onQDragStart(folder.id,qIdx)}
                          onDragOver={e=>onQDragOver(e,folder.id,qIdx)}
                          onDrop={e=>onQDrop(e,folder.id,qIdx)}
                          onDragEnd={()=>onQDragEnd(folder.id)}
                          style={{ borderRadius:10,overflow:"hidden",border:`1px solid ${C.border2}`,background:C.surface2,opacity:qDragState[folder.id]===qIdx?0.5:1,outline:qDragState[folder.id]===qIdx?`2px dashed ${folder.color}`:"none" }}>
                          <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:C.surface }}>
                            {editingQ?.folderId===folder.id&&editingQ?.qId===q.id?(
                              <input autoFocus value={editQForm.question} onChange={e=>setEditQForm(p=>({...p,question:e.target.value}))}
                                onKeyDown={e=>{if(e.key==="Enter")saveEditQ(folder.id,q.id);if(e.key==="Escape")setEditingQ(null);}}
                                style={{ flex:1,background:"transparent",border:"none",borderBottom:`1px solid ${C.accent}`,color:C.text1,fontSize:13,fontWeight:600,outline:"none",fontFamily:"inherit",lineHeight:1.5 }}/>
                            ):(
                              <span style={{ fontSize:13,fontWeight:600,color:C.text1,flex:1,lineHeight:1.5 }}>{q.question}</span>
                            )}
                            <div style={{ display:"flex",gap:4,flexShrink:0,marginLeft:8 }}>
                              {editingQ?.folderId===folder.id&&editingQ?.qId===q.id?(
                                <button onClick={()=>saveEditQ(folder.id,q.id)} style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.success,display:"flex" }}><Check size={12}/></button>
                              ):(
                                <button onClick={()=>{setEditingQ({folderId:folder.id,qId:q.id});setEditQForm({question:q.question});}} style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.text3,display:"flex" }}><Edit2 size={12}/></button>
                              )}
                              <button onClick={()=>setConfirmDelete({type:"question",folderId:folder.id,qId:q.id})} style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.danger,display:"flex" }}><Trash2 size={12}/></button>
                            </div>
                          </div>
                          <div style={{ padding:12 }}>
                            <textarea value={q.answer||""} onChange={e=>updateAnswer(folder.id,q.id,e.target.value)} placeholder="답변을 입력하세요..." rows={5} style={{ ...S.input,resize:"vertical",lineHeight:1.7 }}/>
                            <div style={{ fontSize:11,color:C.text3,marginTop:5,textAlign:"right" }}>{(q.answer||"").length.toLocaleString()}자 (공백 포함)</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {showAddFolder&&(<Modal title="폴더 추가" onClose={()=>setShowAddFolder(false)}><div style={{ ...S.col,gap:16 }}><Input label="폴더 이름" value={newFolderForm.name} onChange={e=>setNewFolderForm(p=>({...p,name:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addFolder()} placeholder="성격/가치관, 직무 역량 등..."/><Field label="색상"><div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>{SEC_COLORS.map(c=>(<button key={c} onClick={()=>setNewFolderForm(p=>({...p,color:c}))} style={{ width:28,height:28,borderRadius:"50%",background:c,border:newFolderForm.color===c?"3px solid white":"3px solid transparent",cursor:"pointer",outline:"none",opacity:newFolderForm.color===c?1:0.5 }}/>))}</div></Field><div style={{ display:"flex",gap:8,justifyContent:"flex-end" }}><Btn variant="ghost" onClick={()=>setShowAddFolder(false)}>취소</Btn><Btn onClick={addFolder}>추가</Btn></div></div></Modal>)}
      {addQuestionTarget&&(<Modal title="질문 추가" onClose={()=>setAddQuestionTarget(null)}><div style={{ ...S.col,gap:16 }}><Textarea label="질문 *" value={addQForm.question} onChange={e=>setAddQForm(p=>({...p,question:e.target.value}))} placeholder="조직을 발전시킨 경험, 나의 성격 장단점 등..."/><div style={{ display:"flex",gap:8,justifyContent:"flex-end" }}><Btn variant="ghost" onClick={()=>setAddQuestionTarget(null)}>취소</Btn><Btn onClick={()=>addQuestion(addQuestionTarget)}>추가</Btn></div></div></Modal>)}
      {confirmDelete&&(<Modal title="삭제 확인" onClose={()=>setConfirmDelete(null)}><p style={{ fontSize:13,color:C.text2,marginBottom:20 }}>{confirmDelete.type==="folder"?"이 폴더와 포함된 모든 질문을 삭제하시겠습니까?":"이 질문을 삭제하시겠습니까?"}</p><div style={{ display:"flex",gap:8,justifyContent:"flex-end" }}><Btn variant="ghost" onClick={()=>setConfirmDelete(null)}>취소</Btn><Btn variant="danger" onClick={()=>{if(confirmDelete.type==="folder")deleteFolder(confirmDelete.folderId);else deleteQuestion(confirmDelete.folderId,confirmDelete.qId);}}>삭제</Btn></div></Modal>)}
    </div>
  );
}

// ─── SIDEBAR ───────────────────────────────────────────────
function Sidebar({ page, setPage, certCategories, events, syncStatus, onSignOut, userInfo, searchQuery, setSearchQuery }) {
  const totalCerts=certCategories.reduce((a,c)=>a+(c.certs||[]).length,0);
  const upcoming=events.filter(e=>e.isDday&&diffDays(e.date)>=0).length;
  const navItems=[
    {id:"dashboard",label:"대시보드",icon:LayoutDashboard},
    {id:"library",label:"강의 자료실",icon:BookOpen},
    {id:"certs",label:"자격증 보관함",icon:Award,badge:totalCerts},
    {id:"scheduler",label:"학습 스케줄러",icon:Calendar,badge:upcoming||null},
    {id:"cover",label:"자기소개서",icon:ScrollText},
  ];
  return (
    <nav style={{ width:220,minWidth:220,display:"flex",flexDirection:"column",height:"100%" }}>
      <div style={{ padding:"20px 20px 12px" }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <div style={{ borderRadius:12,padding:8,background:`${C.accent}18`,border:`1px solid ${C.accent}30` }}><GraduationCap size={16} color={C.accent}/></div>
          <div><div style={{ fontSize:14,fontWeight:700,color:C.text1,fontFamily:"Georgia,serif" }}>CareerKit</div><div style={{ display:"flex",alignItems:"center",gap:5,marginTop:2 }}><SyncDot status={syncStatus}/><span style={{ fontSize:10,color:C.text3 }}>{syncStatus==="synced"?"Drive 동기화됨":syncStatus==="syncing"?"저장 중...":"오류"}</span></div></div>
        </div>
      </div>
      <div style={{ padding:"0 12px 8px" }}>
        <div style={{ position:"relative" }}>
          <Search size={12} style={{ position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:C.text3,pointerEvents:"none" }}/>
          <input
            value={searchQuery}
            onChange={e=>setSearchQuery(e.target.value)}
            placeholder="검색..."
            style={{ ...S.input,paddingLeft:30,paddingRight:searchQuery?28:12,fontSize:12,height:34 }}
          />
          {searchQuery&&<button onClick={()=>setSearchQuery("")} style={{ position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",padding:2,color:C.text3,display:"flex" }}><X size={11}/></button>}
        </div>
      </div>
      <div style={{ flex:1,padding:"4px 12px",overflowY:"auto" }}>
        {navItems.map(item=>{const active=page===item.id&&!searchQuery;return(<button key={item.id} onClick={()=>{setPage(item.id);setSearchQuery("");}} style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:12,width:"100%",textAlign:"left",cursor:"pointer",fontFamily:"inherit",marginBottom:2,background:active?`${C.accent}18`:"transparent",color:active?C.accent:C.text2,border:active?`1px solid ${C.accent}30`:"1px solid transparent",transition:"all 0.15s" }}><item.icon size={15} style={{ flexShrink:0 }}/><span style={{ flex:1,fontSize:13,fontWeight:500 }}>{item.label}</span>{item.badge>0&&<span style={{ fontSize:10,fontWeight:700,padding:"1px 6px",borderRadius:99,background:active?C.accent:C.surface3,color:active?"white":C.text2 }}>{item.badge}</span>}</button>);})}
      </div>
      <div style={{ padding:"12px 16px",borderTop:`1px solid ${C.border}` }}>
        <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:10 }}>
          {userInfo?.picture?<img src={userInfo.picture} alt="" style={{ width:32,height:32,borderRadius:"50%",border:`2px solid ${C.border2}`,flexShrink:0 }}/>:<div style={{ width:32,height:32,borderRadius:"50%",background:C.surface3,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}><GraduationCap size={14} color={C.text2}/></div>}
          <div style={{ flex:1,minWidth:0 }}><div style={{ fontSize:12,fontWeight:600,color:C.text1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{userInfo?.name||"User"}</div><div style={{ fontSize:10,color:C.text3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{userInfo?.email||""}</div></div>
        </div>
        <button onClick={onSignOut} style={{ display:"flex",alignItems:"center",gap:6,width:"100%",padding:"7px 12px",borderRadius:10,background:"transparent",border:`1px solid ${C.border}`,color:C.text3,fontSize:12,cursor:"pointer",fontFamily:"inherit" }}><LogOut size={12}/>로그아웃</button>
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
  const [searchQuery, setSearchQuery] = useState("");
  const [quickViewFile, setQuickViewFile] = useState(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [calendarId, setCalendarId] = useState(()=>localStorage.getItem("career_cal_id")||null);

  const dataFileIdRef=useRef(null), driveFolderIdRef=useRef(null), tokenClientRef=useRef(null), saveTimerRef=useRef(null);

  useEffect(()=>{
    (async()=>{
      await Promise.all([initGapi(),initGis()]);
      tokenClientRef.current=window.google.accounts.oauth2.initTokenClient({ client_id:CLIENT_ID, scope:SCOPES, callback:handleTokenResponse });
      if (loadCachedToken()) { try { await bootstrapApp(); setAuthState("app"); } catch { clearToken(); setAuthState("login"); } }
      else setAuthState("login");
    })();
  },[]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleTokenResponse(resp){ if(resp.error){setLoginLoading(false);return;} saveToken(resp); await bootstrapApp(); setAuthState("app"); setLoginLoading(false); }
  async function bootstrapApp(){
    const uRes=await fetch("https://www.googleapis.com/oauth2/v3/userinfo",{headers:{Authorization:`Bearer ${getAccessToken()}`}});
    const u=await uRes.json(); setUserInfo({name:u.name,email:u.email,picture:u.picture});
    const existing=await findFile(DATA_FILE);
    if(existing){ dataFileIdRef.current=existing.id; const loaded=await readJsonFile(existing.id);
      const migrateCL = d => d.coverLetterFolders || (d.coverLetterQuestions?.length ? [{id:uid(),name:"기본",color:SEC_COLORS[0],questions:d.coverLetterQuestions}] : []);
      if(loaded.certs&&!loaded.certCategories){ setData({library:loaded.library||[],certCategories:[{id:uid(),name:"기타",color:SEC_COLORS[0],certs:loaded.certs.map(c=>({...c,files:c.files||[]}))}],events:loaded.events||[],coverLetterFolders:migrateCL(loaded)}); }
      else { setData({library:loaded.library||[],certCategories:loaded.certCategories||[],events:loaded.events||[],coverLetterFolders:migrateCL(loaded)}); }
    } else { dataFileIdRef.current=await createJsonFile(DATA_FILE,EMPTY_DATA); }
    const folder=await findFile(FOLDER_NAME,"drive");
    driveFolderIdRef.current=folder?folder.id:await getOrCreateDriveFolder();
  }
  function handleSignIn(){ setLoginLoading(true); tokenClientRef.current?.requestAccessToken({prompt:""}); }
  function handleSignOut(){ const t=window.gapi.client.getToken(); if(t)window.google.accounts.oauth2.revoke(t.access_token); clearToken(); setData(EMPTY_DATA); setUserInfo(null); dataFileIdRef.current=null; driveFolderIdRef.current=null; setAuthState("login"); }
  function scheduleSave(d){ if(!dataFileIdRef.current)return; setSyncStatus("syncing"); clearTimeout(saveTimerRef.current); saveTimerRef.current=setTimeout(async()=>{try{await updateJsonFile(dataFileIdRef.current,d);setSyncStatus("synced");}catch(e){console.error(e);setSyncStatus("error");}},1500); }

  const updateLibrary=useCallback(library=>{const d={...data,library};setData(d);scheduleSave(d);},[data]); // eslint-disable-line react-hooks/exhaustive-deps
  const updateCerts=useCallback(certCategories=>{const d={...data,certCategories};setData(d);scheduleSave(d);},[data]); // eslint-disable-line react-hooks/exhaustive-deps
  const updateEvents=useCallback(events=>{const d={...data,events};setData(d);scheduleSave(d);},[data]); // eslint-disable-line react-hooks/exhaustive-deps
  const updateCoverLetter=useCallback(coverLetterFolders=>{const d={...data,coverLetterFolders};setData(d);scheduleSave(d);},[data]); // eslint-disable-line react-hooks/exhaustive-deps
  const handleSetCalendarId=useCallback(id=>{setCalendarId(id);localStorage.setItem("career_cal_id",id);},[]);

  const globalStyle=`* { box-sizing: border-box; margin: 0; padding: 0; } html, body, #root { height: 100%; } body { background: ${C.bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; } ::-webkit-scrollbar { width: 4px; height: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 99px; } input, select, textarea, button { font-family: inherit; } input[type=date]::-webkit-calendar-picker-indicator { filter: invert(0.4); } select option { background: ${C.surface2}; } @keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100%{opacity:1;}50%{opacity:0.4;} } @keyframes toastIn { from { opacity:0; transform:translateX(12px) scale(0.96); } to { opacity:1; transform:translateX(0) scale(1); } } a { text-decoration: none; }`;

  if(authState==="loading") return(<><style>{globalStyle}</style><div style={{ height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:C.bg }}><Loader2 size={32} color={C.accent} style={{ animation:"spin 1s linear infinite" }}/></div></>);
  if(authState==="login") return(<><style>{globalStyle}</style><LoginScreen onSignIn={handleSignIn} loading={loginLoading}/></>);

  const clearSearch = () => setSearchQuery("");
  const mainContent = searchQuery.trim()
    ? <SearchResults query={searchQuery.trim()} library={data.library} certCategories={data.certCategories} events={data.events} setPage={setPage} clearSearch={clearSearch}/>
    : {
        dashboard:<Dashboard library={data.library} certCategories={data.certCategories} events={data.events} setPage={setPage} userInfo={userInfo} onOpenFile={setQuickViewFile}/>,
        library:  <Library library={data.library} onChange={updateLibrary} driveFolderId={driveFolderIdRef.current}/>,
        certs:    <Certificates certCategories={data.certCategories} onChange={updateCerts} driveFolderId={driveFolderIdRef.current}/>,
        scheduler:<Scheduler events={data.events} onChange={updateEvents} calendarId={calendarId} setCalendarId={handleSetCalendarId}/>,
        cover:    <CoverLetter folders={data.coverLetterFolders||[]} onChange={updateCoverLetter}/>,
      }[page];

  const sidebarProps = { page, setPage, certCategories:data.certCategories, events:data.events, syncStatus, onSignOut:handleSignOut, userInfo, searchQuery, setSearchQuery };

  return (
    <>
      <style>{globalStyle}</style>
      <style>{`@media(min-width:768px){.sidebar-desktop{display:flex!important;flex-direction:column;}.mobile-topbar{display:none!important;}}`}</style>
      <ToastContainer/>
      {quickViewFile && <FileViewer file={quickViewFile} onClose={()=>setQuickViewFile(null)}/>}
      <div style={{ display:"flex",height:"100vh",overflow:"hidden",background:C.bg }}>
        <div className="sidebar-desktop" style={{ display:"none",flexShrink:0,background:C.surface,borderRight:`1px solid ${C.border}` }}>
          <Sidebar {...sidebarProps}/>
        </div>
        {sidebarOpen&&(<div onClick={()=>setSidebarOpen(false)} style={{ position:"fixed",inset:0,zIndex:40,background:"rgba(0,0,0,0.6)",backdropFilter:"blur(4px)" }}><div onClick={e=>e.stopPropagation()} style={{ position:"absolute",left:0,top:0,bottom:0,width:240,background:C.surface,borderRight:`1px solid ${C.border2}`,display:"flex",flexDirection:"column" }}><Sidebar {...sidebarProps} setPage={p=>{setPage(p);setSidebarOpen(false);setSearchQuery("");}} /></div></div>)}
        <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden" }}>
          <div className="mobile-topbar" style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",background:C.surface,borderBottom:`1px solid ${C.border}` }}>
            <button onClick={()=>setSidebarOpen(true)} style={{ background:"transparent",border:"none",cursor:"pointer",padding:6,color:C.text2,display:"flex",borderRadius:8 }}><Menu size={16}/></button>
            <span style={{ fontSize:14,fontWeight:700,color:C.text1,fontFamily:"Georgia,serif" }}>CareerKit</span>
            <SyncDot status={syncStatus}/>
          </div>
          <div style={{ flex:1,overflowY:"auto" }}>
            <div style={{ maxWidth:900,margin:"0 auto",padding:"32px 24px" }}>
              {!searchQuery && <CountdownBanner events={data.events}/>}
              {mainContent}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
