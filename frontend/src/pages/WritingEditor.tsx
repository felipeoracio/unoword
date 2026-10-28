import WritingTour from "@/components/onboarding/WritingTour";
import WritingTask from "@/components/WritingTask";
import { useEffect, useRef, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { generateJSON } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  ArrowRight,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Link2,
  Minus,
  Undo2,
  Redo2,
  Plus,
  Search,
  FileText,
  FolderPlus,
  Star,
  Archive,
  Trash2,
  PanelLeft,
  Sparkles,
  Maximize2,
  Minimize2,
  Moon,
  Sun,
  Download,
  Upload,
  X,
  RefreshCw,
  Copy,
  Check,
  WifiOff,
  Settings2,
} from "lucide-react";
import Brand from "@/components/marketing/Brand";
import { apiGet, apiPost, apiPut, apiPatch, ApiError } from "@/lib/api";
import { useWritingWorkspace } from "@/lib/use-writing-workspace";
import { useAIUsage } from "@/lib/use-ai-usage";
import {
  EMPTY_DOCUMENT,
  fetchDocumentIndex,
  writingEngine,
  writingDates,
  writingHistory,
  writingProgress,
  prompts,
  editorError,
  type Activity,
  type AssistantItem,
} from "@/lib/writing";
import { cacheDelete } from "@/lib/writing-cache";
import { toMarkdown } from "@/lib/writing-markdown";
import "@/styles/writing-editor.css";

const spanish: Record<string, string> = {
  "Your writing space": "Tu espacio de escritura",
  "Every idea starts with UnoWord.": "Cada idea empieza con UnoWord.",
  Library: "Biblioteca",
  "New document": "Nuevo documento",
  "New folder": "Nueva carpeta",
  "Search your writing": "Buscar en tus textos",
  "All documents": "Todos los documentos",
  Favorites: "Favoritos",
  Archive: "Archivo",
  Trash: "Papelera",
  Folders: "Carpetas",
  Untitled: "Sin título",
  "Open library": "Abrir biblioteca",
  "Close library": "Cerrar biblioteca",
  "Writing assistant": "Asistente de escritura",
  "Close assistant": "Cerrar asistente",
  "Enter focus mode": "Activar modo concentración",
  "Exit focus mode": "Salir del modo concentración",
  "Dark theme": "Tema oscuro",
  "Light theme": "Tema claro",
  "Words in document": "Palabras del documento",
  "Total written": "Total escrito",
  "Session words": "Palabras de la sesión",
  Today: "Hoy",
  Streak: "Racha",
  "Session time": "Tiempo de sesión",
  "words/min": "palabras/min",
  "min read": "min de lectura",
  "Write something that matters to you.": "Escribe sobre algo que te importe.",
  "A little space for your next idea.": "Un espacio para tu próxima idea.",
  "Create a document": "Crear un documento",
  "No documents here yet.": "Todavía no hay documentos aquí.",
  "No matching documents.": "No hay documentos que coincidan.",
  "Quick Prompt": "Sugerencia rápida",
  "Another prompt": "Otra sugerencia",
  "Start with a question, follow a thought, see where it takes you.":
    "Empieza con una pregunta, sigue una idea y descubre a dónde te lleva.",
  "What should I write next?": "¿Qué debería escribir ahora?",
  "Continue writing": "Continuar escribiendo",
  "Overcome writer’s block": "Superar el bloqueo",
  "Brainstorm ideas": "Lluvia de ideas",
  "Improve selected text": "Mejorar el texto seleccionado",
  "Share this draft and selected text for this AI request.":
    "Compartir este borrador y el texto seleccionado para esta solicitud de IA.",
  "AI only reads this draft when you ask. Suggestions never replace your words automatically.":
    "La IA solo lee este borrador cuando lo solicitas. Nunca sustituye tus palabras automáticamente.",
  Generate: "Generar",
  "Thinking…": "Pensando…",
  "Add to document": "Añadir al documento",
  "Apply to selection": "Aplicar a la selección",
  "My Writing Profile": "Mi perfil de escritura",
  "What do you want to write?": "¿Sobre qué quieres escribir?",
  "Main topics": "Temas principales",
  Interests: "Intereses",
  "Current projects": "Proyectos actuales",
  "Writing style": "Estilo de escritura",
  "Who are you writing for?": "¿Para quién escribes?",
  "Topics to avoid": "Temas que prefieres evitar",
  "Anything else your writing companion should know?":
    "¿Qué más debería saber tu compañero de escritura?",
  "Writing knowledge": "Conocimiento de escritura",
  "Manage personalization": "Gestionar personalización",
  "Personalized assistance is included in Pro.":
    "La asistencia personalizada está incluida en Pro.",
  "View plans": "Ver planes",
  "Your writing workspace is a Pro feature":
    "Tu espacio de escritura es una función Pro",
  "Upgrade to Pro to use the writing editor and document library. Your existing documents and local drafts are preserved.":
    "Mejora a Pro para usar el editor de escritura y la biblioteca de documentos. Tus documentos y borradores locales se conservan.",
  "View Pro plans": "Ver planes Pro",
  "Back to home": "Volver al inicio",
  "AI needs an internet connection.": "La IA necesita conexión a internet.",
  "Use this document for future AI personalization":
    "Usar este documento para personalizar futuras sugerencias",
  "Restore document": "Restaurar documento",
  "Move to trash": "Mover a la papelera",
  "Duplicate document": "Duplicar documento",
  "Move to archive": "Archivar documento",
  Export: "Exportar",
  Import: "Importar",
  "Rename document": "Renombrar documento",
  "Daily goal": "Meta diaria",
  "Refresh / retry sync": "Actualizar / reintentar sincronización",
  "Different versions found": "Se encontraron versiones diferentes",
  "Your local draft": "Tu borrador local",
  "Version saved elsewhere": "Versión guardada en otro lugar",
  "Keep both copies": "Conservar ambas copias",
  "Use cloud version": "Usar versión de la nube",
  Cancel: "Cancelar",
  "Save profile": "Guardar perfil",
  "Recovered drafts": "Borradores recuperados",
  "Recover as a new document": "Recuperar como documento nuevo",
  "Keep writing offline": "Seguir escribiendo sin conexión",
  "Sign in to write": "Inicia sesión para escribir",
  "Your documents belong to your account. Sign in to open your writing space.":
    "Tus documentos pertenecen a tu cuenta. Inicia sesión para abrir tu espacio de escritura.",
  Created: "Creado",
  Modified: "Modificado",
  "Document folder": "Carpeta del documento",
  "No folder": "Sin carpeta",
  Account: "Cuenta",
  Language: "Idioma",
  "All changes saved": "Todos los cambios guardados",
  "Saving to your account…": "Guardando en tu cuenta…",
  "Saving on this device…": "Guardando en este dispositivo…",
  "Saved on this device · syncing…":
    "Guardado en este dispositivo · sincronizando…",
  "Saved on this device · offline":
    "Guardado en este dispositivo · sin conexión",
  "Offline · saved on this device":
    "Sin conexión · guardado en este dispositivo",
  "Saved on this device · sync paused":
    "Guardado en este dispositivo · sincronización pausada",
};
type Profile = Record<string, unknown> & {
  ai_preferences?: Record<string, unknown>;
};
type Source = {
  id: string;
  document_title: string;
  enabled: boolean;
  source_kind: string;
  processing_status?: string;
  processing_phase?: string;
  processing_progress?: number;
};
const profileFields = [
  ["writing_goal", "What do you want to write?", false],
  ["primary_topics", "Main topics", true],
  ["favorite_subjects", "Interests", true],
  ["current_projects", "Current projects", true],
  ["writing_style", "Writing style", false],
  ["audience", "Who are you writing for?", false],
  ["avoid_topics", "Topics to avoid", true],
  [
    "personal_context",
    "Anything else your writing companion should know?",
    false,
  ],
] as const;
const toPlain = (content: JSONContent): string =>
  content.type === "text"
    ? content.text || ""
    : (content.content || [])
        .map(toPlain)
        .join(
          [
            "doc",
            "bulletList",
            "orderedList",
            "listItem",
            "blockquote",
          ].includes(content.type || "")
            ? "\n"
            : "",
        );

