"use client"

import { useEffect, useState } from "react"
import { db } from "@/lib/persistence/db"
import { AppPreferences } from "@/types/models"

const DEFAULT_PREFERENCES: AppPreferences = {
  unitSystem: "imperial",
  displayDecimalFeet: false,
  darkMode: "system",
}

const ONBOARDING_STEPS = [
  <>
    Welcome to{" "}
    <span
      style={{
        fontFamily: '"Iowan Old Style", "Palatino Linotype", Georgia, serif',
        fontStyle: "italic",
        letterSpacing: "0.02em",
      }}
    >
      Roof Compute
    </span>
  </>,
  <>Tap on map to place tape.</>,
  <>Tap on displayed ft marker to assign type: ridge, hip, valley, rake, eave.</>,
  <>
    For best accuracy, tap around each roof plane. Planes turn blue when
    completed.
  </>,
  <>
    Tap on blue plane to assign pitch.
  </>,
  <>
    Each address measured saves locally to your device and can be revisited.
  </>,
]

export function FirstRunOnboarding({ replayVersion = 0 }: { replayVersion?: number }) {
  const [isReady, setIsReady] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [step, setStep] = useState(0)
  const [doNotShowAgain, setDoNotShowAgain] = useState(false)
  const [isFinishing, setIsFinishing] = useState(false)

  useEffect(() => {
    let cancelled = false

    void db
      .getPreferences()
      .then((preferences) => {
        if (cancelled) return
        setIsVisible(preferences?.onboardingDismissed !== true)
        setIsReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setIsVisible(true)
        setIsReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (replayVersion === 0) return

    setStep(0)
    setDoNotShowAgain(false)
    setIsVisible(true)
    void db
      .getPreferences()
      .then((preferences) =>
        db.savePreferences({
          ...DEFAULT_PREFERENCES,
          ...preferences,
          onboardingDismissed: false,
        }),
      )
      .catch(() => undefined)
  }, [replayVersion])

  async function handleNext() {
    const isLastStep = step === ONBOARDING_STEPS.length - 1
    if (!isLastStep) {
      setStep((current) => current + 1)
      return
    }

    if (doNotShowAgain) {
      setIsFinishing(true)
      try {
        const preferences = await db.getPreferences()
        await db.savePreferences({
          ...DEFAULT_PREFERENCES,
          ...preferences,
          onboardingDismissed: true,
        })
      } catch {
        // The tutorial remains dismissible if local storage is temporarily unavailable.
      } finally {
        setIsFinishing(false)
      }
    }

    setIsVisible(false)
  }

  if (!isReady || !isVisible) return null

  const isLastStep = step === ONBOARDING_STEPS.length - 1

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label="Roof Compute introduction"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9_999,
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "rgba(31, 102, 199, 0.3)",
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          display: "grid",
          gap: 26,
          color: "#fff",
          textAlign: "center",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: "clamp(26px, 5vw, 42px)",
            fontWeight: 600,
            lineHeight: 1.2,
            textShadow: "0 2px 14px rgba(9, 39, 83, 0.35)",
          }}
        >
          {ONBOARDING_STEPS[step]}
        </p>
        {isLastStep ? (
          <label
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 9,
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={doNotShowAgain}
              onChange={(event) => setDoNotShowAgain(event.target.checked)}
              style={{ width: 17, height: 17, accentColor: "#fff" }}
            />
            Do not show this again
          </label>
        ) : null}
        <button
          type="button"
          onClick={() => void handleNext()}
          disabled={isFinishing}
          style={{
            justifySelf: "center",
            minWidth: 116,
            border: "1px solid rgba(255, 255, 255, 0.8)",
            borderRadius: 999,
            background: "#fff",
            color: "#1f66c7",
            padding: "11px 18px",
            fontSize: 15,
            fontWeight: 800,
            cursor: isFinishing ? "wait" : "pointer",
            opacity: isFinishing ? 0.7 : 1,
          }}
        >
          Next &gt;
        </button>
      </div>
    </section>
  )
}
