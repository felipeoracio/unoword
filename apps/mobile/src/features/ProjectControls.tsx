import React, { useState } from "react";
import { Modal, View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Label, Row, Screen, Input } from "../components/ui";
import { useProjects, inProject } from "../providers/ProjectProvider";
import type { ContextScope } from "../../../../shared/projects";
export const modes: [ContextScope, string][] = [
  ["current_project", "Current Project"],
  ["selected_resources", "Selected Resources"],
  ["all_projects", "All Projects / Full Library"],
  ["profile_only", "Writing Profile Only"],
  ["none", "No Library Context"],
];
export default function ProjectControls() {
  const p = useProjects(),
    router = useRouter(),
    [panel, setPanel] = useState(""),
    [query, setQuery] = useState(""),
    [error, setError] = useState("");
  const project = p.state?.projects.find((row) => row.id === p.active),
    selected = (kind: string, id: string) =>
      p.selected.some((r) => r.kind === kind && r.id === id);
  return (
    <View style={{ gap: 6, padding: 10 }}>
      <Row>
        <Button
          title={"Project: " + (project?.name || "General Writing")}
          secondary
          disabled={p.busy || !p.ready}
          onPress={() => setPanel("projects")}
        />
        <Button
          title={"AI Context: " + modes.find((r) => r[0] === p.scope)?.[1]}
          secondary
          onPress={() => setPanel("context")}
        />
      </Row>
      <Label muted size={11}>
        {p.busy
          ? "Saving before switching…"
          : !p.online
            ? "Offline · Saved on this device"
            : p.pending
              ? "Project changes pending sync"
              : p.error || (p.ready ? "Projects synced" : "Loading projects…")}
      </Label>
      {project&&<Label muted size={11}>Project today: {p.statistics[project.id]?.daily_words??'—'}{project.goals.daily_words?` / ${project.goals.daily_words}`:''} · This week: {p.statistics[project.id]?.weekly_words??'—'}{project.goals.weekly_words?` / ${project.goals.weekly_words}`:''} · Project total: {p.statistics[project.id]?.total_words??'—'}{project.goals.total_words?` / ${project.goals.total_words}`:''}</Label>}
      <Modal
        visible={!!panel}
        presentationStyle="pageSheet"
        onRequestClose={() => setPanel("")}
      >
        <Screen title={panel === "projects" ? "Project" : "AI Context"}>
          <Button title="Done" onPress={() => setPanel("")} />
          {!!error && <Label>{error}</Label>}
          {panel === "projects" ? (
            <>
              <Button
                title="General Writing"
                secondary
                onPress={() =>
                  void p
                    .select(null)
                    .then(() => setPanel(""))
                    .catch((e) => setError(e.message))
                }
              />
              {p.state?.projects
                .filter((row) => row.status !== "archived")
                .map((row) => (
                  <Button
                    key={row.id}
                    title={row.name}
                    secondary={p.active !== row.id}
                    disabled={p.busy}
                    onPress={() =>
                      void p
                        .select(row.id)
                        .then(() => setPanel(""))
                        .catch((e) => setError(e.message))
                    }
                  />
                ))}
              <Button
                title="Manage Projects & Library"
                onPress={() => {
                  setPanel("");
                  router.push("/projects" as import("expo-router").Href);
                }}
              />
            </>
          ) : (
            <>
              {modes.map(([key, title]) => (
                <Button
                  key={key}
                  title={title}
                  secondary={p.scope !== key}
                  onPress={() => {
                    p.setScope(key);
                    if (key === "selected_resources")
                      void p.resources().catch((e) => setError(e.message));
                  }}
                />
              ))}
              {p.scope === "selected_resources" && (
                <>
                  <Input
                    accessibilityLabel="Search resources"
                    placeholder="Search resources"
                    value={query}
                    onChangeText={setQuery}
                  />
                  <Row>
                    <Button
                      title="Clear selection"
                      secondary
                      onPress={() => p.setSelected([])}
                    />
                    <Button
                      title="Project resources"
                      secondary
                      onPress={() =>
                        p.setSelected(
                          p.catalog
                            .filter(
                              (r) =>
                                r.allowed &&
                                p.state &&
                                inProject(
                                  p.state,
                                  r.resource_kind,
                                  r.id,
                                  p.active,
                                ),
                            )
                            .slice(0, 200)
                            .map((r) => ({ kind: r.resource_kind, id: r.id })),
                        )
                      }
                    />
                  </Row>
                  {p.catalog
                    .filter((r) =>
                      r.title
                        .toLocaleLowerCase()
                        .includes(query.toLocaleLowerCase()),
                    )
                    .map((r) => (
                      <Button
                        key={r.resource_kind + r.id}
                        title={
                          (selected(r.resource_kind, r.id) ? "✓ " : "○ ") +
                          r.title +
                          (r.allowed ? "" : " · Not opted in / processing")
                        }
                        secondary={!selected(r.resource_kind, r.id)}
                        onPress={() =>
                          p.setSelected(
                            selected(r.resource_kind, r.id)
                              ? p.selected.filter(
                                  (x) =>
                                    x.kind !== r.resource_kind || x.id !== r.id,
                                )
                              : [
                                  ...p.selected,
                                  { kind: r.resource_kind, id: r.id },
                                ].slice(0, 200),
                          )
                        }
                      />
                    ))}
                </>
              )}
              <Button
                title="Reset to Current Project"
                secondary
                onPress={() => {
                  p.setScope("current_project");
                  p.setSelected([]);
                }}
              />
              <Label muted>
                Private documents require saved AI consent. Broader context
                resets on project changes. No Library Context excludes profile
                and library text.
              </Label>
            </>
          )}
        </Screen>
      </Modal>
    </View>
  );
}
