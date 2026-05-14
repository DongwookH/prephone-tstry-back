import { Topbar } from "@/components/topbar";
import { getActiveKeywords, type KeywordRow } from "@/lib/sheets";
import {
  Download,
  Sparkles,
  CheckCircle2,
  Clock,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AddKeywordButton } from "@/components/add-keyword-form";

// 시트 데이터는 60초마다 다시 읽기
export const revalidate = 60;

const accentMap: Record<string, string> = {
  지역: "bg-brand-50 text-brand-700",
  광역시: "bg-brand-100 text-brand-700",
  일반: "bg-ink-100 text-ink-700",
  페인포인트: "bg-amber-50 text-amber-700",
  채널: "bg-violet-50 text-violet-700",
  개통핵심: "bg-mint-50 text-mint-700",
  타겟: "bg-rose-50 text-rose-700",
  eSIM: "bg-violet-50 text-violet-700",
  기타: "bg-ink-100 text-ink-700",
};

const PREVIEW_LIMIT = 12;

export default async function KeywordsPage() {
  const all = await getActiveKeywords();

  const grouped: Record<string, KeywordRow[]> = {};
  for (const k of all) {
    const cat = k.category || "기타";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(k);
  }

  const priorityOrder = { high: 0, normal: 1, low: 2 };
  for (const cat in grouped) {
    grouped[cat].sort((a, b) => {
      const pa =
        priorityOrder[(a.priority || "normal") as keyof typeof priorityOrder] ??
        1;
      const pb =
        priorityOrder[(b.priority || "normal") as keyof typeof priorityOrder] ??
        1;
      if (pa !== pb) return pa - pb;
      const sa = parseInt(a.search_volume || "0", 10);
      const sb = parseInt(b.search_volume || "0", 10);
      return sb - sa;
    });
  }

  const categories = Object.entries(grouped).sort(
    (a, b) => b[1].length - a[1].length,
  );

  const stats = {
    total: all.length,
    main: all.filter((k) => k.role === "main").length,
    sub: all.filter((k) => k.role === "sub").length,
    high: all.filter((k) => k.priority === "high").length,
    avgVolume: Math.round(
      all.reduce((acc, k) => acc + parseInt(k.search_volume || "0", 10), 0) /
        Math.max(all.length, 1),
    ),
  };

  return (
    <>
      <Topbar
        crumbs={[{ label: "워크스페이스" }, { label: "키워드", bold: true }]}
        right={
          <div className="flex items-center gap-2">
            <a
              href={`https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEETS_ID}/edit`}
              target="_blank"
              rel="noopener noreferrer"
              className="h-9 px-3 rounded-xl text-[13px] font-semibold text-ink-700 hover:bg-ink-100 transition flex items-center gap-1.5"
            >
              <Download size={13} strokeWidth={2} />
              시트 열기
            </a>
            <AddKeywordButton />
          </div>
        }
      />

      <div className="px-8 py-8 max-w-[1400px] mx-auto">
        <section className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-mint-500 opacity-60"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-mint-500"></span>
            </span>
            <span className="text-[12px] font-bold text-mint-700">
              Google Sheet 실시간 연동
            </span>
            <span className="text-[12px] text-ink-500">
              · 60초마다 자동 새로고침
            </span>
          </div>
          <h1 className="text-[28px] font-extrabold text-ink-900 tracking-tight">
            키워드 백로그
          </h1>
          <p className="mt-1 text-[14px] text-ink-600">
            매일 9시, priority 높고 used_count 낮은 키워드 5개 + AI 발굴 5개로
            글이 자동 생성됩니다.
          </p>
        </section>

        <section className="grid grid-cols-4 gap-3 mb-6">
          <KStat
            label="총 키워드"
            value={`${stats.total}`}
            sub={`${stats.high}개 high priority`}
            Icon={Sparkles}
            iconBg="bg-brand-50"
            iconColor="#3182F6"
          />
          <KStat
            label="주 키워드 (main)"
            value={`${stats.main}`}
            sub="글 제목/H2 후보"
            subTone="mint"
            Icon={CheckCircle2}
            iconBg="bg-mint-50"
            iconColor="#00A076"
          />
          <KStat
            label="서브 키워드 (sub)"
            value={`${stats.sub}`}
            sub="본문에 자연스럽게 녹임"
            Icon={Clock}
            iconBg="bg-amber-50"
            iconColor="#D67700"
          />
          <KStat
            label="평균 월 검색량"
            value={stats.avgVolume.toLocaleString()}
            sub="네이버 검색광고 기준"
            subTone="mint"
            Icon={TrendingUp}
            iconBg="bg-rose-50"
            iconColor="#C2333E"
          />
        </section>

        <section className="grid grid-cols-2 gap-4">
          {categories.map(([cat, items]) => (
            <CategoryCard key={cat} category={cat} items={items} />
          ))}
        </section>

        <section className="mt-12 pb-8 text-center">
          <p className="text-[12px] text-ink-400">
            데이터 출처: Google Sheet keywords 탭 ({stats.total}개 active 키워드)
          </p>
        </section>
      </div>
    </>
  );
}

