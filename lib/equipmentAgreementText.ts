// Single source of truth for the Equipment Responsibility Agreement text.
// Pure (no DOM, no Convex) so it can be imported by the Convex backend (the stored
// agreement text), the on-screen preview, and the printable PDF — keeping all three
// identical. Edit the wording here and it changes everywhere.

export type AgreementInfo = {
  personName: string;
  equipmentLabel?: string; // "Scanner" | "Picker" — defaults to "Scanner"
  equipmentNumber: string;
  serialNumber?: string | null;
  equipmentValue: number;
};

export function buildAgreementText(info: AgreementInfo): string {
  const label = info.equipmentLabel ?? "Scanner";
  const serial = info.serialNumber ? ` (Serial: ${info.serialNumber})` : "";
  const value = info.equipmentValue.toFixed(2);

  return `EQUIPMENT RESPONSIBILITY AGREEMENT

This Equipment Responsibility Agreement ("Agreement") is entered into between the Employee named below and Import Export Tire Company ("Company").

EQUIPMENT ASSIGNED:
${label} #${info.equipmentNumber}${serial}
Equipment Value: $${value}

EMPLOYEE: ${info.personName}

TERMS AND CONDITIONS:

1. SOLE RESPONSIBILITY: The undersigned Employee acknowledges receipt of the above-described Company equipment and accepts full responsibility for its care, security, and proper use.

2. AUTHORIZED USE ONLY: This equipment is issued exclusively to the undersigned Employee. No other individual is authorized to access, operate, or use this equipment under any circumstances.

3. ON-PREMISES ONLY: This equipment must remain on Company premises at all times. Under no circumstances shall this equipment be removed from the workplace or taken to the Employee's residence.

4. DAMAGE REPORTING: The Employee shall immediately report any damage, malfunction, or defect to their supervisor. Failure to promptly report damage may result in disciplinary action and financial liability.

5. FINANCIAL LIABILITY:
   a) Failure to return equipment upon separation from employment, reassignment, or request by management will result in a deduction of up to $${value} from the Employee's final pay.
   b) Damage resulting from intentional misconduct, gross negligence, or careless handling may result in a deduction of up to $${value} from Employee's pay to cover replacement costs.

6. RETURN REQUIREMENT: Upon termination of employment, reassignment, or request by management, the Employee shall immediately return this equipment in the same condition as received, allowing for reasonable wear and tear.

By signing below, the Employee acknowledges that they have read, understand, and agree to abide by all terms and conditions set forth in this Agreement.`;
}
