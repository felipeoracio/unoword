import React, { createContext, useContext, useEffect, useState } from "react";
const Context = createContext<any>(null);
export const FixtureProvider = Context.Provider;
export function useApp() {
  return useContext(Context);
}
export function useRepository() {
  const { repo } = useApp();
  const [, update] = useState(0);
  useEffect(() => repo?.subscribe(() => update((n) => n + 1)), [repo]);
  return repo;
}
