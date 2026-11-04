import React, { useState } from "react";
import { Alert, View } from "react-native";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { supabase } from "../services/supabase";
import { WEB_URL } from "../services/config";
import { Button, Card, Heading, Input, Label, Screen } from "../components/ui";
WebBrowser.maybeCompleteAuthSession();
export function Login() {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const login = async () => {
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase!.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
    } catch {
      setError(
        "Could not sign in. Check your email and password, and confirm your email if needed.",
      );
    } finally {
      setBusy(false);
    }
  };
  const google = async () => {
    if (Constants.appOwnership === "expo") {
      Alert.alert(
        "Google sign-in needs a development build",
        "Expo Go cannot register UnoWord’s private OAuth callback scheme. Use your existing email/password here. Google-only users can set a password through the website’s recovery flow, without creating another account.",
      );
      return;
    }
    setBusy(true);
    try {
      const redirect = Linking.createURL("auth/callback");
      const { data, error } = await supabase!.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirect, skipBrowserRedirect: true },
      });
      if (error || !data.url) throw error;
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirect);
      if (result.type === "success") {
        const url = new URL(result.url);
        const code = url.searchParams.get("code");
        if (
          url.protocol !== "unoword:" ||
          url.hostname !== "auth" ||
          url.pathname !== "/callback" ||
          !code
        )
          throw new Error("Invalid callback");
        const { error } = await supabase!.auth.exchangeCodeForSession(code);
        if (error) throw error;
      }
    } catch {
      setError(
        "Google sign-in could not finish. Verify the production callback configuration or use email/password.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <View
        style={{
          paddingTop: 35,
          gap: 12,
          maxWidth: 480,
          width: "100%",
          alignSelf: "center",
        }}
      >
        <Label size={30} style={{ fontWeight: "900", color: "#0866FF" }}>
          UnoWord
        </Label>
        <Heading>Your Words. Your Voice. Your Story.</Heading>
        <Label muted>One account. One writing journey. Every device.</Label>
        <Card>
          {!supabase ? (
            <>
              <Heading>Connect your existing project</Heading>
              <Label>
                The backend’s public mobile configuration is unavailable. Deploy
                the mobile setup endpoint, or copy .env.example to .env.local in
                apps/mobile and add your existing Supabase publishable or anon
                key. Restart Expo after changing settings.
              </Label>
              <Label muted>
                Never add a service-role, Stripe, or AI secret to this app.
              </Label>
            </>
          ) : (
            <>
              <Label style={{ fontWeight: "700" }}>Welcome back</Label>
              <Input
                accessibilityLabel="Email address"
                placeholder="Email address"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                textContentType="username"
                autoComplete="email"
              />
              <Input
                accessibilityLabel="Password"
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                autoComplete="current-password"
                onSubmitEditing={() => void login()}
              />
              {!!error && <Label>{error}</Label>}
              <Button
                title={busy ? "Signing in…" : "Sign in"}
                onPress={() => void login()}
                disabled={busy || !email || !password}
              />
              <Button
                title="Continue with Google"
                secondary
                onPress={() => void google()}
                disabled={busy}
              />
              <Button
                title="Create a free account"
                secondary
                onPress={() =>
                  void WebBrowser.openBrowserAsync(
                    WEB_URL + "/account?mode=signup",
                  )
                }
              />
              <Button
                title="Forgot password?"
                secondary
                onPress={() =>
                  void WebBrowser.openBrowserAsync(
                    WEB_URL + "/account?mode=recovery",
                  )
                }
              />
              <Label muted size={13}>
                Registration and email recovery use the existing secure website
                flow. After confirming your email or setting a password, return
                here to sign in.
              </Label>
            </>
          )}
        </Card>
        <Label muted size={13}>
          Every idea starts with UnoWord.
        </Label>
      </View>
    </Screen>
  );
}
