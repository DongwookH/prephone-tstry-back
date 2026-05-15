"use client";

interface UsageDay {
  date: string;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export function UsageChart({ data }: { data: UsageDay[] }) {
  if (data.length === 0) {
    return (
      <div className="py-8 text-center text-[12px] text-ink-500">
        아직 사용 기록이 없습니다 — 글을 생성하면 자동 누적됩니다
      </div>
    );
  }

  const maxTotal = Math.max(
    ...data.map((d) => d.inputTokens + d.outputTokens),
    1000,
  );
  const colW = 700 / Math.max(data.length, 1);

  return (
    <svg viewBox="0 0 700 240" className="w-full h-[240px]">
      <line x1="0" y1="40" x2="700" y2="40" stroke="#F2F4F6" />
      <line x1="0" y1="100" x2="700" y2="100" stroke="#F2F4F6" />
      <line x1="0" y1="160" x2="700" y2="160" stroke="#F2F4F6" />
      <line x1="0" y1="220" x2="700" y2="220" stroke="#E5E8EB" />
      <text x="4" y="44" fontSize="9" fill="#8B95A1" fontWeight="600">
        {Math.round(maxTotal).toLocaleString()}
      </text>
      {data.map((d, i) => {
        const baseX = i * colW + colW / 2 - 12;
        const total = d.inputTokens + d.outputTokens;
        const totalH = (total / maxTotal) * 180;
        const outH = (d.outputTokens / maxTotal) * 180;
        const inH = totalH - outH;
        const isLast = i === data.length - 1;
        const mmdd = d.date.slice(5).replace("-", "/");
        return (
          <g key={d.date}>
            {/* input (아래) */}
            <rect
              x={baseX}
              y={220 - inH}
              width="24"
              height={inH}
              fill={isLast ? "#5F7C0E" : "#A8D533"}
            />
            {/* output (위) */}
            <rect
              x={baseX}
              y={220 - totalH}
              width="24"
              height={outH}
              rx={isLast ? 3 : 2}
              fill={isLast ? "#3F5A07" : "#7FA512"}
            />
            <text
              x={baseX + 12}
              y="236"
              textAnchor="middle"
              fill={isLast ? "#191F28" : "#8B95A1"}
              fontSize="10"
              fontWeight={isLast ? 800 : 700}
            >
              {isLast ? "오늘" : mmdd}
            </text>
            {total > 0 && (
              <text
                x={baseX + 12}
                y={220 - totalH - 4}
                textAnchor="middle"
                fontSize="9"
                fill="#191F28"
                fontWeight="700"
              >
                {total >= 1000
                  ? `${(total / 1000).toFixed(1)}K`
                  : total}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
