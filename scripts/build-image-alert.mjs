// 이미지 생성 요약 JSON(regen 스크립트 마지막 줄) → 텔레그램 경고 메시지.
// 문제 없으면 빈 문자열을 출력해 워크플로가 발송을 건너뛴다.
export function buildImageAlert(jobStatus, thumbsJson, cardsJson, label, tailMsg) {
  const parse = (s) => {
    try { return JSON.parse(s || "{}"); } catch { return {}; }
  };
  const t = parse(thumbsJson);
  const c = parse(cardsJson);
  const tFail = t.failed ?? 0;
  const cFail = c.failed ?? 0;
  const broken = jobStatus === "failure" || jobStatus === "cancelled";
  if (!broken && tFail === 0 && cFail === 0) return "";
  const lines = [`⚠️ ${label} 이미지 생성 문제`];
  if (broken) lines.push(`잡 상태: ${jobStatus}`);
  if (t.total !== undefined) lines.push(`썸네일: ${t.ok ?? "?"}/${t.total} (실패 ${tFail})`);
  if (c.total !== undefined) lines.push(`카드뉴스: ${c.ok ?? "?"}/${c.total} (실패 ${cFail})`);
  if (tailMsg) lines.push(tailMsg);
  return lines.join("\n");
}

const isCli = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const [, , status = "", thumbs = "", cards = "", label = "이미지", tail = ""] = process.argv;
  process.stdout.write(buildImageAlert(status, thumbs, cards, label, tail));
}
