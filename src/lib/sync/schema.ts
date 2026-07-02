import { config } from "../config";
import { resolveCustomFieldIds, normFieldKey } from "../sources/ghl";
import { createCustomField } from "./ghlWrite";

// -----------------------------------------------------------------------------
// Field provisioning. The app can create the custom fields it needs if they're
// missing — but only as a deliberate, idempotent "ensure" step (run on demand),
// never silently on every write. Add a field here and running ensureFields()
// creates just the missing one, in the right folder.
// -----------------------------------------------------------------------------

export interface DesiredField {
  key: string;
  name: string;
  dataType: string; // GHL type, e.g. LARGE_TEXT, MONETORY, NUMERICAL
  folder: string; // parent folder id
}

/** The fields the app is responsible for provisioning. Currently the two
 *  payment-history logs; extend this list as new metrics are added. */
export function desiredFields(): DesiredField[] {
  const mf = config.ghl.moneyFields;
  const rev = config.ghl.fieldFolders.revenue;
  return [
    { key: mf.cardPaymentHistory, name: "Card Payment History", dataType: "LARGE_TEXT", folder: rev },
    { key: mf.cryptoPaymentHistory, name: "Crypto Payment History", dataType: "LARGE_TEXT", folder: rev },
    { key: mf.totalTransactions, name: "Total Transactions", dataType: "NUMERICAL", folder: rev },
    { key: mf.totalRevenue, name: "Total Revenue", dataType: "MONETORY", folder: rev },
  ];
}

export interface EnsureReport {
  dryRun: boolean;
  existing: string[];
  created: { key: string; id: string }[];
  wouldCreate: string[];
  mismatched: { wanted: string; got: string; id: string }[];
  errors: { key: string; error: string }[];
}

/** Create any missing desired fields. Idempotent: existing fields are left
 *  alone. dryRun reports what it would create without touching GHL. */
export async function ensureFields(opts: { dryRun?: boolean } = {}): Promise<EnsureReport> {
  const dryRun = opts.dryRun ?? true;
  const ids = await resolveCustomFieldIds(true); // fresh read
  const report: EnsureReport = {
    dryRun,
    existing: [],
    created: [],
    wouldCreate: [],
    mismatched: [],
    errors: [],
  };

  for (const f of desiredFields()) {
    if (ids.get(normFieldKey(f.key))) {
      report.existing.push(f.key);
      continue;
    }
    if (dryRun) {
      report.wouldCreate.push(f.key);
      continue;
    }
    try {
      const res = await createCustomField({ name: f.name, dataType: f.dataType, parentId: f.folder });
      if (normFieldKey(res.fieldKey) === normFieldKey(f.key)) {
        report.created.push({ key: res.fieldKey, id: res.id });
      } else {
        // Field was created but GHL generated a different key than the code
        // expects — surface it so the env override can be set.
        report.mismatched.push({ wanted: f.key, got: res.fieldKey, id: res.id });
      }
    } catch (err) {
      report.errors.push({ key: f.key, error: (err as Error).message });
    }
  }

  // Refresh the id cache so the very next write resolves any just-created field.
  if (!dryRun && report.created.length) await resolveCustomFieldIds(true);
  return report;
}
