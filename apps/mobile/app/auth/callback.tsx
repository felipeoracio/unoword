import React from "react";
import { Redirect } from "expo-router";
// Google PKCE is exchanged by the pending native browser flow, never from URL tokens.
export default function Callback() {
  return <Redirect href="/" />;
}
