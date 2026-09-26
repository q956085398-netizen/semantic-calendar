// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 发布文档守卫（SC-022 验收：README 与真实实现一致）。
 *
 * 发布门槛与验收记录的价值全在「引用的东西真的存在」：README 指向的模块、
 * docs 之间的相对链接、`npm run` 命令、`SC-0NN` 编号，以及「这个用例保护了它」
 * 这句断言。这些引用跨三类文件（Markdown / package.json / 测试源码），改名字、
 * 拆文件、调脚本时最容易只改一半——本文件把它们变成可执行的断言。
 *
 * 只读文档与源码：打包与安装本身不在测试里跑（产物与实机验收见 docs/release.md）。
 */

const DESKTOP_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const REPO_ROOT = path.resolve(DESKTOP_ROOT, "../..");

/** 递归收集目录下的文件（相对仓库根、`/` 分隔），可跳过依赖与构建产物目录。 */
function collectFiles(
  dir: string,
  predicate: (file: string) => boolean,
  skipDirs: ReadonlySet<string> = new Set(),
): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path.join(REPO_ROOT, dir), {
    withFileTypes: true,
  })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) {
        files.push(...collectFiles(relative, predicate, skipDirs));
      }
      continue;
    }
    if (predicate(relative)) files.push(relative);
  }
  return files;
}

/** 被守卫的文档：README 与 docs/ 下的全部 Markdown（含 docs/agents/）。 */
const DOCS = [
  "README.md",
  ...collectFiles("docs", (file) => file.endsWith(".md")),
];
const DOC_TEXT = new Map(
  DOCS.map((doc) => [doc, readFileSync(path.join(REPO_ROOT, doc), "utf8")]),
);

/**
 * `npm test` 会跑到的测试文件：apps/desktop 下的 `*.test.ts(x)`。
 * 只数这一种后缀，与文档里「N 个测试文件」的口径一致（`.spec.*` 不在其中）；
 * 用例总数只有跑一次全量才知道，因此只比对两处文档的口径，见最后一组断言。
 */
const TEST_FILES = collectFiles(
  "apps/desktop",
  (file) => /\.test\.tsx?$/.test(file),
  new Set(["node_modules", "dist"]),
);

/** 按文件名索引 apps/desktop/src，用于解析文档里的简写引用。 */
const SOURCE_INDEX = new Map<string, string[]>();
for (const file of collectFiles("apps/desktop/src", () => true)) {
  const name = path.basename(file);
  SOURCE_INDEX.set(name, [...(SOURCE_INDEX.get(name) ?? []), file]);
}

/**
 * 文档里的测试文件引用有两种写法：从仓库根写全（`apps/desktop/src/x.test.ts`），
 * 或只写文件名（`x.test.ts`，相对 `apps/desktop/src`）。两种都解析成唯一一份文件；
 * 文件名重名时返回 null——那时文档应该写路径，而不是让读者猜是哪一份。
 */
function resolveTestFile(cited: string): string | null {
  if (existsSync(path.join(REPO_ROOT, cited))) return cited;
  const candidates = SOURCE_INDEX.get(path.basename(cited)) ?? [];
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * 文件里写出来的字符串字面量。用例名应该落在其中：只在注释或正文里出现的
 * 名字不算证据（那正是本次修掉的一处引用——把注释当成用例名写进了验收记录）。
 */
function stringLiterals(absolutePath: string): string[] {
  return [...readFileSync(absolutePath, "utf8").matchAll(/"([^"\n]*)"/g)].map(
    (match) => match[1],
  );
}

