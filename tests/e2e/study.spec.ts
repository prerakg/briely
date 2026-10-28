import JSZip from "jszip";
import { test, expect } from "@playwright/test";
const lecture = {
  id: "legacy-biology",
  title: "Biology foundations",
  date: "2026-10-01T10:00:00Z",
  duration: 120,
  transcriptText:
    "Plants absorb carbon dioxide. Photosynthesis uses sunlight to produce chemical energy.",
  sessions: [],
  chunks: [{ timestamp: 0, text: "Plants absorb carbon dioxide." }],
  tags: [],
  summary: {
    overview: "A legacy summary.",
    mainPoints: ["Saved material remains accessible."],
    keyTerms: [],
  },
  studyNotes: "# Legacy notes\nYour existing notes are preserved.",
  flashcards: [
    {
      front: "Plant gas?",
      back: "Carbon dioxide",
      difficulty: "Easy",
      topic: "Biology",
    },
  ],
  quiz: [
    {
      question: "What do plants absorb?",
      options: ["Carbon dioxide", "Helium"],
      correctAnswer: "Carbon dioxide",
      explanation: "Plants absorb carbon dioxide.",
    },
  ],
};
async function seed(page) {
  await page.addInitScript((value) => {
    if (!localStorage.getItem("kragle_transcripts"))
      localStorage.setItem("kragle_transcripts", JSON.stringify([value]));
  }, lecture);
}

test("legacy library, theme, notes, flashcards and practice quiz remain usable", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  await page.getByText("Biology foundations", { exact: true }).first().click();
  await expect(page.getByText("A legacy summary.")).toHaveCount(0);
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  await expect(page.getByText("A legacy summary.")).toBeVisible();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Legacy notes" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Flashcards", exact: true }).click();
  await expect(page.getByText("Plant gas?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Quiz", exact: true }).click();
  await expect(
    page.getByText("What do plants absorb?", { exact: true }),
  ).toBeVisible();
  await page.getByTitle("Toggle Dark Mode").click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("briefly_dark_mode")))
    .not.toBeNull();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("kragle_transcripts")!)[0].id,
      ),
    )
    .toBe("legacy-biology");
});

test("generate, edit, publish, second-browser guest attempt and creator analytics", async ({
  page,
  browser,
}) => {
  await seed(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Quiz Studio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Better together." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "✦ Create Quiz", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Make it your own." }),
  ).toBeVisible();
  await page
    .getByLabel("Quiz title", { exact: true })
    .fill("Shared biology challenge");
  await page.getByLabel("Time limit (minutes)").fill("2");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved.");
  await page.getByRole("button", { name: "Publish & Share →" }).click();
  const dialog = page.getByRole("dialog", { name: "Ready to share." });
  await expect(dialog).toBeVisible();
  const link = await dialog.getByLabel("Shareable link").inputValue();
  const recipient = await browser.newContext();
  const guest = await recipient.newPage();
  const responses: any[] = [];
  guest.on("response", async (r) => {
    if (
      r.url().includes("/shared-quizzes/") &&
      r.request().method() === "GET"
    ) {
      responses.push(await r.json());
    }
  });
  await guest.goto(link);
  await expect(
    guest.getByRole("heading", { name: "Shared biology challenge" }),
  ).toBeVisible();
  expect(JSON.stringify(responses)).not.toContain("source_quote");
  expect(JSON.stringify(responses)).not.toContain("correctAnswer");
  await guest.getByLabel("Your display name").fill("A friend");
  await guest.getByRole("button", { name: "Start Quiz →" }).click();
  await expect(
    guest.getByRole("button", { name: "Submit answers" }),
  ).toBeVisible();
  for (const fieldset of await guest.locator("fieldset").all())
    await fieldset.getByText("Carbon dioxide", { exact: true }).click();
  await guest.reload();
  await expect(guest.locator("input:checked")).toHaveCount(10);
  await guest.getByRole("button", { name: "Submit answers" }).click();
  await expect(
    guest.getByRole("heading", { name: "10 of 10 correct" }),
  ).toBeVisible();
  await guest.reload();
  await expect(
    guest.getByRole("heading", { name: "10 of 10 correct" }),
  ).toBeVisible();
  await dialog.getByLabel("Close dialog").click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Close editor" }).click();
  await page
    .getByRole("button", { name: "Analytics", exact: true })
    .first()
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "Quiz analytics" })
      .getByText("A friend", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Quiz analytics" })
    .screenshot({ path: "artifacts/quiz-analytics.png" });
  await recipient.close();
});