export default function WritingEditor() {
  const ws = useWritingWorkspace();
  const recheckIdentity = ws.recheckIdentity;
  const userId = ws.user?.id;
  const aiUsage = useAIUsage(userId, Boolean(ws.user?.ai_access && ws.online));
  const usage =
    ws.online &&
    !aiUsage.isError &&
    aiUsage.data?.date === new Date().toISOString().slice(0, 10)
      ? aiUsage.data
      : null;
  const [language, setLanguage] = useState(
    () =>
      localStorage.getItem("uno-writing-language") ||
      (navigator.language.startsWith("es") ? "es" : "en"),
  );
  const t = (text: string) =>
    language === "es" ? spanish[text] || text : text;
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem("uno-writing-theme") ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  );
  const [focus, setFocus] = useState(false),
    [left, setLeft] = useState(false),
    [right, setRight] = useState(false);
  const [filter, setFilter] = useState("active"),
    [search, setSearch] = useState("");
  const [serverMatches, setServerMatches] = useState<Set<string> | null>(null);
  const [goal, setGoal] = useState(250),
    [timeZone, setTimeZone] = useState(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  const [now, setNow] = useState(Date.now());
  const [extensionSessions, setExtensionSessions] = useState<
    { id: string; startedAt: number; typedWords: number }[]
  >([]);
  const [quickPrompt, setQuickPrompt] = useState(""),
    [quickHistory, setQuickHistory] = useState<string[]>([]);
  const [action, setAction] = useState("next"),
    [consent, setConsent] = useState(false),
    [aiBusy, setAiBusy] = useState(false);
  const [aiItems, setAiItems] = useState<AssistantItem[]>([]),
    [aiError, setAiError] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null),
    [profileOpen, setProfileOpen] = useState(false),
    [profileBusy, setProfileBusy] = useState(false);
  const [profileEdits, setProfileEdits] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Source[]>([]),
    [sourcesOpen, setSourcesOpen] = useState(false);
  const [sourceBusy, setSourceBusy] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!sourcesOpen || !userId || !ws.online || !ws.user?.ai_access) return;
    let cancelled = false;
    const refresh = async () => {
      if (
        document.hidden ||
        !sources.some((source) =>
          ["pending", "processing"].includes(source.processing_status || ""),
        )
      )
        return;
      try {
        await apiPost("/processing/run", {});
        const fresh = await apiGet<Source[]>("/workspace/sources");
        if (cancelled) return;
        setSources((current) =>
          current.map((source) => {
            const status = fresh.find((item) => item.id === source.id);
            return status
              ? {
                  ...source,
                  processing_status: status.processing_status,
                  processing_phase: status.processing_phase,
                  processing_progress: status.processing_progress,
                }
              : source;
          }),
        );
      } catch {
        /* Pending sources remain private and can resume after reconnect. */
      }
    };
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sourcesOpen, userId, ws.online, ws.user?.ai_access, sources]);
  const [linkOpen, setLinkOpen] = useState(false),
    [linkHref, setLinkHref] = useState("");
  const [newFolderOpen, setNewFolderOpen] = useState(false),
    [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const [folderBusy, setFolderBusy] = useState(false);
  const [toolbarVersion, setToolbarVersion] = useState(0);
  const activeDocument = ws.documents.find((d) => d.id === ws.selected) || null;
  const draftRef = useRef(activeDocument);
  draftRef.current = activeDocument;
  const updateRef = useRef(ws.update);
  updateRef.current = ws.update;
  const recordRef = useRef(ws.recordActivity);
  recordRef.current = ws.recordActivity;
  const session = useRef<Activity | null>(null),
    lastInput = useRef(0),
    activeSeconds = useRef(0);
  const inputKind = useRef("insertText"),
    loadedDocument = useRef("");
  const selectedForAI = useRef<{
    id: string;
    from: number;
    to: number;
    text: string;
    fingerprint: string;
  } | null>(null);
  const aiOwner = useRef<string | null>(null);
  const aiRequest = useRef(0);
  const ownerRef = useRef(ws.user?.id);
  ownerRef.current = ws.user?.id;
  const profileDialog = useRef<HTMLDialogElement>(null),
    linkDialog = useRef<HTMLDialogElement>(null),
    folderDialog = useRef<HTMLDialogElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const resizeTitle = () => {
      const input = titleInput.current;
      if (input) {
        input.style.height = "auto";
        input.style.height = `${input.scrollHeight}px`;
      }
    };
    resizeTitle();
    window.addEventListener("resize", resizeTitle);
    return () => window.removeEventListener("resize", resizeTitle);
  }, [activeDocument?.id, activeDocument?.title, right, focus]);

  const [tourObservation, setTourObservation] = useState({
    sequence: 0,
    text: "",
    documentId: "",
    words: 0,
  });
  function saveWritingGoal(value: number) {
    const next = Math.max(1, Math.min(1000000, value || 1));
    setGoal(next);
    if (ws.user)
      localStorage.setItem(`uno-writing-goal:${ws.user.id}`, String(next));
    window.dispatchEvent(
      new CustomEvent("unoword-tour-action", { detail: "writing_goal_set" }),
    );
  }
  function recordEdit(before: string, after: string, kind: string) {
    const document = draftRef.current;
    if (!document || document.status !== "active") return;
    if (
      before !== after &&
      kind.startsWith("insert") &&
      !["insertFromPaste", "insertFromDrop"].includes(kind)
    ) {
      setTourObservation((value) => ({
        sequence: value.sequence + 1,
        text: after,
        documentId: document.id,
        words: writingEngine.countWords(after),
      }));
    }
    const delta = writingEngine.classifyDelta(before, after, kind);
    if (!delta) return;
    const timestamp = Date.now();
    if (
      !session.current ||
      session.current.document_id !== document.id ||
      writingDates.dayKey(Date.parse(session.current.started_at), timeZone) !==
        writingDates.dayKey(timestamp, timeZone)
    ) {
      session.current = {
        id: crypto.randomUUID(),
        document_id: document.id,
        started_at: new Date(timestamp).toISOString(),
        typed_words: 0,
        pasted_words: 0,
        duration_seconds: 0,
        sequence: 0,
      };
      activeSeconds.current = 0;
    }
    const next = writingEngine.applyDelta(
      {
        typedWords: session.current.typed_words,
        pastedWords: session.current.pasted_words,
      },
      delta,
    );
    session.current = {
      ...session.current,
      typed_words: next.typedWords,
      pasted_words: next.pastedWords,
      duration_seconds: Math.floor(activeSeconds.current),
      sequence: session.current.sequence + 1,
    };
    lastInput.current = timestamp;
    void recordRef.current(session.current);
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        code: false,
        codeBlock: false,
        link: {
          openOnClick: false,
          protocols: ["http", "https", "mailto"],
          HTMLAttributes: { rel: "noopener noreferrer" },
        },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: EMPTY_DOCUMENT,
    editorProps: {
      attributes: {
        class: "uw-writing-canvas",
        "data-tour": "canvas",
        "aria-label": "Document content",
        role: "textbox",
        "aria-multiline": "true",
        spellcheck: "true",
      },
      handleDOMEvents: {
        beforeinput: (_view, event) => {
          inputKind.current = (event as InputEvent).inputType || "insertText";
          return false;
        },
        paste: () => {
          inputKind.current = "insertFromPaste";
          return false;
        },
        drop: () => {
          inputKind.current = "insertFromDrop";
          return false;
        },
      },
    },
    onUpdate: ({ editor, transaction }) => {
      const document = draftRef.current;
      if (!document || document.status !== "active") return;
      const oldText = transaction.before.textBetween(
        0,
        transaction.before.content.size,
        "\n",
      );
      const text = editor.getText({ blockSeparator: "\n" });
      updateRef.current(document.id, {
        content: editor.getJSON(),
        plain_text: text,
      });
      recordEdit(oldText, text, inputKind.current);
      inputKind.current = "insertText";
    },
    onSelectionUpdate: () => setToolbarVersion((version) => version + 1),
    onTransaction: () => setToolbarVersion((version) => version + 1),
  });

  useEffect(() => {
    if (!editor) return;
    if (!activeDocument) {
      loadedDocument.current = "";
      return;
    }
    if (activeDocument.content_loaded === false) return;
    // Never reset selection/undo history on each autosave response.
    const storedContent = editor.schema.nodeFromJSON(activeDocument.content);
    if (
      loadedDocument.current !== activeDocument.id ||
      !editor.state.doc.eq(storedContent)
    ) {
      editor.commands.setContent(activeDocument.content, { emitUpdate: false });
      if (loadedDocument.current !== activeDocument.id) {
        session.current = null;
        activeSeconds.current = 0;
      }
      loadedDocument.current = activeDocument.id;
    }
    // Tiptap emits an update by default even if editable did not change. That
    // would create an autosave/render loop and continually reset the debounce.
    editor.setEditable(activeDocument.status === "active", false);
  }, [editor, activeDocument]);

  useEffect(() => {
    localStorage.setItem("uno-writing-language", language);
    localStorage.setItem("uno-writing-theme", theme);
  }, [language, theme]);
  useEffect(() => {
    setExtensionSessions([]);
    const receive = (event: MessageEvent) => {
      if (
        event.origin === location.origin &&
        event.source === window &&
        event.data?.type === "UNO_WORD_ACCOUNT_CHANGED"
      ) {
        void recheckIdentity();
        return;
      }
      if (
        event.origin !== location.origin ||
        event.source !== window ||
        event.data?.type !== "UNO_WORD_LOCAL_PROGRESS" ||
        event.data.ownerId !== ownerRef.current ||
        !Array.isArray(event.data.sessions)
      )
        return;
      setExtensionSessions(
        event.data.sessions
          .slice(0, 500)
          .filter(
            (row: { startedAt?: unknown; typedWords?: unknown }) =>
              typeof row.startedAt === "number" &&
              Number.isFinite(row.startedAt) &&
              typeof row.typedWords === "number" &&
              row.typedWords >= 0,
          ),
      );
    };
    window.addEventListener("message", receive);
    window.postMessage(
      { type: "UNO_WORD_REQUEST_LOCAL_PROGRESS" },
      location.origin,
    );
    return () => window.removeEventListener("message", receive);
  }, [ws.user?.id, recheckIdentity]);
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker
      .register("/writing-sw.js")
      .then(async () => {
        const registration = await navigator.serviceWorker.ready;
        if (cancelled) return;
        const assets = [
          ...performance
            .getEntriesByType("resource")
            .map((resource) => resource.name),
          ...Array.from(
            document.querySelectorAll<HTMLScriptElement>("script[src]"),
            (script) => script.src,
          ),
          ...Array.from(
            document.querySelectorAll<HTMLLinkElement>(
              'link[rel="stylesheet"]',
            ),
            (link) => link.href,
          ),
          location.origin + "/editor",
        ];
        registration.active?.postMessage({
          type: "CACHE_EDITOR_ASSETS",
          urls: assets,
        });
      })
      .catch(() => {
        /* Loaded documents still work offline without a shell cache. */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!userId || !ws.user?.ai_access) {
      setAiItems([]);
      setProfile(null);
      setSources([]);
      return;
    }
    const owner = userId;
    const params = new URLSearchParams(location.search);
    const storedGoal = Number(
      localStorage.getItem(`uno-writing-goal:${owner}`),
    );
    setGoal(Math.max(1, Number(params.get("goal")) || storedGoal || 250));
    try {
      const tz = params.get("timezone");
      if (tz) {
        new Intl.DateTimeFormat("en", { timeZone: tz }).format();
        setTimeZone(tz);
      }
    } catch {
      /* use device timezone */
    }
    if (!ws.online) return;
    apiGet<Profile>("/ai/profile")
      .then((value) => {
        if (ownerRef.current === owner) setProfile(value);
      })
      .catch(() => {});
    if (!params.get("goal") && !storedGoal)
      apiGet<{ daily_goal: number }>("/workspace/config")
        .then((config) => {
          if (ownerRef.current === owner) setGoal(config.daily_goal);
        })
        .catch(() => {});
  }, [userId, ws.online, ws.user?.ai_access]);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      if (
        !session.current ||
        !document.hasFocus() ||
        Date.now() - lastInput.current > 60000 ||
        !editor?.isFocused
      )
        return;
      activeSeconds.current = Math.min(86400, activeSeconds.current + 1);
      if (Math.floor(activeSeconds.current) % 10 === 0) {
        session.current = {
          ...session.current,
          duration_seconds: Math.floor(activeSeconds.current),
          sequence: session.current.sequence + 1,
        };
        void recordRef.current(session.current);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [editor]);
  useEffect(() => {
    aiRequest.current++;
    setAiBusy(false);
    setAiItems([]);
    setAiError("");
    setConsent(false);
    selectedForAI.current = null;
  }, [ws.selected]);
  useEffect(() => {
    if (profileOpen) profileDialog.current?.showModal();
    else profileDialog.current?.close();
  }, [profileOpen]);
  useEffect(() => {
    if (linkOpen) linkDialog.current?.showModal();
    else linkDialog.current?.close();
  }, [linkOpen]);
  useEffect(() => {
    if (newFolderOpen) folderDialog.current?.showModal();
    else folderDialog.current?.close();
  }, [newFolderOpen]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFocus(false);
        setLeft(false);
        setRight(false);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setServerMatches(null);
    if (!search.trim() || !ws.online || !userId) return;
    const owner = userId;
    const timeout = setTimeout(async () => {
      try {
        const found = await fetchDocumentIndex(search);
        if (!cancelled && ownerRef.current === owner)
          setServerMatches(new Set(found.map((document) => document.id)));
      } catch {
        /* Cached content search remains available. */
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [search, ws.online, userId]);

  const filtered = useMemo(
    () =>
      ws.documents
        .filter((d) => {
          const matching =
            filter === "favorites"
              ? d.favorite && d.status === "active"
              : filter.startsWith("folder:")
                ? d.folder_id === filter.slice(7) && d.status === "active"
                : d.status === filter;
          return (
            matching &&
            (serverMatches?.has(d.id) ||
              `${d.title}\n${d.plain_text}`
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase()))
          );
        })
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [ws.documents, search, filter, serverMatches],
  );
  const progressSessions = [
    ...ws.activities.map((a) => ({
      id: `editor:${a.id}`,
      startedAt: Date.parse(a.started_at),
      typedWords: a.typed_words,
    })),
    ...extensionSessions,
  ];
  const todayWords = writingProgress.total(progressSessions, now, timeZone);
  const streak = writingHistory.computeStreak(
    [
      ...extensionSessions,
      ...ws.activities.map((a) => ({
        typedWords: a.typed_words,
        startedAt: Date.parse(a.started_at),
      })),
    ],
    timeZone,
    now,
  );
  const totalWords = writingEngine.countWords(activeDocument?.plain_text || "");
  const totalWritten = ws.activities.reduce((sum, a) => sum + a.typed_words, 0);
  const sessionWords = session.current?.typed_words || 0;
  const seconds = Math.floor(activeSeconds.current);
  const conflict = activeDocument && ws.conflicts[activeDocument.id];

  async function generate() {
    if (!ws.user || !activeDocument || !editor || !consent || aiBusy) return;
    const request = ++aiRequest.current;
    const owner = ws.user.id,
      id = activeDocument.id;
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (action === "improve" && !text.trim()) {
      setAiError(t("Select a passage to improve first."));
      return;
    }
    selectedForAI.current = {
      id,
      from,
      to,
      text,
      fingerprint: JSON.stringify(editor.getJSON()),
    };
    aiOwner.current = owner;
    setAiBusy(true);
    setAiError("");
    setAiItems([]);
    try {
      const progressTime = Date.now();
      const result = await apiPost<{ items: AssistantItem[] }>(
        "/workspace/assistant",
        {
          expected_user_id: owner,
          document_id: id,
          action,
          consent,
          current_text: editor.getText({ blockSeparator: "\n" }),
          selected_text: action === "improve" ? text : "",
          language,
          writing_progress: writingProgress.snapshot(
            goal,
            writingProgress.total(progressSessions, progressTime, timeZone),
            timeZone,
            progressTime,
          ),
        },
      );
      if (
        request !== aiRequest.current ||
        ownerRef.current !== owner ||
        draftRef.current?.id !== id
      )
        return;
      setAiItems(result.items);
    } catch (failure) {
      if (
        request === aiRequest.current &&
        ownerRef.current === owner &&
        draftRef.current?.id === id
      )
        setAiError(editorError(failure));
    } finally {
      if (ownerRef.current === owner) void aiUsage.refetch();
      if (request === aiRequest.current) setAiBusy(false);
    }
  }
  function applyItem(item: AssistantItem) {
    if (!editor || !activeDocument || ownerRef.current !== aiOwner.current)
      return;
    if (action === "improve" && item.replacement) {
      const selected = selectedForAI.current;
      if (
        !selected ||
        selected.id !== activeDocument.id ||
        selected.to > editor.state.doc.content.size ||
        selected.from >= selected.to ||
        selected.fingerprint !== JSON.stringify(editor.getJSON()) ||
        editor.state.doc.textBetween(
          selected.from,
          Math.min(selected.to, editor.state.doc.content.size),
          "\n",
        ) !== selected.text
      ) {
        setAiError(
          "The selected passage changed. Select it again and generate a fresh suggestion.",
        );
        return;
      }
      inputKind.current = "insertFromPaste";
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from: selected.from, to: selected.to },
          { type: "text", text: item.replacement },
        )
        .run();
      selectedForAI.current = null;
    } else {
      inputKind.current = "insertFromPaste";
      // Insert plain text as a paragraph. AI output is never interpreted as HTML.
      editor
        .chain()
        .focus()
        .insertContentAt(editor.state.doc.content.size, {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: item.replacement || `${item.title}\n${item.text}`,
            },
          ],
        })
        .run();
    }
  }
  function anotherPrompt() {
    const themes = profile?.ai_preferences?.prompt_themes;
    const picked = prompts.pickPrompt(
      Array.isArray(themes) && themes.length ? themes : ["ideas"],
      language,
      quickHistory,
    );
    setQuickPrompt(picked.text);
    window.dispatchEvent(
      new CustomEvent("unoword-tour-action", { detail: "suggestion_explored" }),
    );
    setQuickHistory((all) => [picked.id, ...all].slice(0, 12));
  }
  async function importFile(file: File) {
    const owner = ws.user?.id;
    if (!owner) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new ApiError(413, {});
      // TXT/Markdown work offline; DOCX uses the existing bounded server parser.
      let title = file.name.replace(/\.[^.]+$/, ""),
        content: JSONContent;
      if (/\.(txt|md|markdown)$/i.test(file.name)) {
        const text = await file.text();
        if (text.length > 200000) throw new ApiError(413, {});
        if (/\.txt$/i.test(file.name))
          content = {
            type: "doc",
            content: text.split(/\r?\n/).map((line) => ({
              type: "paragraph",
              ...(line ? { content: [{ type: "text", text: line }] } : {}),
            })),
          };
        else {
          const html = DOMPurify.sanitize(
            await marked.parse(text, { async: false }),
            {
              ALLOWED_TAGS: [
                "p",
                "h1",
                "h2",
                "h3",
                "strong",
                "b",
                "em",
                "i",
                "u",
                "s",
                "del",
                "ul",
                "ol",
                "li",
                "blockquote",
                "a",
                "hr",
                "br",
              ],
              ALLOWED_ATTR: ["href", "start"],
            },
          );
          // Tiptap parses supported schema nodes only; no raw HTML is rendered.
          content = generateJSON(html, editor!.extensionManager.extensions);
        }
      } else {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/workspace/import", {
          method: "POST",
          body: form,
        });
        if (!response.ok)
          throw new ApiError(response.status, await response.json());
        const result = await response.json();
        title = result.title;
        content = result.content;
      }
      if (ownerRef.current !== owner) return;
      await ws.create(title, { content, plain_text: toPlain(content) });
      setFilter("active");
    } catch (failure) {
      ws.setError(editorError(failure));
    }
  }
  async function exportFile(format: string) {
    if (!activeDocument || !editor) return;
    try {
      // Text and Markdown exports use the latest editor content, including offline edits.
      let blob: Blob;
      if (format === "txt")
        blob = new Blob([editor.getText({ blockSeparator: "\n\n" })], {
          type: "text/plain;charset=utf-8",
        });
      else if (format === "md") {
        blob = new Blob([toMarkdown(editor.getJSON())], {
          type: "text/markdown;charset=utf-8",
        });
      } else {
        // Export unsynced content directly: do not accidentally export an older cloud revision.
        const response = await fetch(`/api/workspace/export/${format}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expected_user_id: ws.user!.id,
            title: activeDocument.title,
            content: editor.getJSON(),
          }),
        });
        if (!response.ok)
          throw new ApiError(response.status, await response.json());
        blob = await response.blob();
      }
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      const filename =
        Array.from(activeDocument.title)
          .map((character) =>
            '<>:"/\\|?*'.includes(character) || character.codePointAt(0)! < 32
              ? "_"
              : character,
          )
          .join("") || "document";
      anchor.download = `${filename}.${format}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      ws.setError(editorError(failure));
    }
  }
  async function saveProfile() {
    if (!profile || !ws.user) return;
    const owner = ws.user.id;
    setProfileBusy(true);
    try {
      const changes = Object.fromEntries(
        profileFields.map(([key, _label, list]) => [
          key,
          list
            ? (profileEdits[key] || "")
                .split(/[,\n]/)
                .map((value) => value.trim())
                .filter(Boolean)
            : profileEdits[key] || "",
        ]),
      );
      const saved = await apiPut<Profile>("/ai/profile", {
        ...profile,
        ...changes,
        ai_preferences: {
          ...profile.ai_preferences,
          prompt_themes: (profileEdits.prompt_themes || "")
            .split(/[,\n]/)
            .map((value) => value.trim())
            .filter(Boolean),
        },
        expected_user_id: owner,
      });
      if (ownerRef.current === owner) {
        setProfile(saved);
        setProfileOpen(false);
      }
    } catch (failure) {
      ws.setError(editorError(failure));
    } finally {
      setProfileBusy(false);
    }
  }
  async function openSources() {
    if (!ws.user) return;
    const owner = ws.user.id;
    setSourcesOpen(!sourcesOpen);
    try {
      const items = await apiGet<Source[]>("/workspace/sources");
      if (ownerRef.current === owner) setSources(items);
    } catch (failure) {
      setAiError(editorError(failure));
    }
  }
  function toolbarButton(
    label: string,
    icon: React.ReactNode,
    run: () => void,
    selected = false,
  ) {
    return (
      <button
        type="button"
        disabled={activeDocument?.status !== "active"}
        aria-label={label}
        title={label}
        aria-pressed={selected}
        onMouseDown={(event) => event.preventDefault()}
        onClick={run}
      >
        {icon}
      </button>
    );
  }

  if (ws.loading)
    return (
      <main className="uw-writing-gate" role="status">
        Opening your writing space…
      </main>
    );
  if (!ws.user)
    return (
      <main className="uw-writing-gate">
        <Brand />
        <h1>{t("Sign in to write")}</h1>
        <p>
          {t(
            "Your documents belong to your account. Sign in to open your writing space.",
          )}
        </p>
        {ws.error && <p role="alert">{ws.error}</p>}
        <Link to="/account?next=%2Feditor">
          {t("Sign in to write")} <ArrowRight size={16} />
        </Link>
        <Link to="/">UnoWord</Link>
      </main>
    );

  if (!ws.user.ai_access)
    return (
      <main className="uw-writing-gate">
        <Brand />
        <h1>{t("Your writing workspace is a Pro feature")}</h1>
        <p>
          {t(
            "Upgrade to Pro to use the writing editor and document library. Your existing documents and local drafts are preserved.",
          )}
        </p>
        <Link to="/account?plan=pro">
          {t("View Pro plans")} <ArrowRight size={16} />
        </Link>
        <Link to="/">{t("Back to home")}</Link>
      </main>
    );

  return (
    <main
      className={`uw-editor ${focus ? "uw-editor-focus" : ""}`}
      data-theme={theme}
      lang={language}
      data-testid="writing-workspace"
    >
      <header className="uw-editor-header">
        <div className="uw-editor-header-brand">
          <Brand />
          <span className="uw-editor-divider" />
          <span className="uw-editor-workspace-label">
            {t("Your writing space")}
          </span>
        </div>
        <div className="uw-editor-header-actions">
          <span className="uw-editor-save" role="status" aria-live="polite">
            {!ws.online ? <WifiOff size={14} /> : <Check size={14} />}
            {t(ws.status)}
          </span>
          <button
            className="uw-editor-icon"
            title={t("Refresh / retry sync")}
            aria-label={t("Refresh / retry sync")}
            onClick={() => ws.sync()}
          >
            <RefreshCw size={17} />
          </button>
          <button
            className="uw-editor-icon"
            aria-label={t(theme === "dark" ? "Light theme" : "Dark theme")}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <select
            className="uw-editor-language"
            aria-label={t("Language")}
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="en">EN</option>
            <option value="es">ES</option>
          </select>
          <Link className="uw-editor-account" to="/account">
            {ws.user.email?.slice(0, 1).toUpperCase() || "U"}
            <span className="uw-sr-only">{t("Account")}</span>
          </Link>
        </div>
      </header>
      {ws.error && (
        <div className="uw-editor-notice" role="alert">
          <span>{ws.error}</span>
          <button onClick={() => ws.setError("")} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}
      <div className="uw-editor-layout">
        {!focus && (
          <aside
            className={`uw-editor-library ${left ? "is-open" : ""}`}
            aria-label={t("Library")}
          >
            <div className="uw-editor-sidebar-heading">
              <span>{t("Library")}</span>
              <button
                className="uw-editor-icon uw-mobile-only"
                onClick={() => setLeft(false)}
                aria-label={t("Close library")}
              >
                <X size={18} />
              </button>
            </div>
            <button
              className="uw-editor-primary"
              onClick={() => {
                void ws.create(t("Untitled"));
                setFilter("active");
                setLeft(false);
              }}
            >
              <Plus size={17} />
              {t("New document")}
            </button>
            <label className="uw-editor-search">
              <Search size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("Search your writing")}
                aria-label={t("Search your writing")}
              />
            </label>
            <nav className="uw-editor-filters" aria-label="Document filters">
              {[
                [
                  "active",
                  "All documents",
                  <FileText key="active" size={16} />,
                ],
                ["favorites", "Favorites", <Star key="favorites" size={16} />],
                ["archived", "Archive", <Archive key="archived" size={16} />],
                ["trashed", "Trash", <Trash2 key="trashed" size={16} />],
              ].map(([value, label, icon]) => (
                <button
                  key={value as string}
                  aria-current={filter === value ? "page" : undefined}
                  onClick={() => setFilter(value as string)}
                >
                  {icon}
                  {t(label as string)}
                  <span>
                    {
                      ws.documents.filter((d) =>
                        value === "favorites"
                          ? d.favorite && d.status === "active"
                          : d.status === value,
                      ).length
                    }
                  </span>
                </button>
              ))}
            </nav>
            <div className="uw-editor-folder-heading">
              <span>{t("Folders")}</span>
              <button
                className="uw-editor-icon"
                onClick={() => {
                  setFolderError("");
                  setNewFolderOpen(true);
                }}
                aria-label={t("New folder")}
              >
                <FolderPlus size={16} />
              </button>
            </div>
            {ws.folders.map((folder) => (
              <button
                className="uw-editor-folder"
                key={folder.id}
                aria-pressed={filter === `folder:${folder.id}`}
                onClick={() => setFilter(`folder:${folder.id}`)}
              >
                <span>▱</span>
                {folder.name}
              </button>
            ))}
            <div className="uw-editor-document-list" aria-label="Documents">
              {filtered.map((d) => (
                <button
                  className="uw-editor-document"
                  key={d.id}
                  aria-current={d.id === ws.selected ? "page" : undefined}
                  onClick={() => {
                    ws.setSelected(d.id);
                    setLeft(false);
                  }}
                >
                  <span>
                    {d.favorite ? <Star size={14} /> : <FileText size={14} />}
                    <strong>{d.title}</strong>
                    {d.dirty && <i aria-label="Unsynced changes" />}
                  </span>
                  <small>
                    {d.plain_text.trim().slice(0, 65) ||
                      t("A little space for your next idea.")}
                  </small>
                  <time dateTime={d.updated_at}>
                    {new Date(d.updated_at).toLocaleDateString(language)}
                  </time>
                </button>
              ))}
              {!filtered.length && (
                <p className="uw-editor-muted">
                  {t(
                    search
                      ? "No matching documents."
                      : "No documents here yet.",
                  )}
                </p>
              )}
            </div>
            {ws.recovery.length > 0 && (
              <details className="uw-editor-recovery">
                <summary>
                  {t("Recovered drafts")} ({ws.recovery.length})
                </summary>
                {ws.recovery.map((d) => (
                  <button
                    key={`${d.tab_id}:${d.id}`}
                    onClick={async () => {
                      await ws.create(`${d.title} (recovered)`, {
                        content: d.content,
                        plain_text: d.plain_text,
                      });
                      await cacheDelete(
                        ws.user!.id,
                        "draft",
                        `${d.tab_id}:${d.id}`,
                      );
                      ws.setRecovery((all) =>
                        all.filter((other) => other !== d),
                      );
                    }}
                  >
                    {t("Recover as a new document")}: {d.title}
                  </button>
                ))}
              </details>
            )}
            <button
              className="uw-editor-import"
              onClick={() => importInput.current?.click()}
            >
              <Upload size={16} />
              {t("Import")} TXT, MD, DOCX
            </button>
            <input
              ref={importInput}
              type="file"
              accept=".txt,.md,.markdown,.docx"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
                event.target.value = "";
              }}
            />
            <p className="uw-editor-tagline">
              {t("Every idea starts with UnoWord.")}
            </p>
          </aside>
        )}
        <section className="uw-editor-main" aria-label="Writing document">
          <div className="uw-editor-document-bar">
            <div>
              <button
                className="uw-editor-icon"
                aria-label={t("Open library")}
                onClick={() => {
                  setFocus(false);
                  setLeft(!left);
                }}
              >
                <PanelLeft size={18} />
              </button>
              <span>{activeDocument?.title || t("Your writing space")}</span>
            </div>
            <div>
              {activeDocument && (
                <>
                  <button
                    className="uw-editor-icon"
                    aria-label={t("Favorites")}
                    aria-pressed={activeDocument.favorite}
                    onClick={() =>
                      ws.update(activeDocument.id, {
                        favorite: !activeDocument.favorite,
                      })
                    }
                  >
                    <Star
                      size={17}
                      fill={activeDocument.favorite ? "currentColor" : "none"}
                    />
                  </button>
                  <details className="uw-editor-export">
                    <summary aria-label={t("Export")}>
                      <Download size={17} />
                      <span>{t("Export")}</span>
                    </summary>
                    <div>
                      {["md", "txt", "docx", "pdf"].map((format) => (
                        <button
                          key={format}
                          onClick={(event) => {
                            event.currentTarget
                              .closest("details")
                              ?.removeAttribute("open");
                            void exportFile(format);
                          }}
                        >
                          {format.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </details>
                </>
              )}
              <button
                className="uw-editor-icon"
                aria-label={t(focus ? "Exit focus mode" : "Enter focus mode")}
                onClick={() => setFocus(!focus)}
              >
                {focus ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              </button>
              <button
                className="uw-editor-assistant-toggle"
                aria-label={t("Writing assistant")}
                aria-expanded={right}
                onClick={() => {
                  setFocus(false);
                  setRight(!right);
                }}
              >
                <Sparkles size={16} />
                <span>{t("Writing assistant")}</span>
              </button>
            </div>
          </div>
          {activeDocument?.content_loaded === false ? (
            <div className="uw-editor-empty" role="status">
              Opening document…
            </div>
          ) : activeDocument ? (
            <>
              {!focus && (
                <div
                  className="uw-editor-toolbar"
                  role="toolbar"
                  aria-label="Text formatting"
                  data-version={toolbarVersion}
                >
                  <select
                    aria-label="Heading level"
                    disabled={activeDocument.status !== "active"}
                    value={
                      editor?.isActive("heading")
                        ? String(editor.getAttributes("heading").level)
                        : "paragraph"
                    }
                    onChange={(event) => {
                      const level = event.target.value;
                      if (level === "paragraph")
                        editor?.chain().focus().setParagraph().run();
                      else
                        editor
                          ?.chain()
                          .focus()
                          .setHeading({ level: Number(level) as 1 | 2 | 3 })
                          .run();
                    }}
                  >
                    <option value="paragraph">
                      {language === "es" ? "Texto" : "Text"}
                    </option>
                    <option value="1">H1</option>
                    <option value="2">H2</option>
                    <option value="3">H3</option>
                  </select>
                  {toolbarButton(
                    "Bold (Ctrl/⌘ B)",
                    <Bold size={16} />,
                    () => editor?.chain().focus().toggleBold().run(),
                    editor?.isActive("bold"),
                  )}
                  {toolbarButton(
                    "Italic (Ctrl/⌘ I)",
                    <Italic size={16} />,
                    () => editor?.chain().focus().toggleItalic().run(),
                    editor?.isActive("italic"),
                  )}
                  {toolbarButton(
                    "Underline (Ctrl/⌘ U)",
                    <Underline size={16} />,
                    () => editor?.chain().focus().toggleUnderline().run(),
                    editor?.isActive("underline"),
                  )}
                  {toolbarButton(
                    "Strikethrough",
                    <Strikethrough size={16} />,
                    () => editor?.chain().focus().toggleStrike().run(),
                    editor?.isActive("strike"),
                  )}
                  <span />
                  {toolbarButton(
                    "Bullet list",
                    <List size={17} />,
                    () => editor?.chain().focus().toggleBulletList().run(),
                    editor?.isActive("bulletList"),
                  )}
                  {toolbarButton(
                    "Numbered list",
                    <ListOrdered size={17} />,
                    () => editor?.chain().focus().toggleOrderedList().run(),
                    editor?.isActive("orderedList"),
                  )}
                  {toolbarButton(
                    "Blockquote",
                    <Quote size={16} />,
                    () => editor?.chain().focus().toggleBlockquote().run(),
                    editor?.isActive("blockquote"),
                  )}
                  {toolbarButton(
                    "Link",
                    <Link2 size={16} />,
                    () => {
                      setLinkHref(editor?.getAttributes("link").href || "");
                      setLinkOpen(true);
                    },
                    editor?.isActive("link"),
                  )}
                  {toolbarButton("Divider", <Minus size={17} />, () =>
                    editor?.chain().focus().setHorizontalRule().run(),
                  )}
                  <span />
                  {toolbarButton(
                    "Align left",
                    <AlignLeft size={16} />,
                    () => editor?.chain().focus().setTextAlign("left").run(),
                    editor?.isActive({ textAlign: "left" }),
                  )}
                  {toolbarButton(
                    "Align center",
                    <AlignCenter size={16} />,
                    () => editor?.chain().focus().setTextAlign("center").run(),
                    editor?.isActive({ textAlign: "center" }),
                  )}
                  {toolbarButton(
                    "Align right",
                    <AlignRight size={16} />,
                    () => editor?.chain().focus().setTextAlign("right").run(),
                    editor?.isActive({ textAlign: "right" }),
                  )}
                  <span />
                  {toolbarButton("Undo (Ctrl/⌘ Z)", <Undo2 size={16} />, () =>
                    editor?.chain().focus().undo().run(),
                  )}
                  {toolbarButton(
                    "Redo (Ctrl/⌘ Shift Z)",
                    <Redo2 size={16} />,
                    () => editor?.chain().focus().redo().run(),
                  )}
                </div>
              )}
              {conflict && (
                <section className="uw-editor-conflict" role="alert">
                  <h2>{t("Different versions found")}</h2>
                  <div>
                    <section>
                      <strong>{t("Your local draft")}</strong>
                      <p>{activeDocument.plain_text.slice(0, 1500)}</p>
                    </section>
                    <section>
                      <strong>{t("Version saved elsewhere")}</strong>
                      <p>{conflict.plain_text.slice(0, 1500)}</p>
                    </section>
                  </div>
                  <button
                    className="uw-editor-primary"
                    onClick={() =>
                      void ws.resolveConflict(activeDocument.id, true)
                    }
                  >
                    {t("Keep both copies")}
                  </button>
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          "Replace this local draft with the cloud version? Export or keep both copies first if you need your edits.",
                        )
                      )
                        void ws.resolveConflict(activeDocument.id, false);
                    }}
                  >
                    {t("Use cloud version")}
                  </button>
                </section>
              )}
              <div className="uw-editor-paper-scroll">
                <article className="uw-editor-paper">
                  <textarea
                    ref={titleInput}
                    rows={1}
                    className="uw-editor-title"
                    aria-label={t("Rename document")}
                    value={activeDocument.title}
                    maxLength={300}
                    readOnly={activeDocument.status !== "active"}
                    onChange={(event) =>
                      ws.update(activeDocument.id, {
                        title: event.target.value,
                      })
                    }
                    placeholder={t("Untitled")}
                  />
                  {!focus && (
                    <div className="uw-editor-document-meta">
                      <span>
                        {t("Modified")}{" "}
                        {new Date(activeDocument.updated_at).toLocaleDateString(
                          language,
                        )}
                      </span>
                      <span>·</span>
                      <span>
                        {t("Created")}{" "}
                        {new Date(activeDocument.created_at).toLocaleDateString(
                          language,
                        )}
                      </span>
                    </div>
                  )}
                  <EditorContent editor={editor} />
                  {!focus && (
                    <div className="uw-editor-document-options">
                      <label>
                        {t("Document folder")}
                        <select
                          value={activeDocument.folder_id || ""}
                          onChange={(event) =>
                            ws.update(activeDocument.id, {
                              folder_id: event.target.value || null,
                            })
                          }
                        >
                          <option value="">{t("No folder")}</option>
                          {ws.folders.map((f) => (
                            <option value={f.id} key={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div>
                        <button
                          onClick={() =>
                            void ws.create(`${activeDocument.title} (copy)`, {
                              content: activeDocument.content,
                              plain_text: activeDocument.plain_text,
                              folder_id: activeDocument.folder_id,
                            })
                          }
                        >
                          <Copy size={14} />
                          {t("Duplicate document")}
                        </button>
                        {activeDocument.status !== "active" ? (
                          <button
                            onClick={() => {
                              ws.update(activeDocument.id, {
                                status: "active",
                              });
                              setFilter("active");
                            }}
                          >
                            {t("Restore document")}
                          </button>
                        ) : (
                          <button
                            onClick={() =>
                              ws.update(activeDocument.id, {
                                status: "archived",
                              })
                            }
                          >
                            <Archive size={14} />
                            {t("Move to archive")}
                          </button>
                        )}
                        {activeDocument.status !== "trashed" && (
                          <button
                            onClick={() => {
                              if (
                                confirm(
                                  language === "es"
                                    ? "¿Mover este documento a la papelera? Puedes restaurarlo después."
                                    : "Move this document to trash? You can restore it later.",
                                )
                              )
                                ws.update(activeDocument.id, {
                                  status: "trashed",
                                  ai_allowed: false,
                                });
                            }}
                          >
                            <Trash2 size={14} />
                            {t("Move to trash")}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              </div>
            </>
          ) : (
            <div className="uw-editor-empty">
              <span className="uw-editor-empty-mark">
                <FileText size={34} />
              </span>
              <p className="uw-editor-eyebrow">
                UnoWord ·{" "}
                {language === "es"
                  ? "TU PRÓXIMO CAPÍTULO"
                  : "YOUR NEXT CHAPTER"}
              </p>
              <h1>{t("Write something that matters to you.")}</h1>
              <p>{t("A little space for your next idea.")}</p>
              <button
                className="uw-editor-primary"
                onClick={() => void ws.create(t("Untitled"))}
              >
                <Plus size={17} />
                {t("Create a document")}
              </button>
              <p className="uw-editor-empty-note">
                {language === "es"
                  ? "Sin prisa. Sin página perfecta. Solo empieza."
                  : "No rush. No perfect first draft. Just begin."}
              </p>
            </div>
          )}
          <footer
            data-tour="stats"
            className="uw-editor-stats"
            aria-label="Writing statistics"
          >
            <div data-tour="words" title={t("Words in document")}>
              <strong>{totalWords.toLocaleString(language)}</strong>{" "}
              {t("Words in document")}
            </div>
            <div
              data-tour="session"
              title="New typed words only; pasted text is excluded"
            >
              <strong>{sessionWords}</strong> {t("Session words")}
            </div>
            <div>
              <strong>
                {todayWords}/{goal}
              </strong>{" "}
              {t("Today")}
            </div>
            <div>
              <strong>{streak}</strong> {t("Streak")}
            </div>
            {!focus && (
              <>
                <div>
                  <strong>
                    {String(Math.floor(seconds / 60)).padStart(2, "0")}:
                    {String(seconds % 60).padStart(2, "0")}
                  </strong>{" "}
                  {t("Session time")}
                </div>
                <div>
                  <strong>
                    {seconds > 0
                      ? Math.round(sessionWords / (seconds / 60))
                      : 0}
                  </strong>{" "}
                  {t("words/min")}
                </div>
                <div>
                  <strong>{Math.ceil(totalWords / 200)}</strong> {t("min read")}
                </div>
              </>
            )}
            {!focus && (
              <div>
                <strong>
                  {totalWritten +
                    extensionSessions.reduce(
                      (sum, session) => sum + session.typedWords,
                      0,
                    )}
                </strong>{" "}
                {t("Total written")}
              </div>
            )}
          </footer>
        </section>
        {!focus && right && (
          <aside
            className="uw-editor-assistant"
            aria-label={t("Writing assistant")}
          >
            <div className="uw-editor-sidebar-heading">
              <span>
                <Sparkles size={18} />
                {t("Writing assistant")}
              </span>
              <button
                className="uw-editor-icon"
                onClick={() => setRight(false)}
                aria-label={t("Close assistant")}
              >
                <X size={17} />
              </button>
            </div>
            <div data-tour="prompt" className="uw-editor-prompt">
              <p className="uw-editor-eyebrow">
                {t("Quick Prompt")} <span>FREE + PRO</span>
              </p>
              <p>
                {quickPrompt ||
                  t(
                    "Start with a question, follow a thought, see where it takes you.",
                  )}
              </p>
              <button data-tour="prompt-action" onClick={anotherPrompt}>
                <RefreshCw size={14} />
                {t("Another prompt")}
              </button>
            </div>
            <div className="uw-editor-ai-intro">
              <span className="uw-editor-pro">PRO</span>
              <h2>
                {language === "es"
                  ? "Tus ideas. Nuevas posibilidades."
                  : "Your ideas. New possibilities."}
              </h2>
              <p>
                {t(
                  "AI only reads this draft when you ask. Suggestions never replace your words automatically.",
                )}
              </p>
            </div>
            {ws.user.ai_access ? (
              <>
                <div
                  className="uw-editor-ai-usage"
                  role="status"
                  aria-live="polite"
                >
                  {usage ? (
                    <>
                      <strong>
                        {language === "es"
                          ? `${usage.used_today} de ${usage.daily_limit} solicitudes de IA usadas · ${usage.remaining} disponibles`
                          : `${usage.used_today} of ${usage.daily_limit} AI requests used · ${usage.remaining} left`}
                      </strong>
                      {usage.pending_today > 0 && (
                        <span>
                          {language === "es"
                            ? `${usage.pending_today} en curso`
                            : `${usage.pending_today} in progress`}
                        </span>
                      )}
                    </>
                  ) : (
                    <strong>
                      {language === "es"
                        ? "Uso de IA no disponible"
                        : "AI usage unavailable"}
                    </strong>
                  )}
                  <span>
                    {language === "es"
                      ? "Compartido con la extensión. Se restablece a medianoche UTC."
                      : "Shared with the extension. Resets at midnight UTC."}
                  </span>
                </div>
                <label className="uw-editor-tool-label">
                  {t("Writing assistant")}
                  <select
                    aria-label="AI writing tool"
                    value={action}
                    onChange={(event) => {
                      aiRequest.current++;
                      setAiBusy(false);
                      setAction(event.target.value);
                      setAiItems([]);
                    }}
                  >
                    {[
                      ["next", "What should I write next?"],
                      ["continue", "Continue writing"],
                      ["block", "Overcome writer’s block"],
                      ["brainstorm", "Brainstorm ideas"],
                      ["improve", "Improve selected text"],
                    ].map(([value, label]) => (
                      <option key={value} value={value}>
                        {t(label)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="uw-editor-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  {t("Share this draft and selected text for this AI request.")}
                </label>
                <button
                  className="uw-editor-primary"
                  disabled={
                    !consent ||
                    !activeDocument ||
                    activeDocument.revision === 0 ||
                    ws.documents.some((document) => document.dirty) ||
                    sourceBusy.size > 0 ||
                    aiBusy ||
                    usage?.remaining === 0 ||
                    !ws.online
                  }
                  onClick={() => void generate()}
                >
                  <Sparkles size={15} />
                  {t(aiBusy ? "Thinking…" : "Generate")}
                </button>
                {ws.documents.some((document) => document.dirty) && (
                  <p className="uw-editor-muted">
                    {language === "es"
                      ? "Sincroniza los cambios pendientes antes de usar la IA."
                      : "Sync pending changes before using AI."}
                  </p>
                )}
                {!ws.online && <p>{t("AI needs an internet connection.")}</p>}
                {aiError && (
                  <p className="uw-editor-ai-error" role="alert">
                    {aiError}
                  </p>
                )}
                <div className="uw-editor-ai-results" aria-live="polite">
                  {aiItems.length > 1 && aiItems.some(item => item.writing_task) && <p className="uw-editor-muted">
                    {language === "es" ? "Elige una dirección. Son alternativas para la misma meta pendiente." : "Choose one direction. These are alternatives for the same remaining goal."}
                  </p>}
                  {aiItems.map((item, index) => (
                    <article key={index}>
                      <h3>{item.title}</h3>
                      <p>{item.text}</p>
                      <WritingTask
                        task={item.writing_task}
                        owner={ws.user!.id}
                        id={item.id || `${index}`}
                        language={language}
                      />
                      {item.replacement && (
                        <blockquote>{item.replacement}</blockquote>
                      )}
                      <button
                        disabled={activeDocument?.status !== "active"}
                        onClick={() => applyItem(item)}
                      >
                        {t(
                          action === "improve"
                            ? "Apply to selection"
                            : "Add to document",
                        )}
                        <ArrowRight size={14} />
                      </button>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="uw-editor-pro-gate">
                <p>{t("Personalized assistance is included in Pro.")}</p>
                <Link to="/account?plan=pro">
                  {t("View plans")}
                  <ArrowRight size={15} />
                </Link>
              </div>
            )}
            <div className="uw-editor-personalize">
              <button
                data-tour="profile"
                onClick={() => {
                  if (!profile) return;
                  const values = Object.fromEntries(
                    profileFields.map(([key, _label, list]) => [
                      key,
                      list
                        ? Array.isArray(profile[key])
                          ? (profile[key] as string[]).join(", ")
                          : ""
                        : String(profile[key] || ""),
                    ]),
                  );
                  values.prompt_themes = Array.isArray(
                    profile.ai_preferences?.prompt_themes,
                  )
                    ? (profile.ai_preferences.prompt_themes as string[]).join(
                        ", ",
                      )
                    : "";
                  setProfileEdits(values);
                  setProfileOpen(true);
                  window.dispatchEvent(
                    new CustomEvent("unoword-tour-action", {
                      detail: "ai_profile_started",
                    }),
                  );
                }}
                disabled={!profile}
              >
                <Settings2 size={16} />
                {t("My Writing Profile")}
                <ArrowRight size={14} />
              </button>
              {ws.user.ai_access && (
                <>
                  <button onClick={() => void openSources()}>
                    <FileText size={16} />
                    {t("Writing knowledge")}
                    <ArrowRight size={14} />
                  </button>
                  {sourcesOpen && (
                    <div className="uw-editor-source-list">
                      {sources.map((source) => (
                        <label key={source.id}>
                          <input
                            type="checkbox"
                            checked={source.enabled}
                            disabled={sourceBusy.has(source.id)}
                            onChange={async (event) => {
                              const enabled = event.target.checked,
                                owner = ws.user!.id;
                              setSourceBusy((all) =>
                                new Set(all).add(source.id),
                              );
                              setSources((all) =>
                                all.map((s) =>
                                  s.id === source.id ? { ...s, enabled } : s,
                                ),
                              );
                              try {
                                await apiPatch(
                                  `/workspace/sources/${source.id}`,
                                  { expected_user_id: owner, enabled },
                                );
                                if (ownerRef.current === owner)
                                  setSources((all) =>
                                    all.map((s) =>
                                      s.id === source.id
                                        ? { ...s, enabled }
                                        : s,
                                    ),
                                  );
                              } catch (failure) {
                                if (ownerRef.current === owner)
                                  setSources((all) =>
                                    all.map((s) =>
                                      s.id === source.id
                                        ? { ...s, enabled: !enabled }
                                        : s,
                                    ),
                                  );
                                setAiError(editorError(failure));
                              } finally {
                                setSourceBusy((all) => {
                                  const next = new Set(all);
                                  next.delete(source.id);
                                  return next;
                                });
                              }
                            }}
                          />
                          {source.document_title}
                          {["pending", "processing", "failed"].includes(
                            source.processing_status || "",
                          ) && (
                            <span className="uw-editor-muted">
                              {source.processing_status === "failed"
                                ? language === "es"
                                  ? "No se pudo procesar. Reintenta desde la extensión."
                                  : "Processing failed. Retry from the extension."
                                : `${language === "es" ? "Procesando" : "Processing"} · ${source.processing_progress || 0}%`}
                            </span>
                          )}
                        </label>
                      ))}
                      <p className="uw-editor-muted">
                        {language === "es"
                          ? "Los archivos y sitios web de tu biblioteca de escritura."
                          : "Your existing Writing Library documents and websites. Manage uploads from the extension."}
                      </p>
                    </div>
                  )}
                  {activeDocument && (
                    <label className="uw-editor-consent">
                      <input
                        type="checkbox"
                        checked={activeDocument.ai_allowed}
                        onChange={(event) =>
                          ws.update(activeDocument.id, {
                            ai_allowed: event.target.checked,
                          })
                        }
                      />
                      {t("Use this document for future AI personalization")}
                    </label>
                  )}
                </>
              )}
              <label data-tour="goal" className="uw-editor-goal">
                {t("Daily goal")}
                <input
                  type="number"
                  min="1"
                  max="1000000"
                  value={goal}
                  onChange={(event) =>
                    saveWritingGoal(Number(event.target.value))
                  }
                />
              </label>
            </div>
          </aside>
        )}
      </div>
      <WritingTour
        key={ws.user.id}
        owner={ws.user.id}
        enabled={ws.user.ai_access}
        documentId={activeDocument?.id || null}
        documentIds={ws.documents.map((document) => document.id)}
        select={ws.setSelected}
        create={() =>
          ws.create(
            language === "es" ? "Mi primera frase" : "My first sentence",
          )
        }
        observation={tourObservation}
        words={totalWords}
        sessionActive={Boolean(session.current)}
        goal={goal}
        saveGoal={saveWritingGoal}
        openAssistant={() => {
          setRight(true);
          setFocus(false);
        }}
      />
      <dialog
        ref={linkDialog}
        aria-label={language === "es" ? "Añadir enlace" : "Add a link"}
        className="uw-editor-dialog"
        onCancel={() => setLinkOpen(false)}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!linkHref.trim()) editor?.chain().focus().unsetLink().run();
            else {
              try {
                const url = new URL(linkHref);
                if (!["http:", "https:", "mailto:"].includes(url.protocol))
                  throw new Error();
                editor
                  ?.chain()
                  .focus()
                  .extendMarkRange("link")
                  .setLink({ href: url.href })
                  .run();
              } catch {
                ws.setError("Enter a valid HTTPS, HTTP or mailto link.");
                return;
              }
            }
            setLinkOpen(false);
          }}
        >
          <h2>{language === "es" ? "Añadir enlace" : "Add a link"}</h2>
          <label>
            URL
            <input
              autoFocus
              type="text"
              value={linkHref}
              onChange={(event) => setLinkHref(event.target.value)}
              placeholder="https://"
            />
          </label>
          <div>
            <button type="button" onClick={() => setLinkOpen(false)}>
              {t("Cancel")}
            </button>
            <button className="uw-editor-primary" type="submit">
              {language === "es" ? "Guardar enlace" : "Save link"}
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={folderDialog}
        aria-label={t("New folder")}
        className="uw-editor-dialog"
        onCancel={(event) => {
          if (folderBusy) event.preventDefault();
          if (!folderBusy) setNewFolderOpen(false);
        }}
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (folderBusy) return;
            setFolderError("");
            if (!folderName.trim()) {
              setFolderError(
                language === "es"
                  ? "Escribe un nombre para la carpeta."
                  : "Enter a folder name.",
              );
              return;
            }
            setFolderBusy(true);
            try {
              await ws.createFolder(folderName);
              setFolderName("");
              setNewFolderOpen(false);
            } catch {
              setFolderError(
                language === "es"
                  ? "No se pudo guardar la carpeta en este dispositivo. Inténtalo de nuevo."
                  : "Could not save the folder on this device. Please try again.",
              );
            } finally {
              setFolderBusy(false);
            }
          }}
        >
          <h2>{t("New folder")}</h2>
          {folderError && <p role="alert">{folderError}</p>}
          <label>
            {language === "es" ? "Nombre" : "Name"}
            <input
              autoFocus
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              maxLength={100}
              required
            />
          </label>
          <div>
            <button
              type="button"
              disabled={folderBusy}
              onClick={() => setNewFolderOpen(false)}
            >
              {t("Cancel")}
            </button>
            <button
              className="uw-editor-primary"
              type="submit"
              disabled={folderBusy}
            >
              {t("New folder")}
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={profileDialog}
        aria-label={t("My Writing Profile")}
        className="uw-editor-dialog uw-editor-profile-dialog"
        onCancel={() => setProfileOpen(false)}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveProfile();
          }}
        >
          <h2>{t("My Writing Profile")}</h2>
          <p>
            {language === "es"
              ? "Este es el mismo perfil que usa tu extensión. Los cambios se aplican a futuras sugerencias."
              : "The same profile used by your extension. Changes guide future suggestions."}
          </p>
          {profileFields.map(([key, label]) => (
            <label key={key}>
              {t(label)}
              <textarea
                rows={2}
                value={profileEdits[key] || ""}
                onChange={(event) =>
                  setProfileEdits((value) => ({
                    ...value,
                    [key]: event.target.value,
                  }))
                }
              />
            </label>
          ))}
          <label>
            {language === "es"
              ? "Temas de sugerencias (separados por comas)"
              : "Prompt themes (comma separated)"}
            <input
              value={profileEdits.prompt_themes || ""}
              onChange={(event) =>
                setProfileEdits((value) => ({
                  ...value,
                  prompt_themes: event.target.value,
                }))
              }
            />
          </label>
          <div>
            <button type="button" onClick={() => setProfileOpen(false)}>
              {t("Cancel")}
            </button>
            <button
              className="uw-editor-primary"
              type="submit"
              disabled={profileBusy}
            >
              {t("Save profile")}
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
