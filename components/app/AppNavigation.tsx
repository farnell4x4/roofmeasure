"use client";

import { FolderOpen, Home, MapPinned, Menu, X } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/ToastProvider";
import { canCreateLocalProject, LOCAL_PROJECT_LIMIT_MESSAGE } from "@/lib/billing/local-access";

type AppPath = "/" | "/projects" | "/?new=1";

export function AppNavigation() {
  const router = useRouter();
  const { push } = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  function navigate(path: AppPath) {
    setMobileMenuOpen(false);
    router.push(path);
  }

  async function handleNewProject() {
    if (!(await canCreateLocalProject())) {
      setMobileMenuOpen(false);
      push({ title: LOCAL_PROJECT_LIMIT_MESSAGE, tone: "default" });
      return;
    }
    navigate("/?new=1");
  }

  return (
    <nav className="subscription-navigation" aria-label="App navigation">
      <div className="subscription-navigation__desktop">
        <Button variant="ghost" onClick={() => navigate("/")}>
          <Home size={18} /> Home
        </Button>
        <Button variant="ghost" onClick={() => navigate("/projects")}>
          <FolderOpen size={18} /> Saved Projects
        </Button>
        <Button variant="ghost" onClick={() => void handleNewProject()}>
          <MapPinned size={18} /> New Project
        </Button>
      </div>
      <div className="subscription-navigation__mobile">
        <Button
          variant="ghost"
          aria-expanded={mobileMenuOpen}
          aria-controls="app-mobile-menu"
          onClick={() => setMobileMenuOpen((current) => !current)}
        >
          {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />} Menu
        </Button>
        {mobileMenuOpen ? (
          <div id="app-mobile-menu" className="subscription-navigation__menu">
            <Button variant="ghost" onClick={() => navigate("/")}>
              <Home size={18} /> Home
            </Button>
            <Button variant="ghost" onClick={() => navigate("/projects")}>
              <FolderOpen size={18} /> Saved Projects
            </Button>
            <Button variant="ghost" onClick={() => void handleNewProject()}>
              <MapPinned size={18} /> New Project
            </Button>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