const TEST_FILE = /[\w./-]+\.test\.tsx?/g;
/** 引用形如 `x.test.ts`「用例名」，或 `x.test.tsx` 的「用例名」一组。 */
const CASE_NAME_CITED = /([\w./-]+\.test\.tsx?)`?(?: 的)?「([^」]+)」/g;

const TEST_CITATIONS = DOCS.flatMap((doc) =>
  [...DOC_TEXT.get(doc)!.matchAll(TEST_FILE)].map((match) => ({
    doc,
    cited: match[0],
  })),
);

const CASE_NAME_CITATIONS = DOCS.flatMap((doc) =>
  [...DOC_TEXT.get(doc)!.matchAll(CASE_NAME_CITED)].map((match) => ({
    doc,
    cited: match[1],
    name: match[2],
  })),
);

const REGISTERED_TICKETS = new Set(
  readFileSync(path.join(REPO_ROOT, "docs/tickets.md"), "utf8").match(
    /SC-\d{3}/g,
  ) ?? [],
);

const MENTIONED_TICKETS = DOCS.flatMap((doc) =>
  [...DOC_TEXT.get(doc)!.matchAll(/SC-\d{3}/g)].map((match) => ({
    doc,
    ticket: match[0],
  })),
);

/** README 的功能状态清单就是「MVP：v0.1」一节。 */
function readmeMvpSection(): string {
  const section = DOC_TEXT.get("README.md")!
    .split(/\n(?=## )/)
    .find((part) => part.startsWith("## MVP：v0.1"));
  expect(section, "README 应有「## MVP：v0.1」一节").toBeDefined();
  return section!;
}

describe("发布文档守卫（SC-022 验收：README 与真实实现一致）", () => {
  it("文档引用的测试文件都存在（写全路径，或写唯一的文件名）", () => {
    // 守卫本身有效：文档确实引用了一批测试文件，不是扫了个空集合。
    expect(TEST_CITATIONS.length).toBeGreaterThan(50);

    const unresolved = TEST_CITATIONS.filter(
      (citation) => resolveTestFile(citation.cited) === null,
    ).map((citation) => `${citation.doc}: ${citation.cited}`);

    expect(unresolved).toEqual([]);
  });

  it("紧跟测试文件引用的用例名，确实是那个文件里写出来的名字", () => {
    // 「…」表示名字太长而省略尾部，因此只比对省略号之前的部分。
    // 这样的引用要足够多，守卫才不是摆设。
    expect(CASE_NAME_CITATIONS.length).toBeGreaterThan(25);

    const missing = CASE_NAME_CITATIONS.flatMap((citation) => {
      const file = resolveTestFile(citation.cited);
      if (file === null) return [];
      const prefix = citation.name.split("…")[0];
      const found = stringLiterals(path.join(REPO_ROOT, file)).some((literal) =>
        literal.includes(prefix),
      );
      return found
        ? []
        : [`${citation.doc}: ${citation.cited}「${citation.name}」`];
    });

    expect(missing).toEqual([]);
  });

  it("文档之间的相对链接都能从文档自身解析", () => {
    expect(DOCS.length).toBeGreaterThan(10);

    const broken: string[] = [];
    for (const doc of DOCS) {
      for (const match of DOC_TEXT.get(doc)!.matchAll(
        /\]\((?!https?:|#)([^)#]+)/g,
      )) {
        const target = match[1];
        const resolved = path.resolve(
          path.join(REPO_ROOT, path.dirname(doc)),
          target,
        );
        if (!existsSync(resolved)) broken.push(`${doc}: ${target}`);
      }
    }

    expect(broken).toEqual([]);
  });

  it("文档里提到的 Ticket 都已登记在 docs/tickets.md", () => {
    expect(MENTIONED_TICKETS.length).toBeGreaterThan(50);

    const unregistered = MENTIONED_TICKETS.filter(
      (mention) => !REGISTERED_TICKETS.has(mention.ticket),
    ).map((mention) => `${mention.doc}: ${mention.ticket}`);

    expect(unregistered).toEqual([]);
  });

  it("docs/tickets.md 里的每个 Ticket 都出现在 README 的「MVP：v0.1」清单里", () => {
    // Ticket 表与功能状态清单是同一件事的两份视图：工作清单里登记过的每一项，
    // 都该在 README 的清单里有落点，否则功能状态单方面滞后于工作清单。
    expect(REGISTERED_TICKETS.size).toBeGreaterThan(20);

    const mvp = readmeMvpSection();
    const missing = [...REGISTERED_TICKETS].filter(
      (ticket) => !mvp.includes(ticket),
    );

    expect(missing).toEqual([]);
  });

  it("docs 里 `README「X」` 指向的内容真的在 README 里", () => {
    // 发布门槛的证据行常写「README『…』已更新」这类指认。
    // 指认的名字必须真能在 README 里找到，否则证据指向的是不存在的内容。
    const citations = DOCS.filter((doc) => doc !== "README.md").flatMap((doc) =>
      [...DOC_TEXT.get(doc)!.matchAll(/README(?: 的)?「([^」]+)」/g)].map(
        (match) => ({ doc, name: match[1] }),
      ),
    );
    expect(citations.length).toBeGreaterThan(3);

    const readme = DOC_TEXT.get("README.md")!;
    const missing = citations
      .filter((citation) => !readme.includes(citation.name))
      .map((citation) => `${citation.doc}: 「${citation.name}」`);

    expect(missing).toEqual([]);
  });

  it("文档里的 npm 命令都是真实的脚本，展开写法也与脚本一致", () => {
    const rootScripts = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    ).scripts as Record<string, string>;
    const desktopScripts = JSON.parse(
      readFileSync(path.join(DESKTOP_ROOT, "package.json"), "utf8"),
    ).scripts as Record<string, string>;

    /** 根脚本多为 `npm run X --workspace @semantic-calendar/desktop` 的转发。 */
    const actualCommand = (name: string): string | undefined => {
      const root = rootScripts[name];
      if (root === undefined) return undefined;
      const forwarded = root.match(
        /^npm run (\S+) --workspace @semantic-calendar\/desktop$/,
      );
      return forwarded ? desktopScripts[forwarded[1]] : root;
    };

    const documented = DOCS.flatMap((doc) => [
      ...[...DOC_TEXT.get(doc)!.matchAll(/npm run ([a-z:-]+)/g)].map(
        (match) => ({ doc, name: match[1], expansion: null as string | null }),
      ),
      ...[...DOC_TEXT.get(doc)!.matchAll(/npm run ([a-z:-]+)\s+# = (.+)/g)].map(
        (match) => ({ doc, name: match[1], expansion: match[2].trim() }),
      ),
    ]);
    expect(documented.length).toBeGreaterThan(20);

    const unknown = documented
      .filter((entry) => actualCommand(entry.name) === undefined)
      .map((entry) => `${entry.doc}: npm run ${entry.name}`);
    expect(unknown).toEqual([]);

    // 有的地方把脚本内容也写了出来（`npm run icon # = …`）。写了就要与
    // package.json 一致：脚本加一步而文档没跟上，读者照抄的就不是真实流程。
    const stale = documented
      .filter((entry) => entry.expansion !== null)
      .filter((entry) => actualCommand(entry.name) !== entry.expansion)
      .map(
        (entry) => `${entry.doc}: npm run ${entry.name} # = ${entry.expansion}`,
      );
    expect(stale).toEqual([]);

    // 守卫本身有效：确实有一处写了展开写法（否则上一行等于没检查）。
    expect(
      documented.filter((entry) => entry.expansion !== null).length,
    ).toBeGreaterThan(0);
  });

  it("README 与 release.md 记的测试规模一致，且文件数与磁盘上的测试文件数相等", () => {
    // 用例总数只有跑一次全量才知道，因此这里只要求两处口径相同；
    // 文件数在磁盘上可数，必须是真的——加了测试文件而没更新文档就会红。
    const SIZE_CLAIM = /(\d+)\s*个(?:测试)?文件[、/ ]*(\d+)\s*(?:条|个)用例/;
    const claims = ["README.md", "docs/release.md"].map((doc) => {
      const match = DOC_TEXT.get(doc)!.match(SIZE_CLAIM);
      expect(match, `${doc} 应写出「N 个文件、M 个用例」的规模`).not.toBeNull();
      return { doc, files: Number(match![1]), cases: Number(match![2]) };
    });

    expect(claims[0].files).toBe(claims[1].files);
    expect(claims[0].cases).toBe(claims[1].cases);

    expect(claims[0].files).toBe(TEST_FILES.length);
  });
});
