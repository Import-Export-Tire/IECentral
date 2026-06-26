// Thresholds match getScoreColor in app/applications/[id]/page.tsx:
// score >= 70 → green, score >= 50 → amber, else → red
const GREEN_MIN = 70;
const AMBER_MIN = 50;

export default function ScorePill({
  score, size = "md", showOutOf = false,
}: { score: number | null | undefined; size?: "sm" | "md"; showOutOf?: boolean }) {
  if (score == null || Number.isNaN(score)) return <span className="ui-badge ui-badge-gray">—</span>;
  const color = score >= GREEN_MIN ? "green" : score >= AMBER_MIN ? "amber" : "red";
  const sz = size === "sm" ? "text-sm" : "text-base";
  return (
    <span className={`ui-badge ui-badge-${color} ${sz} font-bold`}>
      {Math.round(score)}{showOutOf ? "/100" : ""}
    </span>
  );
}
