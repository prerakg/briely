import { test, expect } from "@playwright/test";

const videoId = "dQw4w9WgXcQ";

test.beforeEach(async ({ page }) => {
  await page.route("https://noembed.com/**", (route) =>
    route.fulfill({ json: { title: "Controlled caption lesson" } }),
  );
});

test("YouTube import fetches through the API, selects a language, and preserves saved lectures", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem("kragle_transcripts"))
      localStorage.setItem(
        "kragle_transcripts",
        JSON.stringify([
          {
            id: "existing",
            title: "Existing lecture",
            transcriptText: "Keep my notes.",
            date: "2026-10-01",
            duration: 0,
            studyNotes: "Saved notes",
          },
        ]),
      );
  });
  await page.goto("/");
  await page.getByTitle("Import YouTube", { exact: true }).click();
  await page
    .getByLabel("YouTube Video URL")
    .fill(`https://www.youtube.com/shorts/${videoId}?si=test`);
  await page.getByRole("button", { name: "Fetch Video", exact: true }).click();
  await expect(
    page.getByText("Controlled caption lesson", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Select Transcript Language").locator("option"),
  ).toHaveCount(3);
  await page.getByLabel("Select Transcript Language").selectOption("1");
  await page
    .getByRole("button", { name: "Import Transcript", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("kragle_transcripts")!).length,
      ),
    )
    .toBe(2);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("kragle_transcripts")!),
  );
  expect(saved.find((lecture) => lecture.id === "existing").studyNotes).toBe(
    "Saved notes",
  );
  const imported = saved.find((lecture) => lecture.id !== "existing");
  expect(imported.transcriptText).toBe("पौधे प्रकाश का उपयोग करते हैं।");
  expect(imported.chunks).toEqual([
    { timestamp: 2.5, text: "पौधे प्रकाश का उपयोग करते हैं।" },
  ]);
  expect(imported.tags).toEqual(["YouTube", "hi"]);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page.reload();
  await page
    .getByText("Controlled caption lesson", { exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Summary", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("kragle_transcripts")!).length,
    ),
  ).toBe(2);
  expect(errors).toEqual([]);
});

test("watch, live, embed, mobile, and short links accept short captions and correct timestamps", async ({
  page,
}) => {
  await page.goto("/");
  for (const url of [
    `https://www.youtube.com/watch?list=example&v=${videoId}&t=10`,
    `https://youtube.com/live/${videoId}`,
    `https://www.youtube-nocookie.com/embed/${videoId}`,
    `https://m.youtube.com/watch?v=${videoId}`,
    `youtu.be/${videoId}?si=example`,
  ]) {
    await page.getByTitle("Import YouTube", { exact: true }).click();
    await page.getByLabel("YouTube Video URL").fill(url);
    await page
      .getByRole("button", { name: "Fetch Video", exact: true })
      .click();
    await expect(page.getByLabel("Select Transcript Language")).toHaveValue(
      "0",
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  const result = await page.evaluate(async () => {
    const modulePath = "/services/youtubeService.ts";
    const { getYoutubeVideoDetails, getYoutubeTranscript } = await import(
      /* @vite-ignore */ modulePath
    );
    const details = await getYoutubeVideoDetails("https://youtu.be/dQw4w9WgXcQ");
    details.transcripts[2] = await getYoutubeTranscript("dQw4w9WgXcQ", "es");
    return details;
  });
  expect(result.transcripts[0].text).toBe("Plants & light. 42");
  expect(result.transcripts[0].chunks.map((chunk) => chunk.timestamp)).toEqual([
    1.25, 4,
  ]);
  expect(result.transcripts[2].chunks[0].timestamp).toBe(1.75);
});

test("invalid URLs and provider errors show actionable errors and allow retry", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTitle("Import YouTube", { exact: true }).click();
  await page
    .getByLabel("YouTube Video URL")
    .fill(`https://evil.example/watch?v=${videoId}`);
  await page.getByRole("button", { name: "Fetch Video", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("valid YouTube");
  await page
    .getByLabel("YouTube Video URL")
    .fill("https://youtu.be/aaaaaaaaaaa");
  await page.getByRole("button", { name: "Fetch Video", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("quota or rate limit");
  await page
    .getByLabel("YouTube Video URL")
    .fill(`https://youtu.be/${videoId}`);
  await page.getByRole("button", { name: "Fetch Video", exact: true }).click();
  await expect(page.getByLabel("Select Transcript Language")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("an unavailable optional title service cannot block caption import", async ({
  page,
}) => {
  await page.unroute("https://noembed.com/**");
  await page.route("https://noembed.com/**", () => {});
  await page.goto("/");
  await page.getByTitle("Import YouTube", { exact: true }).click();
  await page
    .getByLabel("YouTube Video URL")
    .fill(`https://youtu.be/${videoId}`);
  await page.getByRole("button", { name: "Fetch Video", exact: true }).click();
  await expect(
    page.getByText(`YouTube Video ${videoId}`, { exact: true }),
  ).toBeVisible({ timeout: 8000 });
  await expect(
    page.getByRole("button", { name: "Import Transcript", exact: true }),
  ).toBeEnabled();
});

test("a missing API session reports a useful error and recovers on retry", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ status: 500, body: "" }),
  );
  await page.goto("/");
  await page.getByTitle("Import YouTube", { exact: true }).click();
  await page
    .getByLabel("YouTube Video URL")
    .fill(`https://youtu.be/${videoId}`);
  await page.getByRole("button", { name: "Fetch Video", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("npm run dev");
  await page.unroute("**/api/v1/auth/session");
  await page.getByRole("button", { name: "Fetch Video", exact: true }).click();
  await expect(page.getByLabel("Select Transcript Language")).toBeVisible();
});
