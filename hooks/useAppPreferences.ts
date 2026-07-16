"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/db";
import { AppPreferences } from "@/types/models";

const defaultPreferences: AppPreferences = {
  unitSystem: "imperial",
  displayDecimalFeet: false,
  darkMode: "system"
};

export function useAppPreferences() {
  const [preferences, setPreferences] = useState<AppPreferences>(defaultPreferences);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    db.getPreferences()
      .then((stored) => {
        if (stored) setPreferences(stored);
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    db.savePreferences(preferences).catch(() => undefined);
  }, [preferences, ready]);

  return { preferences, setPreferences, ready };
}
