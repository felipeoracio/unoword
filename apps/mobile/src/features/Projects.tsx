import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import {
  Button,
  Card,
  Heading,
  Input,
  Label,
  ProNotice,
  Row,
  Screen,
} from "../components/ui";
import { useApp } from "../providers/AppProvider";
import { useProjects, inProject } from "../providers/ProjectProvider";
import type { Project } from "../../../../shared/projects";
import * as WebBrowser from "expo-web-browser";
import {WEB_URL} from "../services/config";
import GuidedProfile from "./GuidedProfile";
export default function Projects() {
  const { account, api } = useApp(),
    p = useProjects(),
    router = useRouter();
  const [query, setQuery] = useState(""),
    [detail, setDetail] = useState<string | null>(null),
    [tab, setTab] = useState("Overview"),
    [editing, setEditing] = useState<Partial<Project> | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [showArchive, setShowArchive] = useState(false),
    [sort, setSort] = useState("updated"),
    [preview, setPreview] = useState<{ title: string; text: string } | null>(
      null,
    ),
    [profile, setProfile] = useState(false);
  useEffect(() => {
    if (account?.ai_access) void p.resources().catch(() => {});
  }, [account?.id, p.state?.updated_at]);
  if (!account?.ai_access)
    return (
      <Screen title="Projects">
        <ProNotice />
      </Screen>
    );
  const project = p.state?.projects.find((row) => row.id === detail);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "This change could not be saved. Your writing is preserved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function open() {
    await p.select(detail);
    router.push("/write");
  }
  return (
    <Screen title="Projects">
      <Label muted>
        One workspace for every idea. Shared resources are linked without
        copies.
      </Label>
      <Row>
        <Button
          title="New Project"
          onPress={() =>
            setEditing({
              name: "",
              description: "",
              project_type: "novel",
              status: "planning",
              goals: {},
              preferences: {},
            })
          }
        />
        <Button
          title="My Writing Profile"
          secondary
          onPress={() => setProfile(!profile)}
        />
      </Row>
      {profile && <GuidedProfile />}
      {!!error && <Label accessibilityRole="alert">{error}</Label>}
      {!!p.error && <Label>{p.error}</Label>}
      {p.conflict && (
        <Card>
          <Label>
            Another device changed these settings. Both versions and your
            writing are preserved.
          </Label>
          <Button
            title="Retry my change"
            onPress={() => void run(() => p.resolveConflict(true))}
          />
          <Button
            title="Keep cloud version (local recovery retained)"
            secondary
            onPress={() => void run(() => p.resolveConflict(false))}
          />
        </Card>
      )}
      <Label muted>
        {!p.online
          ? "Offline · Saved on device"
          : p.pending
            ? "Changes pending sync"
            : "Projects synced"}
      </Label>
      {editing && (
        <Card>
          <Heading>{editing.id ? "Project settings" : "New Project"}</Heading>
          <Label>Name</Label>
          <Input
            accessibilityLabel="Project name"
            value={editing.name || ""}
            maxLength={150}
            onChangeText={(name) => setEditing({ ...editing, name })}
          />
          <Label>Description</Label>
          <Input
            multiline
            value={editing.description || ""}
            maxLength={4000}
            onChangeText={(description) =>
              setEditing({ ...editing, description })
            }
          />
          <Label>Project type (or write your own)</Label>
          <Input
            value={editing.project_type || ""}
            maxLength={100}
            onChangeText={(project_type) =>
              setEditing({ ...editing, project_type })
            }
          />
          <Row>
            {[
              "novel",
              "memoir",
              "short_story",
              "poetry",
              "blog",
              "essay",
              "nonfiction_book",
              "academic_writing",
              "business_writing",
              "journal",
              "other",
            ].map((type) => (
              <Button
                key={type}
                title={type.replaceAll("_", " ")}
                secondary={editing.project_type !== type}
                onPress={() => setEditing({ ...editing, project_type: type })}
              />
            ))}
          </Row>
          <Row>
            {(
              [
                "planning",
                "in_progress",
                "paused",
                "completed",
                "archived",
              ] as const
            ).map((status) => (
              <Button
                key={status}
                title={status.replaceAll("_", " ")}
                secondary={editing.status !== status}
                onPress={() => setEditing({ ...editing, status })}
              />
            ))}
          </Row>
          {(["daily_words", "weekly_words", "total_words"] as const).map(
            (key) => (
              <View key={key}>
                <Label>{key.replaceAll("_", " ")}</Label>
                <Input
                  keyboardType="numeric"
                  value={String(editing.goals?.[key] || "")}
                  onChangeText={(value) =>
                    setEditing({
                      ...editing,
                      goals: {
                        ...editing.goals,
                        [key]: value ? Number(value) : null,
                      },
                    })
                  }
                />
              </View>
            ),
          )}
          <Label>Target date (YYYY-MM-DD, optional)</Label>
          <Input
            value={editing.target_date || ""}
            onChangeText={(target_date) =>
              setEditing({ ...editing, target_date: target_date || null })
            }
          />
          {(
            [
              "audience",
              "tone",
              "objectives",
              "research_focus",
              "challenges",
            ] as const
          ).map((key) => (
            <View key={key}>
              <Label>{key.replaceAll("_", " ")}</Label>
              <Input
                multiline
                maxLength={2000}
                value={editing.preferences?.[key] || ""}
                onChangeText={(value) =>
                  setEditing({
                    ...editing,
                    preferences: { ...editing.preferences, [key]: value },
                  })
                }
              />
            </View>
          ))}
          <Row>
            <Button
              title="Save project"
              disabled={busy || !editing.name?.trim()}
              onPress={() =>
                void run(async () => {
                  const id = await p.saveProject(editing as Project);
                  setDetail(id);
                  setEditing(null);
                })
              }
            />
            <Button title="Cancel" secondary onPress={() => setEditing(null)} />
          </Row>
        </Card>
      )}
      <Input
        accessibilityLabel="Search projects"
        placeholder="Search projects"
        value={query}
        onChangeText={setQuery}
      />
      <Row>
        <Button
          title={showArchive ? "Hide archived" : "Show archived"}
          secondary
          onPress={() => setShowArchive(!showArchive)}
        />
        <Button
          title={sort === "updated" ? "Sort: Recently updated" : "Sort: Name"}
          secondary
          onPress={() => setSort(sort === "updated" ? "name" : "updated")}
        />
        <Button
          title="General Writing"
          secondary
          onPress={() => setDetail(null)}
        />
      </Row>
      {(p.state?.projects || [])
        .filter(
          (row) =>
            (showArchive || row.status !== "archived") &&
            `${row.name} ${row.description}`
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase()),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name)
            : b.updated_at.localeCompare(a.updated_at),
        )
        .map((row) => (
          <Card key={row.id}>
            <Heading>{row.name}</Heading>
            <Label muted>
              {row.project_type} · {row.status.replaceAll("_", " ")}
            </Label>
            <Label>{row.description}</Label>
            <Label muted>{p.statistics[row.id]?.total_words??'—'} words written{row.goals.total_words?` / ${row.goals.total_words}`:''}</Label>
            <Label muted>
              {
                p.state?.associations.filter(
                  (a) =>
                    a.project_id === row.id && a.resource_kind === "document",
                ).length
              }{" "}
              documents · Updated{" "}
              {new Date(row.updated_at).toLocaleDateString()}
            </Label>
            <Button
              title="View project"
              secondary={detail !== row.id}
              onPress={() => {
                setDetail(row.id);
                setTab("Overview");
              }}
            />
          </Card>
        ))}
      <Card>
        <Heading>{project?.name || "General Writing"}</Heading>
        <Row>
          {["Overview", "Documents", "Resources", "AI Context", "Settings"].map(
            (name) => (
              <Button
                key={name}
                title={name}
                secondary={tab !== name}
                onPress={() => setTab(name)}
              />
            ),
          )}
        </Row>
        <Button
          title="Open in editor"
          disabled={busy || project?.status === "archived"}
          onPress={() => void run(open)}
        />
        {tab === "Overview" && (
          <>
            <Label>
              {project?.description || "Unassigned writing and resources."}
            </Label>
            <Label muted>
              Project progress uses existing document activity. Shared documents
              never add words again to your account totals.
            </Label>
          </>
        )}
        {["Documents", "Resources", "AI Context"].includes(tab) && (
          <>
            <Label muted>
              Only authorized resources are used for AI. Check memberships below
              to share an existing resource with this project. Changing projects
              resets temporary AI context.
            </Label>
            {p.catalog
              .filter(
                (r) => tab !== "Documents" || r.resource_kind === "document",
              )
              .map((r) => (
                <View
                  key={r.resource_kind + r.id}
                  style={{ gap: 6, paddingVertical: 8 }}
                >
                  <Label>{r.title}</Label>
                  <Label muted size={12}>
                    {r.resource_kind} · {r.state} ·{" "}
                    {r.allowed ? "AI available" : "Not opted in / processing"} ·{" "}
                    {p
                      .snapshot()
                      ?.associations.filter(
                        (a) =>
                          a.resource_id === r.id &&
                          a.resource_kind === r.resource_kind,
                      ).length || 0}{" "}
                    project(s)
                  </Label>
                  <Row>
                    {detail && (
                      <Button
                        title={
                          p.state &&
                          inProject(p.state, r.resource_kind, r.id, detail)
                            ? "✓ In project"
                            : "Add to project"
                        }
                        secondary
                        disabled={busy}
                        onPress={() =>
                          void run(() => {
                            const ids =
                              p.state?.associations
                                .filter(
                                  (a) =>
                                    a.resource_id === r.id &&
                                    a.resource_kind === r.resource_kind,
                                )
                                .map((a) => a.project_id) || [];
                            return p.assign(
                              r.resource_kind,
                              r.id,
                              ids.includes(detail)
                                ? ids.filter((id) => id !== detail)
                                : [...ids, detail],
                            );
                          })
                        }
                      />
                    )}
                    <Button
                      title="Preview"
                      secondary
                      disabled={!p.online}
                      onPress={() =>
                        void run(async () =>
                          setPreview(
                            await api(
                              "GET",
                              `/workspace/projects/resources/${r.resource_kind}/${r.id}/preview`,
                            ),
                          ),
                        )
                      }
                    />
                  </Row>
                </View>
              ))}
            {preview && (
              <Card>
                <Heading>{preview.title}</Heading>
                <Label>{preview.text}</Label>
                <Button
                  title="Close preview"
                  secondary
                  onPress={() => setPreview(null)}
                />
              </Card>
            )}
            <Label muted>
              Upload new reference files or websites from the web Projects
              library. Existing references stay synchronized here.
            </Label>
          </>
        )}
        {tab === "Settings" && project && (
          <>
            <Button
              title="Edit settings"
              secondary
              onPress={() => setEditing(project)}
            />
            <Button
              title={
                project.status === "archived"
                  ? "Restore project"
                  : "Archive project"
              }
              secondary
              onPress={() =>
                void run(() =>
                  p.saveProject({
                    ...project,
                    status:
                      project.status === "archived" ? "planning" : "archived",
                  }),
                )
              }
            />
            <Label muted>
              Project deletion is available with name confirmation on the web
              dashboard. It preserves writing and account history.
            </Label>
          </>
        )}
        <Button title="Open full web Projects & Library" secondary onPress={()=>void WebBrowser.openBrowserAsync(WEB_URL+'/projects')}/>
      </Card>
    </Screen>
  );
}
