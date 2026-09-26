import type { Fact } from "../settings/facts";

/**
 * 只读事实列表（设置页「区域」SC-018 / 「关于」SC-022）。
 *
 * 两节都是「陈述当前取值」，没有可改的控件，因此共用一份排版：术语窄列 +
 * 取值 + 说明。标签与取值是成对语义，用 dl / dt / dd 而不是一组 div。
 */
export function FactList({ facts }: { facts: readonly Fact[] }) {
  return (
    <dl className="settings-facts">
      {facts.map((fact) => (
        <div key={fact.label} className="settings-fact">
          <dt className="settings-fact-label">{fact.label}</dt>
          <dd className="settings-fact-value">
            {fact.value}
            {fact.detail && (
              <span className="settings-fact-detail">{fact.detail}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
