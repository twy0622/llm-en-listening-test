import { useEffect, useState } from "react";

/** Whole seconds remaining until an ISO deadline. */
export function useCountdown(deadline: string | undefined): number {
  const compute = () =>
    deadline ? Math.max(0, Math.ceil((Date.parse(deadline) - Date.now()) / 1000)) : 0;

  const [remaining, setRemaining] = useState<number>(compute);

  useEffect(() => {
    if (!deadline) return;
    setRemaining(compute());
    const timer = window.setInterval(() => setRemaining(compute()), 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);

  return remaining;
}
