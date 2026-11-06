import { test, expect, type Page } from "@playwright/test";

async function emit(page: Page, event: string, payload: unknown = null) {
  await page.evaluate(
    ({ event, payload }) => {
      (window as any).overlayTest.emit(event, payload);
    },
    { event, payload },
  );
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 160 });
  await page.addInitScript(() => {
    let id = 0;
    const callbacks = new Map<number, Function>();
    const listeners = new Map<number, { event: string; handler: number }>();
    const calls: string[] = [];
    const settings = {
      theme: "dark",
      ui_language: "en",
      overlay_position: "bottom",
    };
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback(callback: Function) {
        callbacks.set(++id, callback);
        return id;
      },
      unregisterCallback(key: number) {
        callbacks.delete(key);
      },
      async invoke(command: string, args: any) {
        calls.push(command);
        if (command === "plugin:event|listen") {
          listeners.set(++id, args);
          return id;
        }
        if (command === "plugin:event|unlisten") {
          listeners.delete(args.eventId);
          return;
        }
        if (command === "get_app_settings") return settings;
        if (command === "plugin:os|locale") return "en-US";
        return null;
      },
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener() {},
    };
    (window as any).overlayTest = {
      calls,
      settings,
      emit(event: string, payload: unknown) {
        for (const [key, listener] of listeners) {
          if (listener.event === event)
            callbacks.get(listener.handler)?.({ event, id: key, payload });
        }
      },
      ready: () =>
        [...listeners.values()].some((l) => l.event === "stream-phase-event"),
    };
  });
  await page.goto("/src/overlay/index.html");
  await page.waitForFunction(() => (window as any).overlayTest.ready());
});

test("compact recording shows elapsed time and an accessible cancel control", async ({
  page,
}) => {
  await emit(page, "show-overlay", "recording");
  await expect(page.locator(".scard")).toBeVisible();
  await emit(page, "recording-ready");
  await expect(page.locator(".stimer")).toHaveText("0:01", { timeout: 2500 });
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  await expect(cancel).toBeVisible();
  expect((await cancel.boundingBox())!.width).toBeGreaterThanOrEqual(32);
  await cancel.click();
  expect(
    await page.evaluate(() => (window as any).overlayTest.calls),
  ).toContain("cancel_operation");
});

test("recording, processing and live text stay inside the native window", async ({
  page,
}) => {
  for (const state of [
    "recording",
    "transcribing",
    "processing",
    "streaming",
  ]) {
    await page.setViewportSize({
      width: state === "streaming" ? 440 : 320,
      height: state === "streaming" ? 160 : 88,
    });
    await emit(page, "show-overlay", state);
    await expect(page.locator(".scard")).toBeVisible();
    await emit(page, "recording-ready");
    await emit(page, "mic-level", [0.1, 0.3, 0.55, 0.8, 1, 0.7, 0.5, 0.2, 0.1]);
    if (state === "streaming")
      await emit(page, "stream-text-event", {
        committed: "A clear live transcript stays readable while you speak.",
        tentative: "Next words",
      });
    await page.waitForTimeout(500);
    const box = (await page.locator(".scard").boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: `/tmp/handy-linux-evidence/${state}.png` });
  }
  await emit(page, "hide-overlay");
  await expect(page.locator(".scard")).toHaveCount(0);
});

test("light theme, top placement and reduced motion remain usable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    Object.assign((window as any).overlayTest.settings, {
      theme: "light",
      overlay_position: "top",
    });
  });
  await emit(page, "theme-changed", "light");
  await emit(page, "show-overlay", "streaming");
  await expect(page.locator(".scard")).toBeVisible();
  await emit(page, "recording-ready");
  await emit(page, "stream-text-event", {
    committed: "A readable transcript in a light theme.",
    tentative: "",
  });
  await expect(page.locator(".ov-stage.top")).toBeVisible();
  await expect(page.locator(".scard")).toHaveCSS(
    "background-color",
    "rgb(251, 251, 251)",
  );
  await expect(page.locator(".sdot")).toHaveCSS("animation-name", "none");
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/handy-linux-evidence/light-top-reduced.png",
  });
});

test("a new recording survives repeated hide events from the previous session", async ({
  page,
}) => {
  await emit(page, "show-overlay", "recording");
  await expect(page.locator(".scard")).toBeVisible();
  await emit(page, "hide-overlay");
  await emit(page, "hide-overlay");
  await page.waitForTimeout(50);
  await emit(page, "show-overlay", "recording");
  await page.waitForTimeout(400);
  await expect(page.locator(".scard")).toBeVisible();
});