test("two browsers join a live battle and receive authoritative final rankings", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.request.post("/api/v1/auth/session");
  const draft = {
    title: "Quick battle",
    questions: [
      {
        id: "battle-q",
        question: "What do plants absorb?",
        type: "single",
        options: ["Carbon dioxide", "Helium"],
        correct: [0],
        explanation: "Plants absorb carbon dioxide.",
        difficulty: "easy",
        topic: "Biology",
        source_quote: "",
      },
    ],
    settings: {
      time_limit_seconds: 60,
      max_attempts: 3,
      show_explanations: true,
      shuffle_questions: false,
      shuffle_options: false,
      access: "public",
      leaderboard: false,
      expires_at: null,
    },
  };
  const q = await (
    await page.request.post("/api/v1/quizzes", { data: draft })
  ).json();
  const p = await (
    await page.request.post("/api/v1/quizzes/" + q.id + "/publish")
  ).json();
  const room = await (
    await page.request.post("/api/v1/quiz-rooms", {
      data: { share_id: p.share_id, round_seconds: 10 },
    })
  ).json();
  const context = await browser.newContext();
  const friend = await context.newPage();
  for (const [tab, name] of [
    [page, "Host"],
    [friend, "Friend"],
  ] as const) {
    await tab.goto(room.url);
    await tab.getByLabel("Display name", { exact: true }).fill(name);
    await tab.getByRole("button", { name: "Join Battle →" }).click();
    await tab.getByRole("button", { name: "I’m ready" }).click();
  }
  await expect(
    page.getByRole("button", { name: "Start Battle →" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Start Battle →" }).click();
  for (const tab of [page, friend]) {
    await expect(
      tab.getByText("What do plants absorb?", { exact: true }),
    ).toBeVisible();
    await tab.getByText("Carbon dioxide", { exact: true }).click();
    await tab
      .getByRole("button", { name: "Lock in answer", exact: true })
      .click();
  }
  await expect(friend.getByText("THE FINAL STANDINGS")).toBeVisible({
    timeout: 20000,
  });
  await expect(friend.getByText("1000", { exact: true })).toHaveCount(2);
  await context.close();
});

test("mobile studio has usable controls and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Quiz Studio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Better together." }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/quiz-studio-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test("old JSON import, export and multiple text sources remain usable", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "legacy.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ app: "BrieflyAI", version: "1.0", data: [lecture] }),
      ),
    });
  page.on("dialog", (d) => d.accept());
  await expect(
    page.getByText("Biology foundations", { exact: true }).first(),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/BrieflyAI_export/);
  await page.getByTitle("Upload Resources").click();
  await page.locator("input[type=file][multiple]").setInputFiles([
    {
      name: "first.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Plants absorb carbon dioxide."),
    },
    {
      name: "second.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Photosynthesis uses sunlight to produce chemical energy.",
      ),
    },
  ]);
  await page.getByRole("button", { name: "Combine & Generate" }).click();
  await expect(
    page.getByRole("heading", { name: "Generate AI Content" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("kragle_transcripts")!).some(
        (l: any) =>
          l.transcriptText.includes("first.txt") &&
          l.transcriptText.includes("second.txt"),
      ),
    ),
  ).toBeTruthy();
});

test("cloud library is opt-in, AI activity is real, and provider errors recover", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Quiz Studio", exact: true }).click();
  await page
    .getByRole("button", { name: "Cloud Library", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bring a source across devices." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save selected source to backend" })
    .click();
  await expect(page.getByRole("status")).toContainText("Selected source saved");
  await page.getByRole("button", { name: "Study locally" }).click();
  await expect(page.getByRole("status")).toContainText("Source copied");
  await page
    .getByRole("button", { name: "Quiz Studio", exact: true })
    .last()
    .click();
  await page.route("**/api/v1/quizzes/generate", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Provider quota exhausted. Try later." }),
    }),
  );
  await page
    .getByRole("button", { name: "✦ Create Quiz", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Provider quota exhausted",
  );
  await page.unroute("**/api/v1/quizzes/generate");
  await page
    .getByRole("button", { name: "✦ Create Quiz", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Make it your own." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "AI Activity", exact: true }).click();
  await expect(
    page.getByText("verification", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText(/controlled-test/).first()).toBeVisible();
});

test("desktop dark studio and public theme controls render correctly", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  await page.getByTitle("Toggle Dark Mode").click();
  await page.getByRole("button", { name: "Quiz Studio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Better together." }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/quiz-studio-desktop-dark.png",
    fullPage: true,
  });
});

test("source-grounded tutor, generated mind map and sanitized legacy notes work", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  await page.getByText("Biology foundations", { exact: true }).first().click();
  await page.getByRole("button", { name: "AI Chat", exact: true }).click();
  await page.getByPlaceholder(/Ask a question/i).fill("What do plants absorb?");
  await page.getByPlaceholder(/Ask a question/i).press("Enter");
  await expect(
    page.getByText("Plants absorb carbon dioxide. [Source section 1]", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mind Map", exact: true }).click();
  await page
    .getByRole("button", { name: "Generate with AI", exact: true })
    .click();
  await expect(
    page
      .locator("svg")
      .filter({ has: page.getByText("Photosynthesis", { exact: true }) })
      .first(),
  ).toBeVisible();
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("kragle_transcripts")!);
    data[0].studyNotes =
      '<img src=x onerror="window.__unsafe=true"><script>window.__unsafe=true</script>Safe note';
    localStorage.setItem("kragle_transcripts", JSON.stringify(data));
  });
  await page.reload();
  await page.getByText("Biology foundations", { exact: true }).first().click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByText("Safe note", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__unsafe)).toBeUndefined();
});

