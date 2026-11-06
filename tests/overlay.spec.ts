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
    const omarchy = { colors: "", delay: 0 };
    (window as any).__TAURI_OS_PLUGIN_INTERNALS__ = { platform: "linux" };
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
        if (command === "plugin:fs|read_text_file") {
          const colors = omarchy.colors;
          if (omarchy.delay)
            await new Promise((resolve) => setTimeout(resolve, omarchy.delay));
          if (!colors) throw new Error("No Omarchy theme");
          return Array.from(new TextEncoder().encode(colors));
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
      omarchy,
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

test("System appearance follows Omarchy changes and explicit themes take priority", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).overlayTest.omarchy.colors =
      'mode = "dark"\nbackground = "#121212"\nforeground = "#bebebe"\naccent = "#e68e0d"';
  });
  await emit(page, "theme-changed", "system");
  await emit(page, "show-overlay", "recording");
  await emit(page, "recording-ready");
  await expect(page.locator(".scard")).toHaveCSS(
    "background-color",
    "rgb(18, 18, 18)",
  );
  await expect(page.locator(".swave i").first()).toHaveCSS(
    "background-color",
    "rgb(230, 142, 13)",
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: "/tmp/handy-linux-evidence/omarchy-matte-black.png",
  });
  await page.evaluate(() => {
    (window as any).overlayTest.omarchy.colors =
      'mode = "light"\nbackground = "#fafafa"\nforeground = "#232323"\naccent = "#2255aa"';
  });
  await expect(page.locator(".scard")).toHaveCSS(
    "background-color",
    "rgb(250, 250, 250)",
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".swave i").first()).toHaveCSS(
    "background-color",
    "rgb(34, 85, 170)",
  );
  await emit(page, "theme-changed", "dark");
  await expect(page.locator(".scard")).toHaveCSS(
    "background-color",
    "rgb(44, 43, 41)",
  );
  await page.waitForTimeout(2200);
  await expect(page.locator(".scard")).toHaveCSS(
    "background-color",
    "rgb(44, 43, 41)",
  );
});

test("missing or invalid Omarchy colors fall back to the desktop theme", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await emit(page, "theme-changed", "system");
  await emit(page, "show-overlay", "recording");
  await expect(page.locator(".scard")).toHaveCSS(
    "background-color",
    "rgb(251, 251, 251)",
  );
  await page.evaluate(() => {
    (window as any).overlayTest.omarchy.colors =
      'background = "#112233"\nforeground = "#ffffff"\naccent = "url(https://invalid.example/)"';
  });
  await page.waitForTimeout(2200);
  await expect(page.locator(".scard")).toHaveCSS(
    "background-color",
    "rgb(251, 251, 251)",
  );
});

test("an in-flight Omarchy read cannot overwrite an explicit appearance", async ({
  page,
}) => {
  await page.evaluate(() => {
    Object.assign((window as any).overlayTest.omarchy, {
      colors:
        'background = "#121212"\nforeground = "#bebebe"\naccent = "#e68e0d"',
      delay: 300,
    });
  });
  await emit(page, "theme-changed", "system");
  await emit(page, "theme-changed", "light");
  await emit(page, "show-overlay", "recording");
  await page.waitForTimeout(500);
  await expect(page.locator(".scard")).toHaveCSS(
    "background-color",
    "rgb(251, 251, 251)",
  );
});

test("upstream model loading states keep the live popup and timer usable", async ({
  page,
}) => {
  await emit(page, "show-overlay", "streaming");
  await expect(page.locator(".scard")).toBeVisible();
  await emit(page, "recording-ready");
  await emit(page, "model-state-changed", { event_type: "loading_started" });
  await expect(page.locator(".sloading")).toBeVisible({ timeout: 3500 });
  await expect(page.locator(".scard")).toHaveClass(/open/);
  await expect(page.locator(".stimer")).toBeVisible();
  await emit(page, "stream-phase-event", {
    phase: "working",
    kind: "transcribing",
  });
  await expect(page.locator(".swork-label")).toHaveText("Loading model...");
  await emit(page, "model-state-changed", { event_type: "loading_completed" });
  await expect(page.locator(".swork-label")).toHaveText("Transcribing...");
});

test("upstream notices fit compact and live windows and cannot hide the next recording", async ({
  page,
}) => {
  const notice = {
    code: "PasteFailed",
    level: "warning",
    source: "Dictation",
    detail: null,
  };
  for (const state of ["notice", "live_notice"]) {
    await page.setViewportSize(
      state === "notice"
        ? { width: 320, height: 88 }
        : { width: 440, height: 160 },
    );
    await emit(page, "overlay-notice", notice);
    await emit(page, "show-overlay", state);
    await expect(page.locator(".scard.cnotice")).toBeVisible();
    await expect(page.locator(".nlabel:not(.nprobe)")).not.toBeEmpty();
    await page.waitForTimeout(500);
    const box = (await page.locator(".scard").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await page.locator(".scard").click();
    expect(
      await page.evaluate(() => (window as any).overlayTest.calls),
    ).toContain("dismiss_overlay_notice");
    await emit(page, "hide-overlay");
    await emit(page, "show-overlay", "recording");
    await page.waitForTimeout(400);
    await expect(page.locator(".scard")).toBeVisible();
    await expect(page.locator(".scard")).not.toHaveClass(/cnotice/);
    await expect(page.locator(".stimer")).toBeVisible();
  }
});
