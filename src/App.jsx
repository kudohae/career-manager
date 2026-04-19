import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  BookOpen, Award, Calendar, LayoutDashboard, Plus, Trash2,
  Upload, ChevronLeft, ChevronRight, X, Edit2, Check,
  Clock, FileText, Image, File, FolderOpen, Folder, AlertCircle,
  GraduationCap, Zap, LogOut, Cloud, RefreshCw,
  Eye, Loader2, Menu, ChevronDown, ChevronRight as CR,
  Download, Pencil, ExternalLink, CalendarPlus, CalendarCheck,
  Undo2, Eraser, MoveRight
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
async function saveAnnotation(driveFileId, dataUrl) {
  const name = `annotation_${driveFileId}.json`;
  const data = { dataUrl, updatedAt: new Date().toISOString() };
  const existing = await findFile(name, "appDataFolder");
  if (existing) { await updateJsonFile(existing.id, data); }
  else { await createJsonFile(name, data, ["appDataFolder"]); }
}
async function loadAnnotation(driveFileId) {
  const name = `annotation_${driveFileId}.json`;
  const file = await findFile(name, "appDataFolder");
  if (!file) return null;
  const data = await readJsonFile(file.id);
  return data.dataUrl || null;
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
async function addToGoogleCalendar(event, calId) {
  const start = event.date;
  const [y, m, d] = start.split("-").map(Number);
  const endDate = new Date(y, m - 1, d + 1);
  const end = endDate.toLocaleDateString("sv-SE");
  const res = await window.gapi.client.calendar.events.insert({
    calendarId: calId,
    resource: { summary: event.title, description: event.note || "", start: { date: start }, end: { date: end }, colorId: event.type === "exam" ? "11" : event.type === "cert" ? "10" : "9" },
  });
  return res.result.id;
}
async function removeFromGoogleCalendar(googleEventId, calId) {
  try { await window.gapi.client.calendar.events.delete({ calendarId: calId, eventId: googleEventId }); }
  catch(e) { console.warn("Calendar delete failed:", e); }
}
async function fetchGoogleCalendarEvents(calId, existingEvents) {
  const knownGoogleIds = new Set(existingEvents.map(e => e.googleEventId).filter(Boolean));
  const now = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString();
  const timeMax = new Date(now.getFullYear(), now.getMonth() + 12, 31).toISOString();
  const res = await window.gapi.client.calendar.events.list({ calendarId: calId, timeMin, timeMax, singleEvents: true, orderBy: "startTime", maxResults: 500 });
  const googleEvents = res.result.items || [];
  const newEvents = [];
  for (const ge of googleEvents) {
    if (knownGoogleIds.has(ge.id)) continue;
    const rawDate = ge.start?.date || ge.start?.dateTime?.split("T")[0];
    if (!rawDate) continue;
    const colorToType = { "11": "exam", "10": "cert", "9": "study" };
    const type = colorToType[ge.colorId] || "other";
    newEvents.push({ id: uid(), title: ge.summary || "(제목 없음)", date: rawDate, type, note: ge.description || "", isDday: true, syncCal: true, googleEventId: ge.id, syncedToCalendar: true, importedFromCalendar: true });
  }
  return newEvents;
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
const EMPTY_DATA = { library:[], certCategories:[], events:[] };

const S = {
  card:  { background:C.surface, border:`1px solid ${C.border2}`, borderRadius:16 },
  input: { background:C.surface, border:`1px solid ${C.border2}`, borderRadius:10, color:C.text1, padding:"8px 12px", fontSize:13, width:"100%", outline:"none", boxSizing:"border-box" },
  label: { fontSize:11, fontWeight:500, color:C.text2, marginBottom:4, display:"block" },
  col:   { display:"flex", flexDirection:"column", gap:6 },
};

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

// ─── ANNOTATION CANVAS ─────────────────────────────────────
// 입력 타입으로 동작을 고정:
//  - pointerType === "touch" → 즉시 return, touchAction으로 스크롤/핀치줌 통과
//  - pointerType === "pen" → 항상 그리기 (drawMode 개념 없음)
//  - pen + 배럴 버튼 (buttons & 2) → 지우개
function AnnotationCanvas({ driveFileId }) {
  const canvasRef    = useRef(null);
  const isDrawing    = useRef(false);
  const toolRef      = useRef("pen");
  const colorRef     = useRef("#e74c3c");
  const sizeRef      = useRef(3);
  const undoStack    = useRef([]);
  const saveTimer    = useRef(null);
  const barrelActive = useRef(false);

  const [tool,  setTool_]  = useState("pen");
  const [color, setColor_] = useState("#e74c3c");
  const [size,  setSize_]  = useState(3);
  const [saving,  setSaving]  = useState(false);
  const [dirty,   setDirty]   = useState(false);
  const [undoLen, setUndoLen] = useState(0);

  function setTool(t)  { toolRef.current  = t; setTool_(t); }
  function setColor(c) { colorRef.current = c; setColor_(c); }
  function setSize(s)  { sizeRef.current  = s; setSize_(s); }

  useEffect(() => {
    if (!driveFileId) return;
    (async () => {
      try {
        const dataUrl = await loadAnnotation(driveFileId);
        if (!dataUrl || !canvasRef.current) return;
        const img = new window.Image();
        img.onload = () => {
          const ctx = canvasRef.current?.getContext("2d");
          if (ctx) ctx.drawImage(img, 0, 0);
        };
        img.src = dataUrl;
      } catch(e) { console.error(e); }
    })();
  }, [driveFileId]);

  // native 이벤트 등록 — passive:false 필수 (React synthetic으로는 preventDefault 불가)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * sx,
        y: (e.clientY - rect.top)  * sy,
      };
    }

    function applyStyle(ctx) {
      const isEraser = toolRef.current === "eraser" || barrelActive.current;
      ctx.lineWidth  = isEraser ? sizeRef.current * 6 : sizeRef.current;
      ctx.lineCap    = "round";
      ctx.lineJoin   = "round";
      ctx.strokeStyle = colorRef.current;
      ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
    }

    function pushUndo() {
      const ctx = canvas.getContext("2d");
      const snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
      undoStack.current.push(snap);
      if (undoStack.current.length > 30) undoStack.current.shift();
      setUndoLen(undoStack.current.length);
    }

    function scheduleSave() {
      setDirty(true);
      if (!driveFileId) return;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaving(true);
        try {
          await saveAnnotation(driveFileId, canvas.toDataURL("image/png"));
          setDirty(false);
        } catch(e) { console.error(e); } finally { setSaving(false); }
      }, 1500);
    }

    function onDown(e) {
      // 손가락: touchAction이 스크롤/핀치줌 처리, JS는 개입하지 않음
      if (e.pointerType === "touch") return;
      // 펜만 그리기
      if (e.pointerType !== "pen") return;

      e.preventDefault();
      e.stopPropagation();

      const isBarrel = (e.buttons & 2) !== 0;
      if (isBarrel) {
        barrelActive.current = true;
        toolRef.current = "eraser";
      }

      pushUndo();
      isDrawing.current = true;
      canvas.setPointerCapture(e.pointerId);

      const ctx = canvas.getContext("2d");
      applyStyle(ctx);
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    }

    function onMove(e) {
      if (e.pointerType !== "pen" || !isDrawing.current) return;
      e.preventDefault();
      e.stopPropagation();

      const ctx = canvas.getContext("2d");
      applyStyle(ctx);
      const pos = getPos(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    }

    function onUp(e) {
      if (e.pointerType !== "pen" || !isDrawing.current) return;
      isDrawing.current = false;

      const ctx = canvas.getContext("2d");
      ctx.beginPath();

      if (barrelActive.current && (e.buttons & 2) === 0) {
        barrelActive.current = false;
        toolRef.current = tool;
        setTool_(tool);
      }

      scheduleSave();
    }

    canvas.addEventListener("pointerdown",   onDown, { passive: false });
    canvas.addEventListener("pointermove",   onMove, { passive: false });
    canvas.addEventListener("pointerup",     onUp,   { passive: false });
    canvas.addEventListener("pointercancel", onUp,   { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown",   onDown);
      canvas.removeEventListener("pointermove",   onMove);
      canvas.removeEventListener("pointerup",     onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, [tool, driveFileId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+Z 단축키
  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function undo() {
    if (!undoStack.current.length) return;
    const snap = undoStack.current.pop();
    canvasRef.current.getContext("2d").putImageData(snap, 0, 0);
    setUndoLen(undoStack.current.length);
    setDirty(true);
    if (driveFileId) {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaving(true);
        try { await saveAnnotation(driveFileId, canvasRef.current.toDataURL("image/png")); setDirty(false); }
        catch(e) { console.error(e); } finally { setSaving(false); }
      }, 1500);
    }
  }

  function clearCanvas() {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    undoStack.current.push(ctx.getImageData(0, 0, c.width, c.height));
    if (undoStack.current.length > 30) undoStack.current.shift();
    setUndoLen(undoStack.current.length);
    ctx.clearRect(0, 0, c.width, c.height);
    setDirty(true);
    if (driveFileId) {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaving(true);
        try { await saveAnnotation(driveFileId, c.toDataURL("image/png")); setDirty(false); }
        catch(e) { console.error(e); } finally { setSaving(false); }
      }, 1500);
    }
  }

  const COLORS = ["#e74c3c","#e67e22","#f1c40f","#2ecc71","#3498db","#9b59b6","#ffffff","#000000"];

  return (
    <div style={{ position:"absolute", inset:0, pointerEvents:"none" }}>
      {/* 도구 패널 — 항상 표시 */}
      <div style={{ position:"absolute", top:8, right:8, zIndex:10, pointerEvents:"all" }}>
        <div style={{
          background:"rgba(15,21,33,0.92)", borderRadius:12, padding:"8px 6px",
          display:"flex", flexDirection:"column", gap:5,
          border:"1px solid rgba(255,255,255,0.12)", boxShadow:"0 4px 20px rgba(0,0,0,0.4)"
        }}>
          <button onClick={() => setTool("pen")} title="펜"
            style={{ background:tool==="pen"?C.accent:"transparent", border:"none", cursor:"pointer", padding:6, borderRadius:8, display:"flex", color:"white" }}>
            <Pencil size={14}/>
          </button>
          <button onClick={() => setTool("eraser")} title="지우개 (S펜 배럴 버튼도 가능)"
            style={{ background:tool==="eraser"?C.accent:"transparent", border:"none", cursor:"pointer", padding:6, borderRadius:8, display:"flex", color:"white" }}>
            <Eraser size={14}/>
          </button>
          <button onClick={undo} disabled={undoLen===0} title="되돌리기 (Ctrl+Z)"
            style={{ background:"transparent", border:"none", cursor:undoLen?"pointer":"default", padding:6, borderRadius:8, display:"flex", color:undoLen?C.text2:C.text3, opacity:undoLen?1:0.4 }}>
            <Undo2 size={14}/>
          </button>
          <div style={{ height:1, background:"rgba(255,255,255,0.1)", margin:"2px 0" }}/>
          <input type="range" min={1} max={20} value={size} onChange={e => setSize(Number(e.target.value))}
            title={`굵기: ${size}`}
            style={{ width:14, height:70, writingMode:"vertical-lr", direction:"rtl", cursor:"pointer", accentColor:C.accent }}/>
          <div style={{ height:1, background:"rgba(255,255,255,0.1)", margin:"2px 0" }}/>
          {COLORS.map(col => (
            <button key={col} onClick={() => { setTool("pen"); setColor(col); }}
              style={{ width:20, height:20, borderRadius:"50%", background:col,
                border: color===col&&tool==="pen" ? "2px solid white" : "2px solid rgba(255,255,255,0.2)",
                cursor:"pointer", flexShrink:0 }}/>
          ))}
          <div style={{ height:1, background:"rgba(255,255,255,0.1)", margin:"2px 0" }}/>
          <button onClick={clearCanvas} title="전체 지우기"
            style={{ background:"transparent", border:"none", cursor:"pointer", padding:6, borderRadius:8, display:"flex", color:C.danger }}>
            <Trash2 size={14}/>
          </button>
          {saving && <Loader2 size={14} color={C.accent} style={{ animation:"spin 1s linear infinite", margin:"0 auto" }}/>}
          {dirty && !saving && <div style={{ width:6, height:6, borderRadius:"50%", background:C.warning, margin:"0 auto" }}/>}
        </div>
      </div>

      {/* 캔버스
          - pointerEvents:all 고정 (항상 이벤트 수신)
          - touch → 핸들러에서 즉시 return, touchAction으로 스크롤/핀치줌 브라우저 처리
          - pen → 항상 preventDefault 후 그리기
      */}
      <canvas
        ref={canvasRef}
        width={1200}
        height={1600}
        style={{
          position:"absolute", inset:0, width:"100%", height:"100%",
          cursor: tool==="eraser" ? "cell" : "crosshair",
          pointerEvents: "all",
          touchAction: "pan-x pan-y pinch-zoom",
        }}
      />
    </div>
  );
}