test("PDF, DOCX and PPTX parsers extract real uploaded content", async ({
  page,
}) => {
  const docx = new JSZip();
  docx.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  docx.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  docx.file(
    "word/document.xml",
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX plant lesson</w:t></w:r></w:p></w:body></w:document>',
  );
  const slides = new JSZip();
  slides.file(
    "ppt/slides/slide1.xml",
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Slide plant lesson</a:t></p:sld>',
  );
  const content = "BT /F1 18 Tf 30 150 Td (PDF plant lesson) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
    .join("")}trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF`;
  await page.goto("/");
  await page.getByTitle("Upload Resources").click();
  await page.locator("input[type=file][multiple]").setInputFiles([
    {
      name: "lesson.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(pdf),
    },
    {
      name: "lesson.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: await docx.generateAsync({ type: "nodebuffer" }),
    },
    {
      name: "lesson.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: await slides.generateAsync({ type: "nodebuffer" }),
    },
  ]);
  await page.getByRole("button", { name: "Combine & Generate" }).click();
  await expect(
    page.getByRole("heading", { name: "Generate AI Content" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  const text = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("kragle_transcripts")!)[0].transcriptText,
  );
  expect(text).toContain("PDF plant lesson");
  expect(text).toContain("DOCX plant lesson");
  expect(text).toContain("Slide plant lesson");
});

test("bulk study generation runs sequentially instead of exhausting the provider concurrently", async ({
  page,
}) => {
  let active = 0,
    maxActive = 0;
  const tasks: string[] = [];
  await page.route("**/api/v1/ai/generate", async (route) => {
    const data = route.request().postDataJSON();
    tasks.push(data.task);
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 75));
    const values: Record<string, unknown> = {
      summary: {
        overview: "Plants use light.",
        mainPoints: ["Plants absorb carbon dioxide."],
        keyTerms: [],
      },
      flashcards: [
        {
          front: "Plant gas?",
          back: "Carbon dioxide",
          difficulty: "Easy",
          topic: "Biology",
        },
      ],
      quiz: {
        questions: [
          {
            question: "What do plants absorb?",
            options: ["Carbon dioxide", "Helium"],
            correct: [0],
            explanation: "Plants absorb carbon dioxide.",
          },
        ],
      },
      notes: "# Study notes\nPlants use light.",
    };
    active--;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: values[data.task] }),
    });
  });
  await page.goto("/");
  await page.getByTitle("Upload Resources").click();
  await page.locator("input[type=file][multiple]").setInputFiles({
    name: "plants.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Plants absorb carbon dioxide and use sunlight to make chemical energy.",
    ),
  });
  await page.getByRole("button", { name: "Combine & Generate" }).click();
  await page
    .getByRole("button", { name: "Generate Selected", exact: true })
    .click();
  await expect(
    page.getByText("Plants use light.", { exact: true }),
  ).toBeVisible();
  await expect.poll(() => tasks.length).toBe(4);
  expect(maxActive).toBe(1);
  expect(tasks).toEqual(["summary", "flashcards", "quiz", "notes"]);
});

test("Create Quiz honors advanced types and difficulty in the actual editor flow", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Quiz Studio", exact: true }).click();
  for (const kind of ["boolean", "multiple", "single"]) {
    await page
      .getByText("Customize question count, difficulty and type", {
        exact: true,
      })
      .click();
    await page.getByLabel("Questions", { exact: true }).fill("3");
    await page
      .getByRole("combobox", { name: "Difficulty", exact: true })
      .selectOption("hard");
    await page
      .getByRole("combobox", { name: "Question type", exact: true })
      .selectOption(kind);
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/v1/quizzes/generate") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "✦ Create Quiz", exact: true })
      .click();
    const result = await (await response).json();
    expect(result.questions).toHaveLength(3);
    expect(
      result.questions.every((q) => q.type === kind && q.difficulty === "hard"),
    ).toBeTruthy();
    await expect(
      page.getByRole("heading", { name: "Make it your own." }),
    ).toBeVisible();
    const controls = page.getByRole("combobox", { name: "Type", exact: true });
    await expect(controls).toHaveCount(3);
    for (const control of await controls.all())
      expect(await control.inputValue()).toBe(kind);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Close editor" }).click();
  }
});
