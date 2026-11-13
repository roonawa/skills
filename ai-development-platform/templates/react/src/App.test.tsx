import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

test("ボタンを押すと表示値が 0 から 1 に変わる", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(() => root.render(<App />));
    assert.equal(container.querySelector("p")?.textContent, "現在の値は 0 です。");
    const button = container.querySelector("button");
    if (!button) throw new Error("Missing increment button");
    await act(() => button.click());
    assert.equal(container.querySelector("p")?.textContent, "現在の値は 1 です。");
  } finally {
    await act(() => root.unmount());
    dom.window.close();
  }
});
