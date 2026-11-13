import { useState } from "react";

export function App() {
  const [count, setCount] = useState(0);

  return (
    <main>
      <h1>カウンター</h1>
      <p aria-live="polite">現在の値は {count} です。</p>
      <button type="button" onClick={() => setCount(value => value + 1)}>
        1 増やす
      </button>
    </main>
  );
}
