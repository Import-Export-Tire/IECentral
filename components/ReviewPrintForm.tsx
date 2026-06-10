// Printable, pre-filled performance-review form (one per employee). Used by the
// Review Tracker report's "Print Forms" batch and the Reviews hub. Inline styles
// so it renders identically in the browser print dialog / Save-as-PDF.
import { REVIEW_QUESTIONS, REVIEW_TYPE_LABEL, reviewSections, type ReviewType } from "@/lib/reviewQuestions";

export interface ReviewFormPerson {
  name: string;
  position?: string;
  department?: string;
  locationName?: string;
  hireDate?: string;
  dueDateLabel?: string;  // e.g. "90-Day Due" | "Annual Due"
  dueDate?: string;       // pre-formatted date string
}

const cellLabel: React.CSSProperties = { fontWeight: 700, paddingRight: "4px", whiteSpace: "nowrap" };

export default function ReviewPrintForm({ person, type, pageBreak = true }: { person: ReviewFormPerson; type: ReviewType; pageBreak?: boolean }) {
  const questions = REVIEW_QUESTIONS[type];
  return (
    <div style={{ fontFamily: "Arial, sans-serif", color: "#000", fontSize: "12px", pageBreakAfter: pageBreak ? "always" : "auto" }}>
      <div style={{ textAlign: "center", borderBottom: "2px solid #000", paddingBottom: "8px", marginBottom: "10px" }}>
        <div style={{ fontSize: "16px", fontWeight: 700 }}>Import Export Tire — {REVIEW_TYPE_LABEL[type]}</div>
        <div style={{ fontSize: "11px" }}>Performance Evaluation &nbsp;·&nbsp; rate each item 1 (poor) – 5 (excellent)</div>
      </div>

      <table style={{ width: "100%", marginBottom: "10px", fontSize: "12px", borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={{ width: "60%", padding: "2px 0" }}><span style={cellLabel}>Employee:</span> {person.name}</td>
            <td style={{ padding: "2px 0" }}><span style={cellLabel}>Position:</span> {person.position || "—"}</td>
          </tr>
          <tr>
            <td style={{ padding: "2px 0" }}><span style={cellLabel}>Department:</span> {person.department || "—"}</td>
            <td style={{ padding: "2px 0" }}><span style={cellLabel}>Location:</span> {person.locationName || "—"}</td>
          </tr>
          <tr>
            <td style={{ padding: "2px 0" }}><span style={cellLabel}>Hire Date:</span> {person.hireDate || "—"}</td>
            <td style={{ padding: "2px 0" }}><span style={cellLabel}>{person.dueDateLabel || "Review Due"}:</span> {person.dueDate || "—"}</td>
          </tr>
          <tr>
            <td style={{ padding: "2px 0" }}><span style={cellLabel}>Reviewer:</span> ____________________</td>
            <td style={{ padding: "2px 0" }}><span style={cellLabel}>Date:</span> ____________________</td>
          </tr>
        </tbody>
      </table>

      {reviewSections(type).map((section) => (
        <div key={section} style={{ marginBottom: "8px" }}>
          <div style={{ fontWeight: 700, background: "#eee", padding: "3px 6px", borderBottom: "1px solid #000" }}>{section}</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ fontSize: "10px" }}>
                <th style={{ textAlign: "left", padding: "2px 6px" }} />
                {[1, 2, 3, 4, 5].map((n) => <th key={n} style={{ width: "26px", padding: "2px" }}>{n}</th>)}
              </tr>
            </thead>
            <tbody>
              {questions.filter((q) => q.section === section).map((q) => (
                <tr key={q.id} style={{ borderBottom: "1px solid #ccc" }}>
                  <td style={{ padding: "5px 6px" }}>{q.text}</td>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <td key={n} style={{ textAlign: "center", padding: "5px 2px" }}>
                      <span style={{ display: "inline-block", width: "14px", height: "14px", border: "1px solid #000" }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div style={{ marginTop: "8px" }}>
        <strong>Reviewer Comments:</strong>
        <div style={{ border: "1px solid #000", height: "90px", marginTop: "4px" }} />
      </div>

      <table style={{ width: "100%", marginTop: "22px", fontSize: "12px" }}>
        <tbody>
          <tr>
            <td style={{ paddingTop: "18px", width: "50%" }}><div style={{ borderTop: "1px solid #000", paddingTop: "3px" }}>Reviewer &nbsp; Date: ________</div></td>
            <td style={{ paddingTop: "18px", paddingLeft: "20px" }}><div style={{ borderTop: "1px solid #000", paddingTop: "3px" }}>Andy Barrows &nbsp; Date: ________</div></td>
          </tr>
          <tr>
            <td style={{ paddingTop: "24px" }}><div style={{ borderTop: "1px solid #000", paddingTop: "3px" }}>Terry &nbsp; Date: ________</div></td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