// ─── FILE VIEWER ───────────────────────────────────────────
function FileViewer({ file, onClose, onRename }) {
  const [state, setState] = useState("loading");
  const [blobUrl, setBlobUrl] = useState(null);
  const [textContent, setTextContent] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(file.name);
  const [renaming, setRenaming] = useState(false);
  const FIcon = isImage(file.name) ? Image : isPdf(file.name) ? FileText : File;

  useEffect(() => {
    if (!file.driveId) { setState("no-drive"); return; }
    (async () => {
      setState("loading");
      try {
        const blob = await fetchFileBlob(file.driveId);
        if (isText(file.name)) { setTextContent(await blob.text()); setState("text"); }
        else if (isHtml(file.name)) { setTextContent(await blob.text()); setState("html"); }
        else { const url = URL.createObjectURL(blob); setBlobUrl(url); setState(isImage(file.name)?"image":isPdf(file.name)?"pdf":"other"); }
      } catch { setState("error"); }
    })();
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [file.driveId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveRename() {
    if (!nameVal.trim() || nameVal === file.name) { setEditingName(false); return; }
    setRenaming(true);
    try { if (onRename) await onRename(file, nameVal.trim()); }
    catch(e) { console.error(e); }
    finally { setRenaming(false); setEditingName(false); }
  }

  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{ position:"fixed",inset:0,zIndex:60,background:"rgba(0,0,0,0.85)",backdropFilter:"blur(12px)",display:"flex",flexDirection:"column" }}>
      <div style={{ display:"flex",alignItems:"center",gap:12,padding:"12px 20px",background:C.surface,borderBottom:`1px solid ${C.border2}`,flexShrink:0 }}>
        <div style={{ borderRadius:8,padding:6,background:C.accent+"18" }}><FIcon size={14} color={C.accent}/></div>
        {editingName ? (
          <input autoFocus value={nameVal} onChange={e=>setNameVal(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter") saveRename(); if(e.key==="Escape"){setEditingName(false);setNameVal(file.name);} }}
            style={{ flex:1, background:"transparent", border:"none", borderBottom:`1px solid ${C.accent}`, color:C.text1, fontSize:13, fontWeight:500, outline:"none", fontFamily:"inherit" }}/>
        ) : (
          <span style={{ flex:1,fontSize:13,fontWeight:500,color:C.text1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{file.name}</span>
        )}
        {onRename && !editingName && (
          <button onClick={()=>{setEditingName(true);setNameVal(file.name);}} title="파일 이름 변경"
            style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.text2,display:"flex",flexShrink:0 }}>
            <Pencil size={13}/>
          </button>
        )}
        {editingName && (
          <button onClick={saveRename} disabled={renaming}
            style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.success,display:"flex",flexShrink:0 }}>
            {renaming ? <Loader2 size={13} style={{ animation:"spin 1s linear infinite" }}/> : <Check size={13}/>}
          </button>
        )}
        {blobUrl&&<a href={blobUrl} download={file.name} style={{ display:"flex",alignItems:"center",gap:6,fontSize:12,color:C.text2,padding:"6px 12px",borderRadius:8,border:`1px solid ${C.border2}`,textDecoration:"none" }}><Download size={12}/>다운로드</a>}
        {file.webViewLink&&<a href={file.webViewLink} target="_blank" rel="noreferrer" style={{ display:"flex",alignItems:"center",gap:6,fontSize:12,color:C.text2,padding:"6px 12px",borderRadius:8,border:`1px solid ${C.border2}`,textDecoration:"none" }}><ExternalLink size={12}/>Drive에서 보기</a>}
        <button onClick={onClose} style={{ background:"transparent",border:"none",cursor:"pointer",padding:6,color:C.text2,display:"flex",borderRadius:8 }}><X size={16}/></button>
      </div>
      <div style={{ flex:1,overflow:"auto",display:"flex",alignItems:"center",justifyContent:"center",padding:24 }}>
        {state==="loading"&&<div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:12 }}><Loader2 size={28} color={C.accent} style={{ animation:"spin 1s linear infinite" }}/><span style={{ fontSize:13,color:C.text2 }}>불러오는 중...</span></div>}
        {state==="error"&&<div style={{ textAlign:"center" }}><p style={{ fontSize:14,color:C.danger,marginBottom:8 }}>파일을 불러올 수 없습니다.</p>{file.webViewLink&&<a href={file.webViewLink} target="_blank" rel="noreferrer" style={{ fontSize:13,color:C.accent }}>Drive에서 열기</a>}</div>}
        {state==="no-drive"&&<p style={{ fontSize:14,color:C.text2 }}>로컬 파일입니다.</p>}
        {state==="image"&&<img src={blobUrl} alt={file.name} style={{ maxWidth:"100%",maxHeight:"100%",borderRadius:12,boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}/>}
        {state==="pdf"&&(
          <div style={{ position:"relative", width:"100%", height:"100%" }}>
            <iframe src={blobUrl} title={file.name} style={{ width:"100%",height:"100%",border:"none",borderRadius:8 }}/>
            <AnnotationCanvas driveFileId={file.driveId}/>
          </div>
        )}
        {state==="text"&&<div style={{ width:"100%",maxWidth:800,background:C.surface,borderRadius:12,padding:24,border:`1px solid ${C.border2}` }}><pre style={{ fontSize:12,color:C.text2,lineHeight:1.7,whiteSpace:"pre-wrap",wordBreak:"break-word",overflowY:"auto",maxHeight:"70vh" }}>{textContent}</pre></div>}
        {state==="html"&&(
          <div style={{ position:"relative", width:"100%", height:"100%" }}>
            <iframe srcDoc={textContent} sandbox="allow-scripts" title={file.name} style={{ width:"100%",height:"100%",border:"none",borderRadius:8,background:"white" }}/>
            <AnnotationCanvas driveFileId={file.driveId}/>
          </div>
        )}
        {state==="other"&&<div style={{ textAlign:"center" }}><div style={{ borderRadius:20,padding:24,background:C.surface2,display:"inline-flex",marginBottom:16 }}><File size={40} color={C.text3}/></div><p style={{ fontSize:13,color:C.text2,marginBottom:16 }}>이 형식은 뷰어에서 직접 보기가 불가능합니다.</p><div style={{ display:"flex",gap:8,justifyContent:"center" }}>{blobUrl&&<a href={blobUrl} download={file.name} style={{ display:"flex",alignItems:"center",gap:6,fontSize:13,color:"white",padding:"8px 16px",borderRadius:10,background:C.accent,textDecoration:"none" }}><Download size={13}/>다운로드</a>}{file.webViewLink&&<a href={file.webViewLink} target="_blank" rel="noreferrer" style={{ display:"flex",alignItems:"center",gap:6,fontSize:13,color:C.text2,padding:"8px 16px",borderRadius:10,border:`1px solid ${C.border2}`,textDecoration:"none" }}><ExternalLink size={13}/>Drive에서 열기</a>}</div></div>}
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
function Dashboard({ library, certCategories, events, setPage, userInfo }) {
  const countFiles = (n) => (n.files||[]).length + (n.folders||[]).reduce((b,f) => b + countFiles(f), 0);
  const totalFiles = library.reduce((a,s) => a + countFiles(s), 0);
  const totalCerts = certCategories.reduce((a,c)=>a+(c.certs||[]).length,0);
  const nextExam   = events.filter(e=>e.isDday&&diffDays(e.date)>=0).sort((a,b)=>diffDays(a.date)-diffDays(b.date))[0];
  const upcoming   = [...events].filter(e=>diffDays(e.date)>=0).sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,5);
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
  const FIcon = isImage(file.name)?Image:isPdf(file.name)?FileText:File;
  async function saveRename() { if(!newName.trim()||newName===file.name){setEditing(false);return;} setRenaming(true); await onRename(file,newName.trim()); setRenaming(false); setEditing(false); }
  return (
    <div style={{ display:"flex",alignItems:"center",gap:10,padding:"8px 16px",paddingLeft:16+depth*20,borderBottom:`1px solid ${C.border}` }}>
      <div style={{ borderRadius:7,padding:5,background:(color||C.accent)+"18",flexShrink:0 }}><FIcon size={11} color={color||C.accent}/></div>
      {editing?(<input autoFocus value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveRename();if(e.key==="Escape"){setEditing(false);setNewName(file.name);}}} style={{ flex:1,background:"transparent",border:"none",borderBottom:`1px solid ${C.accent}`,color:C.text1,fontSize:12,outline:"none",fontFamily:"inherit" }}/>):(<span style={{ flex:1,fontSize:12,color:C.text2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{file.name}</span>)}
      <span style={{ fontSize:10,color:C.text3,flexShrink:0 }}>{file.size}</span>
      <span style={{ fontSize:10,color:C.text3,flexShrink:0 }}>{formatDate(file.date)}</span>
      {editing?(
        <button onClick={saveRename} disabled={renaming} style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.success,display:"flex" }}>{renaming?<Loader2 size={11} style={{ animation:"spin 1s linear infinite" }}/>:<Check size={11}/>}</button>
      ):(
        <>
          <button onClick={()=>onView(file)} title="보기" style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.accent,display:"flex" }}><Eye size={11}/></button>
          <button onClick={()=>{setEditing(true);setNewName(file.name);}} title="이름 변경" style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.text2,display:"flex" }}><Pencil size={11}/></button>
          {onMove && <button onClick={()=>onMove(file)} title="이동" style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.text2,display:"flex" }}><MoveRight size={11}/></button>}
          <button onClick={()=>onDelete(file)} disabled={deleting===file.id} style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.danger,display:"flex" }}>{deleting===file.id?<Loader2 size={11} style={{ animation:"spin 1s linear infinite" }}/>:<Trash2 size={11}/>}</button>
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
        <button onClick={()=>onDeleteFolder(sectionId,folder.id)} style={{ background:"transparent",border:"none",cursor:"pointer",padding:3,color:C.danger,display:"flex" }}><Trash2 size={11}/></button>
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
    }catch(err){alert("업로드 실패: "+err.message);}
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
                <button onClick={()=>deleteSection(section.id)} style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.danger,display:"flex" }}><Trash2 size={12}/></button>
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
                      onView={f=>setViewingFile({...f,_sectionId:section.id,_folderId:null})}
                      onMove={f=>setMovingFile({file:f, sectionId:section.id, folderId:null})}
                      deleting={deletingFile}/>
                  </div>
                ))}
                {/* 폴더 트리 */}
                {(section.folders||[]).map(folder=>(
                  <FolderTree key={folder.id} folder={folder} sectionId={section.id} sectionColor={section.color} depth={0}
                    onDeleteFile={handleDeleteFile}
                    onRenameFile={handleRenameFile}
                    onViewFile={(f,fid)=>setViewingFile({...f,_sectionId:section.id,_folderId:fid})}
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
  const fileInputRef = useRef(null);
  const uploadTargetRef = useRef(null);
  const cf = k=>e=>setCertForm(p=>({...p,[k]:e.target.value}));

  function addCategory(){if(!newCat.name.trim())return;onChange([...certCategories,{id:uid(),name:newCat.name.trim(),color:newCat.color,certs:[]}]);setNewCat({name:"",color:SEC_COLORS[0]});setShowAddCat(false);}
  function deleteCategory(id){onChange(certCategories.filter(c=>c.id!==id));setConfirmDelete(null);}
  function addCert(catId){if(!certForm.name.trim())return;onChange(certCategories.map(cat=>cat.id!==catId?cat:{...cat,certs:[...(cat.certs||[]),{...certForm,id:uid(),files:[]}]}));setCertForm({name:"",issuer:"",date:"",expiry:"",score:"",note:"",color:CERT_COLORS[0]});setShowAddCert(null);}
  function deleteCert(catId,certId){onChange(certCategories.map(cat=>cat.id!==catId?cat:{...cat,certs:(cat.certs||[]).filter(c=>c.id!==certId)}));setConfirmDelete(null);}
  function openUpload(catId,certId){uploadTargetRef.current={catId,certId};setTimeout(()=>fileInputRef.current?.click(),50);}
  async function handleFileSelect(e){const files=Array.from(e.target.files);if(!files.length||!driveFolderId)return;const{catId,certId}=uploadTargetRef.current;setUploadingCert(certId);try{const uploaded=await Promise.all(files.map(f=>uploadFileToDrive(f,driveFolderId)));const newFiles=uploaded.map(r=>({id:uid(),driveId:r.id,name:r.name,size:formatBytes(r.size),date:today(),webViewLink:r.webViewLink}));onChange(certCategories.map(cat=>cat.id!==catId?cat:{...cat,certs:(cat.certs||[]).map(c=>c.id!==certId?c:{...c,files:[...(c.files||[]),...newFiles]})}));}catch(err){alert("업로드 실패: "+err.message);}finally{setUploadingCert(null);uploadTargetRef.current=null;if(fileInputRef.current)fileInputRef.current.value="";}}
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
                                <button onClick={()=>openUpload(cat.id,cert.id)} disabled={uploadingCert===cert.id} style={{ background:"rgba(255,255,255,0.15)",border:"none",cursor:"pointer",padding:5,borderRadius:7,display:"flex",color:"rgba(255,255,255,0.8)" }}>{uploadingCert===cert.id?<Loader2 size={11} style={{ animation:"spin 1s linear infinite" }}/>:<Upload size={11}/>}</button>
                                <button onClick={()=>setConfirmDelete({type:"cert",catId:cat.id,certId:cert.id})} style={{ background:"rgba(255,255,255,0.15)",border:"none",cursor:"pointer",padding:5,borderRadius:7,display:"flex",color:"rgba(255,255,255,0.8)" }}><Trash2 size={11}/></button>
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
                          {(cert.files||[]).length>0&&(<div style={{ background:"rgba(0,0,0,0.15)",borderTop:"1px solid rgba(255,255,255,0.06)" }}>{(cert.files||[]).map(file=>(<div key={file.id} style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 14px",borderBottom:"1px solid rgba(255,255,255,0.05)" }}><FileText size={10} color="rgba(255,255,255,0.4)"/><span style={{ flex:1,fontSize:10,color:"rgba(255,255,255,0.55)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{file.name}</span><button onClick={()=>setViewingFile({...file,_catId:cat.id,_certId:cert.id})} style={{ background:"transparent",border:"none",cursor:"pointer",display:"flex",color:"rgba(255,255,255,0.5)",padding:2 }}><Eye size={10}/></button><button onClick={()=>handleDeleteFile(cat.id,cert.id,file)} disabled={deletingFile===file.id} style={{ background:"transparent",border:"none",cursor:"pointer",display:"flex",color:"rgba(255,255,255,0.4)",padding:2 }}>{deletingFile===file.id?<Loader2 size={10} style={{ animation:"spin 1s linear infinite" }}/>:<Trash2 size={10}/>}</button></div>))}</div>)}
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
      {confirmDelete&&(<Modal title="삭제 확인" onClose={()=>setConfirmDelete(null)}><p style={{ fontSize:13,color:C.text2,marginBottom:20 }}>{confirmDelete.type==="cat"?"이 카테고리와 포함된 모든 자격증을 삭제하시겠습니까?":"이 자격증을 삭제하시겠습니까?"}</p><div style={{ display:"flex",gap:8,justifyContent:"flex-end" }}><Btn variant="ghost" onClick={()=>setConfirmDelete(null)}>취소</Btn><Btn variant="danger" onClick={()=>confirmDelete.type==="cat"?deleteCategory(confirmDelete.catId):deleteCert(confirmDelete.catId,confirmDelete.certId)}>삭제</Btn></div></Modal>)}
    </div>
  );
}

// ─── SCHEDULER ─────────────────────────────────────────────
function Scheduler({ events, onChange, calendarId, setCalendarId }) {
  const [view, setView] = useState("month");
  const [cursor, setCursor] = useState(new Date());
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title:"",date:today(),type:"exam",note:"",isDday:true,syncCal:true });
  const [addingCal, setAddingCal] = useState(false);
  const [removingCal, setRemovingCal] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fld = k=>e=>setForm(p=>({...p,[k]:e.target.value}));

  useEffect(() => { handleImportFromGoogle({ silent: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleImportFromGoogle({ silent = false } = {}) {
    setImporting(true); setImportResult(null);
    try {
      let calId = calendarId;
      if (!calId) { calId = await getOrCreateCareerCalendar(); setCalendarId(calId); }
      const newEvs = await fetchGoogleCalendarEvents(calId, events);
      if (newEvs.length > 0) { onChange([...events, ...newEvs]); setImportResult({ count: newEvs.length }); setTimeout(()=>setImportResult(null), 4000); }
      else if (!silent) { setImportResult({ count: 0 }); setTimeout(()=>setImportResult(null), 3000); }
    } catch(e) { console.error(e); if (!silent) alert("Google 캘린더 가져오기에 실패했습니다."); }
    finally { setImporting(false); }
  }

  function openAdd(date=today()){ setForm(p=>({...p,date})); setShowAdd(true); }

  async function addEvent() {
    if (!form.title.trim()||!form.date) return;
    setAddingCal(true);
    let googleEventId = null, calId = calendarId;
    try {
      if (form.syncCal) {
        if (!calId) { calId = await getOrCreateCareerCalendar(); setCalendarId(calId); }
        googleEventId = await addToGoogleCalendar({ ...form }, calId);
      }
    } catch(e) { console.error(e); } finally { setAddingCal(false); }
    onChange([...events,{ ...form, id:uid(), isDday:form.isDday, googleEventId, syncedToCalendar: !!googleEventId }]);
    setForm({ title:"",date:today(),type:"exam",note:"",isDday:true,syncCal:true });
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
    } catch(e) { console.error(e); alert("Google 캘린더 동기화 실패"); }
    finally { setRemovingCal(null); }
  }

  function getMonthGrid(d){const y=d.getFullYear(),m=d.getMonth(),first=new Date(y,m,1),last=new Date(y,m+1,0),cells=[];for(let i=0;i<first.getDay();i++)cells.push(null);for(let n=1;n<=last.getDate();n++)cells.push(new Date(y,m,n));while(cells.length%7!==0)cells.push(null);return cells;}
  function eventsOn(d){if(!d)return[];const ds=d.toLocaleDateString("sv-SE");return events.filter(e=>e.date===ds);}
  function getWeekDates(d){const b=new Date(d);b.setDate(d.getDate()-d.getDay());return Array.from({length:7},(_,i)=>{const x=new Date(b);x.setDate(b.getDate()+i);return x;});}

  const todayStr=today(), monthGrid=getMonthGrid(cursor), weekDates=getWeekDates(cursor);

  return (
    <div>
      <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:32 }}>
        <div><h2 style={{ fontSize:20,fontWeight:700,color:C.text1,fontFamily:"Georgia,serif" }}>학습 스케줄러</h2><p style={{ fontSize:13,color:C.text2,marginTop:4 }}>시험 일정 및 D-Day 관리 · Google 캘린더 연동</p></div>
        <div style={{ display:"flex",gap:8 }}>
          <div style={{ display:"flex",borderRadius:10,overflow:"hidden",border:`1px solid ${C.border2}` }}>{["month","week"].map(v=>(<button key={v} onClick={()=>setView(v)} style={{ padding:"7px 14px",fontSize:12,fontWeight:500,background:v===view?C.accent:"transparent",color:v===view?"white":C.text2,border:"none",cursor:"pointer",fontFamily:"inherit" }}>{v==="month"?"월간":"주간"}</button>))}</div>
          <Btn icon={importing?RefreshCw:CalendarCheck} variant="ghost" loading={importing} onClick={()=>handleImportFromGoogle({silent:false})}>Google 가져오기</Btn>
          <Btn icon={Plus} onClick={()=>openAdd()}>일정 추가</Btn>
        </div>
      </div>

      {importResult !== null && (
        <div style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderRadius:12,marginBottom:16,background:importResult.count>0?`${C.success}18`:C.surface3,border:`1px solid ${importResult.count>0?C.success+"40":C.border2}` }}>
          <CalendarCheck size={14} color={importResult.count>0?C.success:C.text3}/>
          <span style={{ fontSize:13,color:importResult.count>0?C.success:C.text2 }}>
            {importResult.count>0 ? `Google 캘린더에서 ${importResult.count}개 일정을 가져왔습니다.` : "가져올 새 일정이 없습니다."}
          </span>
        </div>
      )}

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
        <h3 style={{ fontSize:13,fontWeight:600,color:C.text1,marginBottom:12 }}>전체 일정 <span style={{ color:C.text3 }}>({events.length})</span></h3>
        {events.length===0?<p style={{ fontSize:13,color:C.text2 }}>일정이 없습니다.</p>:(
          <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
            {[...events].sort((a,b)=>new Date(a.date)-new Date(b.date)).map(e=>{
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
                  <span style={{ fontSize:11,color:C.text3,flexShrink:0 }}>{formatDate(e.date)}</span>
                  {e.isDday&&<span style={{ fontSize:11,fontWeight:700,flexShrink:0,padding:"2px 8px",borderRadius:99,background:diff<0?"rgba(148,163,184,0.1)":diff===0?C.danger+"20":C.accent+"18",color:diff<0?C.text3:diff===0?C.danger:C.accent }}>{dDayLabel(diff)}</span>}
                  {e.syncedToCalendar?(
                    <div title="Google 캘린더에 동기화됨" style={{ display:"flex",padding:4,color:C.success,flexShrink:0 }}><CalendarCheck size={13}/></div>
                  ):(
                    <button onClick={()=>syncEventToCalendar(e)} disabled={removingCal===e.id} title="Google 캘린더에 추가" style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.text3,display:"flex",flexShrink:0 }}>{removingCal===e.id?<Loader2 size={13} style={{ animation:"spin 1s linear infinite" }}/>:<CalendarPlus size={13}/>}</button>
                  )}
                  <button onClick={()=>deleteEvent(e.id)} disabled={removingCal===e.id} style={{ background:"transparent",border:"none",cursor:"pointer",padding:4,color:C.danger,display:"flex",flexShrink:0 }}>{removingCal===e.id?<Loader2 size={13} style={{ animation:"spin 1s linear infinite" }}/>:<Trash2 size={13}/>}</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedEvent&&(
        <Modal title={selectedEvent.title} onClose={()=>setSelectedEvent(null)}>
          <div style={{ ...S.col,gap:12 }}>
            <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
              <div style={{ fontSize:11,padding:"3px 10px",borderRadius:99,background:EVENT_TYPES[selectedEvent.type]?.color+"22",color:EVENT_TYPES[selectedEvent.type]?.color }}>{EVENT_TYPES[selectedEvent.type]?.label}</div>
              {selectedEvent.isDday&&<div style={{ fontSize:11,padding:"3px 10px",borderRadius:99,background:C.accent+"18",color:C.accent }}>D-Day {dDayLabel(diffDays(selectedEvent.date))}</div>}
              {selectedEvent.syncedToCalendar&&<div style={{ fontSize:11,padding:"3px 10px",borderRadius:99,background:C.success+"18",color:C.success,display:"flex",alignItems:"center",gap:4 }}><CalendarCheck size={10}/>Google 캘린더 연동됨</div>}
            </div>
            <div style={{ fontSize:13,color:C.text2 }}>{formatDate(selectedEvent.date)}</div>
            {selectedEvent.note&&<div style={{ fontSize:13,color:C.text2,padding:12,background:C.surface3,borderRadius:8 }}>{selectedEvent.note}</div>}
            <div style={{ display:"flex",gap:8,justifyContent:"flex-end",marginTop:8 }}>
              {!selectedEvent.syncedToCalendar&&(
                <Btn variant="success" icon={CalendarPlus} loading={removingCal===selectedEvent.id} onClick={async()=>{ await syncEventToCalendar(selectedEvent); setSelectedEvent(null); }}>Google 캘린더에 추가</Btn>
              )}
              <Btn variant="danger" icon={Trash2} onClick={()=>deleteEvent(selectedEvent.id)}>삭제</Btn>
            </div>
          </div>
        </Modal>
      )}

      {showAdd&&(
        <Modal title="일정 추가" onClose={()=>setShowAdd(false)}>
          <div style={{ ...S.col,gap:12 }}>
            <Input label="제목 *" value={form.title} onChange={fld("title")} onKeyDown={e=>e.key==="Enter"&&addEvent()} placeholder="TOEIC 시험 ..."/>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
              <Input label="날짜 *" type="date" value={form.date} onChange={fld("date")}/>
              <SelectInput label="유형" value={form.type} onChange={fld("type")}>{Object.entries(EVENT_TYPES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</SelectInput>
            </div>
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
              <Btn variant="ghost" onClick={()=>setShowAdd(false)}>취소</Btn>
              <Btn onClick={addEvent} loading={addingCal}>{addingCal?"Google 캘린더 동기화 중...":"추가"}</Btn>
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
    {id:"dashboard",label:"대시보드",icon:LayoutDashboard},
    {id:"library",label:"강의 자료실",icon:BookOpen},
    {id:"certs",label:"자격증 보관함",icon:Award,badge:totalCerts},
    {id:"scheduler",label:"학습 스케줄러",icon:Calendar,badge:upcoming||null},
  ];
  return (
    <nav style={{ width:220,minWidth:220,display:"flex",flexDirection:"column",height:"100%" }}>
      <div style={{ padding:"20px 20px 12px" }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <div style={{ borderRadius:12,padding:8,background:`${C.accent}18`,border:`1px solid ${C.accent}30` }}><GraduationCap size={16} color={C.accent}/></div>
          <div><div style={{ fontSize:14,fontWeight:700,color:C.text1,fontFamily:"Georgia,serif" }}>CareerKit</div><div style={{ display:"flex",alignItems:"center",gap:5,marginTop:2 }}><SyncDot status={syncStatus}/><span style={{ fontSize:10,color:C.text3 }}>{syncStatus==="synced"?"Drive 동기화됨":syncStatus==="syncing"?"저장 중...":"오류"}</span></div></div>
        </div>
      </div>
      <div style={{ flex:1,padding:"4px 12px",overflowY:"auto" }}>
        {navItems.map(item=>{const active=page===item.id;return(<button key={item.id} onClick={()=>setPage(item.id)} style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:12,width:"100%",textAlign:"left",cursor:"pointer",fontFamily:"inherit",marginBottom:2,background:active?`${C.accent}18`:"transparent",color:active?C.accent:C.text2,border:active?`1px solid ${C.accent}30`:"1px solid transparent",transition:"all 0.15s" }}><item.icon size={15} style={{ flexShrink:0 }}/><span style={{ flex:1,fontSize:13,fontWeight:500 }}>{item.label}</span>{item.badge>0&&<span style={{ fontSize:10,fontWeight:700,padding:"1px 6px",borderRadius:99,background:active?C.accent:C.surface3,color:active?"white":C.text2 }}>{item.badge}</span>}</button>);})}
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
      if(loaded.certs&&!loaded.certCategories){ setData({library:loaded.library||[],certCategories:[{id:uid(),name:"기타",color:SEC_COLORS[0],certs:loaded.certs.map(c=>({...c,files:c.files||[]}))}],events:loaded.events||[]}); }
      else { setData({library:loaded.library||[],certCategories:loaded.certCategories||[],events:loaded.events||[]}); }
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
  const handleSetCalendarId=useCallback(id=>{setCalendarId(id);localStorage.setItem("career_cal_id",id);},[]);

  const globalStyle=`* { box-sizing: border-box; margin: 0; padding: 0; } html, body, #root { height: 100%; } body { background: ${C.bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; } ::-webkit-scrollbar { width: 4px; height: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 99px; } input, select, textarea, button { font-family: inherit; } input[type=date]::-webkit-calendar-picker-indicator { filter: invert(0.4); } select option { background: ${C.surface2}; } @keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100%{opacity:1;}50%{opacity:0.4;} } a { text-decoration: none; }`;

  if(authState==="loading") return(<><style>{globalStyle}</style><div style={{ height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:C.bg }}><Loader2 size={32} color={C.accent} style={{ animation:"spin 1s linear infinite" }}/></div></>);
  if(authState==="login") return(<><style>{globalStyle}</style><LoginScreen onSignIn={handleSignIn} loading={loginLoading}/></>);

  const pages={
    dashboard:<Dashboard library={data.library} certCategories={data.certCategories} events={data.events} setPage={setPage} userInfo={userInfo}/>,
    library:  <Library library={data.library} onChange={updateLibrary} driveFolderId={driveFolderIdRef.current}/>,
    certs:    <Certificates certCategories={data.certCategories} onChange={updateCerts} driveFolderId={driveFolderIdRef.current}/>,
    scheduler:<Scheduler events={data.events} onChange={updateEvents} calendarId={calendarId} setCalendarId={handleSetCalendarId}/>,
  };

  return (
    <>
      <style>{globalStyle}</style>
      <style>{`@media(min-width:768px){.sidebar-desktop{display:flex!important;flex-direction:column;}.mobile-topbar{display:none!important;}}`}</style>
      <div style={{ display:"flex",height:"100vh",overflow:"hidden",background:C.bg }}>
        <div className="sidebar-desktop" style={{ display:"none",flexShrink:0,background:C.surface,borderRight:`1px solid ${C.border}` }}>
          <Sidebar page={page} setPage={setPage} certCategories={data.certCategories} events={data.events} syncStatus={syncStatus} onSignOut={handleSignOut} userInfo={userInfo}/>
        </div>
        {sidebarOpen&&(<div onClick={()=>setSidebarOpen(false)} style={{ position:"fixed",inset:0,zIndex:40,background:"rgba(0,0,0,0.6)",backdropFilter:"blur(4px)" }}><div onClick={e=>e.stopPropagation()} style={{ position:"absolute",left:0,top:0,bottom:0,width:240,background:C.surface,borderRight:`1px solid ${C.border2}`,display:"flex",flexDirection:"column" }}><Sidebar page={page} setPage={p=>{setPage(p);setSidebarOpen(false);}} certCategories={data.certCategories} events={data.events} syncStatus={syncStatus} onSignOut={handleSignOut} userInfo={userInfo}/></div></div>)}
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
