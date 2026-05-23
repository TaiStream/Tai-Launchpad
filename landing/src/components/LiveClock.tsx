"use client";

import { useEffect, useState } from "react";

export default function LiveClock() {
  const [t, setT] = useState<string>("00:00:00");

  useEffect(() => {
    const update = () => {
      const d = new Date();
      const h = String(d.getUTCHours()).padStart(2, "0");
      const m = String(d.getUTCMinutes()).padStart(2, "0");
      const s = String(d.getUTCSeconds()).padStart(2, "0");
      setT(`${h}:${m}:${s}`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      className="font-display text-phosphor-dim text-xl leading-none tabular hidden md:inline"
      aria-label="current UTC time"
    >
      {t} <span className="text-phosphor-faint text-sm">UTC</span>
    </span>
  );
}