function CategoryCard({
  category,
  items,
}: {
  category: string;
  items: KeywordRow[];
}) {
  const accent = accentMap[category] || accentMap["기타"];
  const mainCount = items.filter((k) => k.role === "main").length;
  const totalVolume = items.reduce(
    (acc, k) => acc + parseInt(k.search_volume || "0", 10),
    0,
  );
  const preview = items.slice(0, PREVIEW_LIMIT);
  const more = items.length - preview.length;

  return (
    <div className="bg-white rounded-2xl shadow-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center",
              accent.split(" ")[0],
            )}
          >
            <span
              className={cn(
                "text-[14px] font-extrabold",
                accent.split(" ")[1],
              )}
            >
              {category[0]}
            </span>
          </div>
          <div>
            <h3 className="text-[15px] font-extrabold text-ink-900">
              {category}
            </h3>
            <p className="text-[11px] font-bold text-ink-500">
              {items.length}개 키워드 · {mainCount}개 main · 총{" "}
              {totalVolume.toLocaleString()}회/월
            </p>
          </div>
        </div>
        <span className="text-[11px] font-bold text-ink-400">
          {items.length}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {preview.map((k) => {
          const isHigh = k.priority === "high";
          const vol = parseInt(k.search_volume || "0", 10);
          const isMain = k.role === "main";
          return (
            <div
              key={k.id || k.keyword}
              className={cn(
                "flex items-center gap-1.5 h-9 px-3 rounded-full text-[12px] font-bold",
                isMain ? accent : "bg-ink-100 text-ink-700",
                isHigh && "ring-1 ring-brand-200",
              )}
              title={`${k.keyword} · ${vol.toLocaleString()}회/월 · ${k.priority || "normal"} · ${k.role || "sub"}`}
            >
              <span>{k.keyword}</span>
              {vol >= 1000 && (
                <span className="text-[10px] font-bold bg-white rounded-full px-1.5 py-0.5">
                  {(vol / 1000).toFixed(1)}k
                </span>
              )}
              {isHigh && vol < 1000 && (
                <span className="text-[10px] font-bold bg-white rounded-full px-1.5 py-0.5">
                  ★
                </span>
              )}
            </div>
          );
        })}
        {more > 0 && (
          <div className="flex items-center gap-1 h-9 px-3 rounded-full bg-ink-50 text-ink-500 text-[12px] font-bold">
            +{more}개
          </div>
        )}
      </div>
    </div>
  );
}

function KStat({
  label,
  value,
  sub,
  subTone = "default",
  Icon,
  iconBg,
  iconColor,
}: {
  label: string;
  value: string;
  sub?: string;
  subTone?: "default" | "mint";
  Icon: React.ElementType;
  iconBg: string;
  iconColor: string;
}) {
  const subColor = subTone === "mint" ? "text-mint-700" : "text-ink-500";
  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <div
          className={`w-7 h-7 rounded-lg ${iconBg} flex items-center justify-center`}
        >
          <Icon size={14} color={iconColor} strokeWidth={2.2} />
        </div>
        <span className="text-[12px] font-bold text-ink-500 tracking-wider">
          {label}
        </span>
      </div>
      <div className="text-[26px] font-extrabold text-ink-900">{value}</div>
      {sub && (
        <div className={`text-[11px] font-bold ${subColor} mt-0.5`}>{sub}</div>
      )}
    </div>
  );
}
