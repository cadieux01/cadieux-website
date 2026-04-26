"use client";

import { useState } from "react";
import LoadingScreen from "./LoadingScreen";
import PageContent from "@/components/PageContent";

export default function ClientApp() {
  const [introDone, setIntroDone] = useState(false);
  return (
    <div id="main-page">
      {!introDone && <LoadingScreen onComplete={() => setIntroDone(true)} />}
      <PageContent />
    </div>
  );
}
