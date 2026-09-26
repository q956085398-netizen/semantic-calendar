import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { THEME_SETTING_KEY, applyTheme, normalizeTheme } from "./theme";

/**
 * 当前 Node 运行时的 localStorage 全局指向无有效文件的
 * --localstorage-file，方法不可用；安装一个标准形状的替身，
 * 只影响测试进程，不涉及产品代码。
 */
function installLocalStorageStub(): void {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
  });
}

beforeAll(() => {
  installLocalStorageStub();
});

describe("normalizeTheme", () => {
  it("合法值原样返回", () => {
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("dark")).toBe("dark");
  });

  it("非法或缺失值回退浅色（THEME-001 默认）", () => {
    expect(normalizeTheme(undefined)).toBe("light");
    expect(normalizeTheme(null)).toBe("light");
    expect(normalizeTheme("blue")).toBe("light");
    expect(normalizeTheme(1)).toBe("light");
  });
});

describe("applyTheme", () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
    window.localStorage.clear();
  });

  it("把主题写到根元素 data-theme", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("镜像到 localStorage，供 index.html 启动内联脚本预绘制", () => {
    applyTheme("dark");
    expect(window.localStorage.getItem("semantic-calendar.theme")).toBe("dark");

    applyTheme("light");
    expect(window.localStorage.getItem("semantic-calendar.theme")).toBe(
      "light",
    );
  });

  it("localStorage 抛错时不影响主题应用（隐私模式降级）", () => {
    Object.defineProperty(window, "localStorage", {
      value: {
        setItem: () => {
          throw new Error("不可用");
        },
      },
      configurable: true,
    });

    try {
      expect(() => applyTheme("dark")).not.toThrow();
      expect(document.documentElement.dataset.theme).toBe("dark");
    } finally {
      installLocalStorageStub();
    }
  });
});

describe("THEME_SETTING_KEY", () => {
  it("使用 app.theme 设置键（与快照设置命名空间一致）", () => {
    expect(THEME_SETTING_KEY).toBe("app.theme");
  });
});
