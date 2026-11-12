import ProjectControls from "./ProjectControls";
import {useProjects,inProject} from "../providers/ProjectProvider";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { StudioModal as Modal } from "../components/motion";
import { useApp, useRepository } from "../providers/AppProvider";
import {
  Button,
  Card,
  Heading,
  Input,
  Label,
  ProNotice,
  Row,
  Screen,
  useTheme,
} from "../components/ui";
import {
  RichEditor,
  type EditorHandle,
  type EditorChange,
} from "../components/RichEditor";
import {
  bodyText,
  canEdit,
  documentToReopen,
  safeBody,
} from "../core/document";
import { words, clock, duration } from "../core/engines";
import { message } from "../core/api";
import type { Draft, DocumentIndex } from "../core/types";
import { Coach } from "./coach";
export default function Write() {
  const projects=useProjects();
  const activeProjectRef=useRef<string|null|undefined>(undefined);
  const projectsRef=useRef(projects);projectsRef.current=projects;
  const { account, writer, online } = useApp(),
    repo = useRepository(),
    p = useTheme(),
    size = useWindowDimensions();
  const [doc, setDoc] = useState<Draft | null>(null),
    [search, setSearch] = useState(""),
    [folder, setFolder] = useState<string | null>(null),
    [folderName, setFolderName] = useState(""),
    [filter, setFilter] = useState("drafts"),
    [error, setError] = useState(""),
    [focus, setFocus] = useState(false),
    [details, setDetails] = useState(false),
    [tools, setTools] = useState(false),
    [link, setLink] = useState(""),
    [canvas, setCanvas] = useState(0),
    [help, setHelp] = useState(false),
    [tick, setTick] = useState(0),
    [remoteMatches, setRemoteMatches] = useState<string[] | null>(null);
  const editor = useRef<EditorHandle>(null),
    docRef = useRef(doc);
  docRef.current = doc;
  const saving = useRef<ReturnType<typeof setTimeout> | null>(null),
    auto = useRef(false),
    opening = useRef(0);
  const paid = !!account?.features.writing_editor,
    wide = size.width >= 950 && !focus;
  const open = useCallback(
    async (id: string, allowCompleted = true) => {
      if (!repo) return;
      const generation = ++opening.current;
      try {
        if (
          writer?.active &&
          writer.active.document_id !== id &&
          writer.active.timer.status === "active"
        )
          await writer.change("paused");
        const next = await repo.open(id);
        if (!next || generation !== opening.current) return;
        if (!allowCompleted && next.completion_status === "completed") {
          await repo.store.set("last-document", "__new__");
          return;
        }
        setDoc(next);
        setCanvas((n) => n + 1);
        setError("");
        await projectsRef.current.remember(next.completion_status==="completed"?null:id);
        await repo.store.set(
          "last-document",
          next.completion_status === "completed" ? "__new__" : id,
        );
      } catch (e) {
        setError(message(e));
      }
    },
    [repo, writer],
  );
  useEffect(() => {
    auto.current = false;
    opening.current++;
    setDoc(null);
    return () => {
      opening.current++;
    };
  }, [repo]);
  useEffect(() => {
    if(!repo||!paid||!projects.ready||!projects.state||activeProjectRef.current===projects.active&&auto.current)return;
    const currentProject=projects.active;activeProjectRef.current=currentProject;auto.current=true;
    void (async()=>{try{await repo.flush();const state=projects.snapshot();if(!state)return;
      const previous=state.preferences.last_documents[currentProject||'general'] || await repo.store.get<string>('last-document');
      const candidates=repo.index.filter(d=>inProject(state,'document',d.id,currentProject));
      const id=documentToReopen(candidates,previous);if(activeProjectRef.current!==currentProject)return;
      if(id)await open(id,false);else {setDoc(null);docRef.current=null;setCanvas(n=>n+1)}
    }catch(e){setError(message(e))}})();
  },[repo,paid,projects.ready,projects.active,open]);

  useEffect(() => {
    if (!repo) return;
    return repo.subscribe(() => {
      const id = docRef.current?.id;
      if (!id) return;
      const cached = repo.documents.get(id);
      if (cached) {
        setDoc({ ...cached });
        docRef.current = cached;
      }
      const metadata = repo.index.find((d) => d.id === id);
      if (
        cached &&
        !cached.dirty &&
        metadata &&
        metadata.revision > cached.revision
      ) {
        void repo
          .open(id)
          .then((next) => {
            if (next && !next.dirty && docRef.current?.id === id) {
              if (
                next.completion_status === "completed" &&
                cached.completion_status !== "completed"
              ) {
                setDoc(null);
                docRef.current = null;
                void repo.store.set("last-document", "__new__");
                return;
              }
              setDoc(next);
              setCanvas((n) => n + 1);
              if (next.completion_status === "completed")
                void repo.store.set("last-document", "__new__");
            }
          })
          .catch(() => {});
      }
    });
  }, [repo]);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") editor.current?.snapshot();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);
  useEffect(() => {
    if (!repo || !search.trim() || !online) {
      setRemoteMatches(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(
      () =>
        void repo
          .api<DocumentIndex[]>(
            "GET",
            "/workspace/documents?q=" + encodeURIComponent(search),
          )
          .then((rows) => {
            if (alive) setRemoteMatches(rows.map((d) => d.id));
          })
          .catch(() => {
            if (alive) setRemoteMatches(null);
          }),
      350,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [search, repo, online]);
  useEffect(
    () => () => {
      if (saving.current) clearTimeout(saving.current);
    },
    [],
  );
  if (!paid)
    return (
      <Screen title="Writing workspace">
        <ProNotice />
        <Label muted>
          Previously saved documents remain safe. You can retrieve exports
          through the website’s account recovery tools.
        </Label>
      </Screen>
    );
  const update = async (
    patch: Parameters<NonNullable<typeof repo>["edit"]>[1],
  ) => {
    if (!repo || !docRef.current || docRef.current.id !== doc?.id) return;
    try {
      const next = await repo.edit(docRef.current.id, patch);
      if (docRef.current?.id === next.id) {
        setDoc(next);
        docRef.current = next;
      }
      if (saving.current) clearTimeout(saving.current);
      saving.current = setTimeout(() => void repo.sync(paid), 1000);
    } catch (e) {
      setError(message(e));
    }
  };
  const change = (event: EditorChange) => {
    const current = docRef.current;
    if (!current || event.id !== current.id || !canEdit(current)) return;
    if (!safeBody(event.content)) {
      setError(
        "This document has reached its save limit. Your previous saved writing is preserved; copy new text before leaving.",
      );
      return;
    }
    const content = {
      ...event.content,
      attrs: { ...event.content.attrs, ...current.content.attrs },
    };
    void update({ content });
    if (event.inputType !== "format")
      void writer
        ?.input(current.id, event.before, event.text, event.inputType)
        .catch((e) => setError(message(e)));
  };
  const create = async () => {
    if (!repo || !projects.ready || projects.busy) return;
    opening.current++;
    try {
      const next = await repo.create("Untitled", undefined, folder);
      await projects.assign("document",next.id,projects.active?[projects.active]:[]);
      setDoc(next);
      docRef.current = next;
      setCanvas((n) => n + 1);
      await repo.store.set("last-document", next.id);
      void repo.sync(paid);
    } catch (e) {
      setError(message(e));
    }
  };
  const run = (fn: () => Promise<unknown>) => {
    void fn().catch((e) => setError(message(e)));
  };
  const complete = () =>
    Alert.alert(
      doc?.completion_status === "completed"
        ? "Reopen this document?"
        : "Mark Document as Complete?",
      doc?.completion_status === "completed"
        ? "This will make the document editable again."
        : "Your writing will be saved and kept in the library.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: doc?.completion_status === "completed" ? "Reopen" : "Complete",
          onPress: () =>
            run(async () => {
              if (!repo || !docRef.current) return;
              const id = docRef.current.id;
              const next = await repo.edit(id, {
                completion_status:
                  docRef.current.completion_status === "completed"
                    ? "draft"
                    : "completed",
              });
              setDoc(next);
              if (writer?.active?.document_id === id)
                await writer.change("ended");
              await repo.store.set(
                "last-document",
                next.completion_status === "completed" ? "__new__" : id,
              );
              await repo.sync(paid);
            }),
        },
      ],
    );
  const items = (repo?.index || []).filter(d=>!projects.state||inProject(projects.state,"document",d.id,projects.active)).filter(
    (d) =>
      (filter === "trash"
        ? d.status === "trashed"
        : filter === "archived"
          ? d.status === "archived"
          : d.status === "active") &&
      (filter !== "drafts" || d.completion_status !== "completed") &&
      (filter !== "completed" || d.completion_status === "completed") &&
      (filter !== "favorites" || d.favorite) &&
      (!folder || d.folder_id === folder) &&
      (!search ||
        d.title.toLowerCase().includes(search.toLowerCase()) ||
        remoteMatches?.includes(d.id) ||
        repo?.documents
          .get(d.id)
          ?.plain_text.toLowerCase()
          .includes(search.toLowerCase())),
  );
  const library = (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <Heading>Documents</Heading>
      <Button title="New document" disabled={!projects.ready||projects.busy} onPress={() => run(create)} />
      <Input
        accessibilityLabel="Search documents"
        placeholder="Search your writing…"
        value={search}
        onChangeText={setSearch}
      />
      <Label muted size={12}>
        {online
          ? "Title and cloud content search"
          : "Search downloaded titles and text"}
      </Label>
      <Row>
        {["drafts", "completed", "favorites", "archived", "trash"].map(
          (value) => (
            <Button
              key={value}
              title={value[0].toUpperCase() + value.slice(1)}
              secondary={filter !== value}
              onPress={() => setFilter(value)}
            />
          ),
        )}
      </Row>
      <Label style={{ fontWeight: "700" }}>Folders</Label>
      <Button title="All folders" secondary onPress={() => setFolder(null)} />
      {repo?.folders.map((f) => (
        <Button
          key={f.id}
          title={f.name + (f.dirty ? " · pending" : "")}
          secondary={folder !== f.id}
          onPress={() => setFolder(folder === f.id ? null : f.id)}
        />
      ))}
      <Input
        accessibilityLabel="New folder name"
        placeholder="New folder name"
        value={folderName}
        onChangeText={setFolderName}
      />
      <Button
        title="Add folder"
        secondary
        disabled={!folderName.trim()}
        onPress={() =>
          run(async () => {
            await repo?.createFolder(folderName);
            setFolderName("");
            await repo?.sync(paid);
          })
        }
      />
      <Label muted>{items.length} documents</Label>
      {items.map((item) => (
        <Card key={item.id}>
          <Button
            title={item.title}
            secondary
            onPress={() => void open(item.id)}
          />
          <Label size={12} muted>
            {item.completion_status === "completed" ? "✓ Completed" : "Draft"}
            {item.dirty ? " · Pending Sync" : ""}
            {item.conflict ? " · Conflict" : ""}
          </Label>
          <Label size={12} muted>
            Updated {new Date(item.updated_at).toLocaleDateString()}
          </Label>
        </Card>
      ))}
      {!items.length && <Label muted>No documents in this view.</Label>}
    </ScrollView>
  );
  if (!doc)
    return (
      <Screen scroll={false}>
        <ProjectControls/>
        <View style={{ padding: 20 }}>
          <Heading>Ready for Your Next Idea?</Heading>
          <Label muted>Every idea starts with UnoWord.</Label>
          {!!error && <Label>{error}</Label>}
          <Label muted>{repo?.status}</Label>
        </View>
        {library}
      </Screen>
    );
  const currentSession =
    writer?.active?.document_id === doc.id ? writer.active : null;
  void tick;
  return (
    <Screen scroll={false}>
      <ProjectControls/>
      <Modal
        visible={details}
        presentationStyle="pageSheet"
        onRequestClose={() => setDetails(false)}
      >
        <Screen title="Document details">
          <Button title="Done" onPress={() => setDetails(false)} />
          <Label>Subtitle</Label>
          <Input
            accessibilityLabel="Document subtitle"
            placeholder="Add a subtitle…"
            value={String(doc.content.attrs?.subtitle || "")}
            maxLength={500}
            editable={!projects.busy && canEdit(doc)}
            onChangeText={(subtitle) =>
              void update({
                content: {
                  ...docRef.current!.content,
                  attrs: {
                    ...docRef.current!.content.attrs,
                    subtitle: subtitle || null,
                  },
                },
              })
            }
          />
          <Button
            title={doc.favorite ? "★ Favorite" : "☆ Favorite"}
            secondary
            onPress={() => void update({ favorite: !doc.favorite })}
          />
          <Button
            title={
              doc.completion_status === "completed"
                ? "Reopen draft"
                : "✓ Complete"
            }
            secondary
            accessibilityLabel={
              doc.completion_status === "completed"
                ? "Reopen Document"
                : "Mark Document as Complete"
            }
            onPress={complete}
          />
          <Button
            title={doc.status === "trashed" ? "Restore" : "Move to Trash"}
            secondary
            onPress={() =>
              run(async () => {
                await update({
                  status: doc.status === "trashed" ? "active" : "trashed",
                });
                await writer?.change("ended");
                setDoc(null);
                setDetails(false);
                await repo?.store.set("last-document", "__new__");
                await repo?.sync(paid);
              })
            }
          />
          <Button
            title="Duplicate"
            secondary
            onPress={() =>
              run(async () => {
                const copy = await repo?.create(
                  doc.title + " (copy)",
                  doc.content,
                  doc.folder_id,
                );
                if (copy) {
                  await projects.assign("document",copy.id,projects.active?[projects.active]:[]);
                  setDoc(copy);
                  setCanvas((n) => n + 1);
                }
                setDetails(false);
                await repo?.sync(paid);
              })
            }
          />
          <Button
            title={doc.status === "archived" ? "Unarchive" : "Archive"}
            secondary
            onPress={() =>
              void update({
                status: doc.status === "archived" ? "active" : "archived",
              })
            }
          />
          <Label>Move to folder</Label>
          <Button
            title="No folder"
            secondary
            onPress={() => void update({ folder_id: null })}
          />
          {repo?.folders.map((f) => (
            <Button
              key={f.id}
              title={f.name}
              secondary={doc.folder_id !== f.id}
              onPress={() => void update({ folder_id: f.id })}
            />
          ))}
          <Label>AI personalization permission</Label>
          <Button
            title={
              doc.ai_allowed
                ? "Shared for future personalized suggestions"
                : "Keep out of automatic AI context"
            }
            secondary
            onPress={() => void update({ ai_allowed: !doc.ai_allowed })}
          />
          <Label muted>
            This controls future automatic context. Sending this draft for an
            individual coach request still requires the separate consent switch.
          </Label>
          <Label muted>
            Created {new Date(doc.created_at).toLocaleString()}
          </Label>
          <Label muted>
            Updated {new Date(doc.updated_at).toLocaleString()}
          </Label>
        </Screen>
      </Modal>
      <View
        style={{
          padding: 12,
          gap: 8,
          backgroundColor: p.card,
          borderBottomColor: p.line,
          borderBottomWidth: 1,
        }}
      >
        <Row>
          <Button
            title={size.width < 600 ? "Library" : "Documents"}
            accessibilityLabel="Open document library"
            secondary
            onPress={() => {
              setDoc(null);
              void repo?.store.set("last-document", "__new__");
            }}
          />
          <View style={{ flex: 1 }} />
          <Button
            title={
              focus ? "Exit focus" : size.width < 600 ? "Focus" : "Focus mode"
            }
            secondary
            onPress={() => setFocus(!focus)}
          />
          <Button
            title={help ? "Hide AI" : size.width < 600 ? "AI" : "AI Coach"}
            secondary
            onPress={() => setHelp(!help)}
          />
        </Row>
        {!focus && (
          <>
            <Input
              accessibilityLabel="Document title"
              value={doc.title}
              maxLength={300}
              editable={!projects.busy && canEdit(doc)}
              onChangeText={(title) =>
                void update({ title: title || "Untitled" })
              }
              style={{ fontSize: 22, fontWeight: "700" }}
            />
            <Row>
              <Button
                title={tools ? "Hide formatting" : "Formatting"}
                secondary
                disabled={!canEdit(doc)}
                onPress={() => setTools(!tools)}
              />
              <Button
                title="Document details"
                secondary
                onPress={() => setDetails(true)}
              />
            </Row>
          </>
        )}
        {tools && !focus && canEdit(doc) && (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Row>
                {[
                  ["bold", "Bold"],
                  ["italic", "Italic"],
                  ["underline", "Underline"],
                  ["strike", "Strike"],
                  ["h1", "H1"],
                  ["h2", "H2"],
                  ["h3", "H3"],
                  ["bullet", "Bullets"],
                  ["ordered", "Numbered"],
                  ["quote", "Quote"],
                  ["divider", "Divider"],
                  ["left", "Left"],
                  ["center", "Center"],
                  ["right", "Right"],
                  ["undo", "Undo"],
                  ["redo", "Redo"],
                ].map(([command, title]) => (
                  <Button
                    key={command}
                    title={title}
                    secondary
                    onPress={() => editor.current?.command(command)}
                  />
                ))}
              </Row>
            </ScrollView>
            <Row>
              <Input
                accessibilityLabel="Link URL"
                placeholder="https://…"
                value={link}
                onChangeText={setLink}
                autoCapitalize="none"
                style={{ flex: 1 }}
              />
              <Button
                title="Add link"
                secondary
                onPress={() => {
                  if (/^https?:\/\/[^\s]+$/.test(link))
                    editor.current?.command("link", link);
                  else setError("Enter a valid http or https URL.");
                }}
              />
            </Row>
          </>
        )}
        {!!error && <Label size={13}>{error}</Label>}
        {doc.conflict && (
          <Card>
            <Label>
              A newer cloud version exists. Both versions are preserved. Recover
              this mobile draft as a separate document to continue.
            </Label>
            <Button
              title="Keep both versions"
              onPress={() =>
                run(async () => {
                  const copy = await repo?.resolveConflict(doc.id);
                  if (copy) {
                    setDoc(copy);
                    setCanvas((n) => n + 1);
                  }
                  await repo?.sync(paid);
                })
              }
            />
          </Card>
        )}
      </View>
      <View
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          flexDirection: "row",
        }}
      >
        {wide && (
          <View
            style={{
              width: 260,
              height: "100%",
              minHeight: 0,
              overflow: "hidden",
              borderRightWidth: 1,
              borderRightColor: p.line,
            }}
          >
            {library}
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <RichEditor
            key={doc.id + ":" + canvas}
            ref={editor}
            id={doc.id}
            content={doc.content}
            editable={!projects.busy && canEdit(doc) && !doc.conflict}
            onChange={change}
            onError={setError}
          />
          {help && !wide && (
            <View
              style={{
                maxHeight: 250,
                borderTopWidth: 1,
                borderTopColor: p.line,
              }}
            >
              <ScrollView contentContainerStyle={{ padding: 14 }}>
                <Coach document={doc} />
              </ScrollView>
            </View>
          )}
        </View>
        {help && wide && (
          <View
            style={{
              width: 280,
              height: "100%",
              minHeight: 0,
              overflow: "hidden",
              borderLeftWidth: 1,
              borderLeftColor: p.line,
            }}
          >
            <ScrollView contentContainerStyle={{ padding: 14 }}>
              <Coach document={doc} />
            </ScrollView>
          </View>
        )}
      </View>
      <View
        style={{
          padding: 12,
          gap: 8,
          borderTopColor: p.line,
          borderTopWidth: 1,
          backgroundColor: p.card,
        }}
      >
        <Row>
          <Label size={13}>
            {words.countWords(bodyText(doc.content))} document words
          </Label>
          <Label size={12} muted>
            {doc.dirty
              ? "Pending Sync"
              : repo?.status === "Synced"
                ? "Synced"
                : repo?.status || "Offline"}
          </Label>
          <Label size={12} muted>
            {Math.max(
              1,
              Math.ceil(words.countWords(bodyText(doc.content)) / 200),
            )}{" "}
            min read
          </Label>
        </Row>
        <Row>
          {currentSession && (
            <Label size={13}>
              Session Time{" "}
              {duration(clock.read(currentSession.timer).active_ms / 1000)} ·{" "}
              {currentSession.typed_words} new words
            </Label>
          )}
          {canEdit(doc) && (
            <Button
              title={
                !currentSession || currentSession.timer.status === "ended"
                  ? "Start session"
                  : currentSession.timer.status === "active"
                    ? "Pause"
                    : "Resume"
              }
              onPress={() =>
                run(async () => {
                  if (
                    !currentSession ||
                    currentSession.timer.status === "ended"
                  )
                    await writer?.start(doc.id);
                  else
                    await writer?.change(
                      currentSession.timer.status === "active"
                        ? "paused"
                        : "active",
                    );
                  void repo?.sync(paid);
                })
              }
            />
          )}{" "}
          {!!currentSession && currentSession.timer.status !== "ended" && (
            <Button
              title="End session"
              secondary
              onPress={() =>
                run(async () => {
                  await writer?.change("ended");
                  await repo?.sync(paid);
                })
              }
            />
          )}
        </Row>
      </View>
    </Screen>
  );
}
