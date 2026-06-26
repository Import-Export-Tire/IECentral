type Kind = "applicant" | "personnel";

const COLOR: Record<string, string> = {
  new: "gray", reviewed: "blue", contacted: "blue", scheduled: "amber",
  interviewed: "purple", hired: "green", rejected: "red", dns: "red", expired: "gray",
  active: "green", on_leave: "amber", terminated: "red",
};

export default function StatusBadge({ status, kind }: { status: string; kind?: Kind }) {
  void kind; // reserved for future kind-specific maps
  const key = (status ?? "").toLowerCase();
  const color = COLOR[key] ?? "gray";
  const label = status ? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";
  return <span className={`ui-badge ui-badge-${color}`}>{label}</span>;
}
