// Printable scores + recommended-raise summary for a batch of reviews (Terry's view).
import { REVIEW_TYPE_LABEL, type ReviewType } from "@/lib/reviewQuestions";

interface SummaryRow {
  _id: string;
  employeeName: string;
  averageScore?: number;
  recommendedIncrease?: string;
  decision: string;
  approvedIncrease?: string;
}

const thL: React.CSSProperties = { textAlign: "left", padding: "4px 6px", borderBottom: "1px solid #000" };
const thC: React.CSSProperties = { textAlign: "center", padding: "4px 6px", borderBottom: "1px solid #000" };
const tdL: React.CSSProperties = { textAlign: "left", padding: "4px 6px", borderBottom: "1px solid #ccc" };
const tdC: React.CSSProperties = { textAlign: "center", padding: "4px 6px", borderBottom: "1px solid #ccc" };

export default function ReviewSummaryPrint({ rows, type }: { rows: SummaryRow[]; type: ReviewType }) {
  const scored = rows.filter((r) => r.averageScore != null);
  return (
    <div style={{ fontFamily: "Arial, sans-serif", color: "#000", fontSize: "12px" }}>
      <div style={{ textAlign: "center", borderBottom: "2px solid #000", paddingBottom: "8px", marginBottom: "12px" }}>
        <div style={{ fontSize: "16px", fontWeight: 700 }}>Import Export Tire — {REVIEW_TYPE_LABEL[type]} Summary</div>
        <div style={{ fontSize: "11px" }}>Scores &amp; recommended wage increases</div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
        <thead>
          <tr style={{ background: "#eee" }}>
            <th style={thL}>Employee</th>
            <th style={thC}>Avg (1–5)</th>
            <th style={thL}>Recommended</th>
            <th style={thC}>Decision</th>
            <th style={thL}>Approved</th>
          </tr>
        </thead>
        <tbody>
          {scored.map((r) => (
            <tr key={r._id}>
              <td style={tdL}>{r.employeeName}</td>
              <td style={tdC}>{r.averageScore!.toFixed(2)}</td>
              <td style={tdL}>{r.recommendedIncrease ?? "—"}</td>
              <td style={tdC}>{r.decision}</td>
              <td style={tdL}>{r.approvedIncrease || ""}</td>
            </tr>
          ))}
          {scored.length === 0 && (
            <tr><td colSpan={5} style={{ ...tdL, textAlign: "center" }}>No scored reviews yet.</td></tr>
          )}
        </tbody>
      </table>
      <p style={{ marginTop: "24px" }}>Approved by: ____________________ (Terry) &nbsp;&nbsp; Date: ________</p>
    </div>
  );
}
