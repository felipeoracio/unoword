import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { EDITOR_HTML } from "../generated/editor-html";
import type { JSONNode } from "../core/types";
import { useTheme } from "./ui";
export type EditorHandle = {
  command: (command: string, href?: string) => void;
  snapshot: () => void;
};
export type EditorChange = {
  id: string;
  content: JSONNode;
  text: string;
  before: string;
  inputType: string;
};
export const RichEditor = forwardRef<
  EditorHandle,
  {
    id: string;
    content: JSONNode;
    editable: boolean;
    onChange: (value: EditorChange) => void;
    onError: (message: string) => void;
  }
>(function RichEditor({ id, content, editable, onChange, onError }, ref) {
  const view = useRef<WebView<{}>>(null),
    ready = useRef(false),
    loaded = useRef(false),
    initial = useRef({ id, content, editable });
  const p = useTheme();
  const send = (message: object) =>
    view.current?.injectJavaScript(
      `window.unoEditorReceive(${JSON.stringify(message).replace(/</g, "\\u003c")});true;`,
    );
  useImperativeHandle(ref, () => ({
    command: (command, href) => send({ type: "command", command, href }),
    snapshot: () => send({ type: "snapshot" }),
  }));
  useEffect(() => {
    if (ready.current)
      send({ type: "theme", value: p.bg === "#0B1220" ? "dark" : "light" });
  }, [p.bg]);
  useEffect(() => {
    if (ready.current) send({ type: "editable", value: editable });
  }, [editable]);
  const message = (event: WebViewMessageEvent) => {
    try {
      const value = JSON.parse(event.nativeEvent.data);
      if (value.type === "ready") {
        ready.current = true;
        send({ type: "load", ...initial.current });
        send({ type: "theme", value: p.bg === "#0B1220" ? "dark" : "light" });
      } else if (value.type === "loaded") loaded.current = true;
      else if (value.type === "error") onError(value.message);
      else if (value.type === "change" && loaded.current && value.id === id)
        onChange(value);
    } catch {
      onError(
        "The editing canvas could not respond. Your saved writing is preserved.",
      );
    }
  };
  return (
    <View style={{ flex: 1, minHeight: 100, backgroundColor: p.card }}>
      <WebView<{}>
        ref={view}
        source={{ html: EDITOR_HTML, baseUrl: "about:blank" }}
        originWhitelist={["about:*"]}
        onMessage={message}
        onShouldStartLoadWithRequest={(request) =>
          request.url === "about:blank"
        }
        javaScriptEnabled
        domStorageEnabled={false}
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        setSupportMultipleWindows={false}
        onError={() =>
          onError("The editor could not load. Your document is preserved.")
        }
        style={{ backgroundColor: p.card }}
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView={false}
      />
    </View>
  );
});
